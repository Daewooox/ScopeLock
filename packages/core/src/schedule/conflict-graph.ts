import { firstIntersectionWitness, type ScopeConflict, type TaskScope } from "./scope-algebra.js";

export interface ConflictGraph {
  nodes: string[];
  writeEdges: Array<[string, string]>;
  readEdges: Array<[string, string]>;
  conflicts: ScopeConflict[];
}

export function buildConflictGraph(
  scopes: TaskScope[],
  opts: { readHazards?: boolean } = {},
): ConflictGraph {
  // nodes are sorted (not insertion order) so the graph, and any schedule built
  // from it, is deterministic regardless of the order tasks are passed in.
  const nodes = scopes.map((scope) => scope.id).sort();
  if (new Set(nodes).size !== nodes.length) {
    throw new Error("task ids must be unique");
  }

  const byId = new Map(scopes.map((scope) => [scope.id, scope]));
  const writeEdges: Array<[string, string]> = [];
  const readEdges: Array<[string, string]> = [];
  const conflicts: ScopeConflict[] = [];

  // left < right over the sorted nodes: each unordered pair is visited once,
  // in a fixed order, so writeEdges/readEdges/conflicts are reproducible.
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = byId.get(nodes[left] as string) as TaskScope;
      const b = byId.get(nodes[right] as string) as TaskScope;

      const writeWitness = firstIntersectionWitness(a.planned, b.planned);
      if (writeWitness !== null) {
        writeEdges.push([a.id, b.id]);
        conflicts.push({ a: a.id, b: b.id, kind: "write-write", witness: writeWitness });
      }

      if (opts.readHazards === true) {
        addReadConflict(a, b, readEdges, conflicts);
        addReadConflict(b, a, readEdges, conflicts);
      }
    }
  }

  return { nodes, writeEdges, readEdges, conflicts };
}

function addReadConflict(
  writer: TaskScope,
  reader: TaskScope,
  readEdges: Array<[string, string]>,
  conflicts: ScopeConflict[],
): void {
  const witness = firstIntersectionWitness(writer.planned, reader.read ?? []);
  if (witness === null) return;
  readEdges.push([writer.id, reader.id]);
  conflicts.push({ a: writer.id, b: reader.id, kind: "read-write", witness });
}
