import type { ConflictGraph } from "./conflict-graph.js";

export interface Schedule {
  waves: string[][];
  cycles: string[][];
}

export function schedule(graph: ConflictGraph): Schedule {
  const neighbors = new Map(graph.nodes.map((node) => [node, new Set<string>()]));
  for (const [a, b] of graph.writeEdges) {
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
  }

  const order = [...graph.nodes].sort((a, b) => {
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
  for (const node of graph.nodes) {
    const color = colors.get(node) ?? 0;
    waves[color] ??= [];
    waves[color]?.push(node);
  }

  return {
    waves: waves.map((wave) => wave.sort()),
    cycles: [],
  };
}
