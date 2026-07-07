import type { ConflictGraph } from "./conflict-graph.js";

export interface Schedule {
  waves: string[][];
  cycles: string[][];
}

/**
 * Greedy Welsh-Powell coloring restricted to `nodes`, using only the
 * writeEdges whose both endpoints are in `nodes`. Deterministic tie-break by
 * node id (H5) at every step: node order, color assignment, and the output
 * wave contents are all sorted.
 */
function colorWriteWrite(nodes: string[], writeEdges: ReadonlyArray<[string, string]>): string[][] {
  const nodeSet = new Set(nodes);
  const neighbors = new Map(nodes.map((node) => [node, new Set<string>()]));
  for (const [a, b] of writeEdges) {
    if (!nodeSet.has(a) || !nodeSet.has(b)) continue;
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
  }

  const order = [...nodes].sort((a, b) => {
    const degree = (neighbors.get(b)?.size ?? 0) - (neighbors.get(a)?.size ?? 0);
    return degree === 0 ? a.localeCompare(b) : degree;
  });
  const colors = new Map<string, number>();

  for (const node of order) {
    const used = new Set(
      [...(neighbors.get(node) ?? [])]
        .map((neighbor) => colors.get(neighbor))
        .filter((color): color is number => color !== undefined),
    );
    let color = 0;
    while (used.has(color)) color += 1;
    colors.set(node, color);
  }

  const waves: string[][] = [];
  for (const node of nodes) {
    const color = colors.get(node) ?? 0;
    waves[color] ??= [];
    waves[color]?.push(node);
  }

  return waves.filter((wave): wave is string[] => wave !== undefined).map((wave) => wave.sort());
}

/**
 * F1: write-write-only coloring. With no read hazards there is no notion of
 * ordering or a cycle, so every color is a fully parallel wave and cycles is
 * always []. This is the scheduler's only behavior when `--include-read-
 * hazards` is not set (the default), and stays byte-for-byte what it was
 * before F2 landed.
 */
function scheduleF1(nodes: string[], writeEdges: ReadonlyArray<[string, string]>): Schedule {
  return { waves: colorWriteWrite(nodes, writeEdges), cycles: [] };
}

/**
 * Weakly-connected components of `nodes` under `edges` (direction ignored -
 * used only to group deadlocked nodes for reporting, not to prove a cycle
 * exists). Deterministic: nodes are visited in the sorted order given, so
 * component order and each component's contents are reproducible.
 */
function connectedComponents(nodes: string[], edges: ReadonlyArray<[string, string]>): string[][] {
  const adjacency = new Map<string, Set<string>>(nodes.map((node) => [node, new Set<string>()]));
  for (const [a, b] of edges) {
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const start of nodes) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component.sort());
  }

  return components;
}

/**
 * F2: layered scheduling over read-write hazard edges (writer -> reader:
 * the writer must finish in an earlier layer than the reader). Kahn's
 * algorithm peels off zero-in-degree nodes one layer at a time; within each
 * layer, F1 write-write coloring further splits it into parallel sub-waves.
 *
 * Kill-safety: this always terminates. If Kahn stalls (every remaining node
 * has in-degree > 0 - which, for a finite graph, can only happen if the
 * remaining nodes form or depend on a cycle), the loop stops immediately;
 * the stalled nodes are grouped by connectivity and returned in `cycles`
 * instead of being scheduled. Nodes that were already resolved into earlier
 * waves are kept - only the unschedulable remainder is dropped from `waves`.
 */
function scheduleF2(
  nodes: string[],
  writeEdges: ReadonlyArray<[string, string]>,
  readEdges: ReadonlyArray<[string, string]>,
): Schedule {
  const inDegree = new Map(nodes.map((node) => [node, 0]));
  const successors = new Map<string, string[]>(nodes.map((node) => [node, []]));
  for (const [writer, reader] of readEdges) {
    inDegree.set(reader, (inDegree.get(reader) ?? 0) + 1);
    successors.get(writer)?.push(reader);
  }

  const remaining = new Set(nodes);
  const waves: string[][] = [];

  for (;;) {
    if (remaining.size === 0) break;

    const ready = [...remaining].filter((node) => (inDegree.get(node) ?? 0) === 0).sort();
    if (ready.length === 0) break; // stalled: the rest is (or depends on) a cycle

    for (const subWave of colorWriteWrite(ready, writeEdges)) {
      waves.push(subWave);
    }

    for (const node of ready) {
      remaining.delete(node);
      for (const successor of successors.get(node) ?? []) {
        if (!remaining.has(successor)) continue;
        inDegree.set(successor, (inDegree.get(successor) as number) - 1);
      }
    }
  }

  if (remaining.size === 0) {
    return { waves, cycles: [] };
  }

  const stuckNodes = [...remaining].sort();
  const stuckEdges = readEdges.filter(([from, to]) => remaining.has(from) && remaining.has(to));
  return { waves, cycles: connectedComponents(stuckNodes, stuckEdges) };
}

export function schedule(graph: ConflictGraph): Schedule {
  if (graph.readEdges.length === 0) {
    return scheduleF1(graph.nodes, graph.writeEdges);
  }
  return scheduleF2(graph.nodes, graph.writeEdges, graph.readEdges);
}
