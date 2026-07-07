import { intersectionWitness } from "./glob-intersect.js";

export interface TaskScope {
  id: string;
  planned: string[];
  forbidden: string[];
  read?: string[];
}

export interface ScopeConflict {
  a: string;
  b: string;
  kind: "write-write" | "read-write";
  witness: string | null;
}

export function firstIntersectionWitness(as: string[], bs: string[]): string | null {
  for (const a of as) {
    for (const b of bs) {
      const witness = intersectionWitness(a, b);
      if (witness !== null) return witness;
    }
  }
  return null;
}

export function scopesConflict(a: TaskScope, b: TaskScope): ScopeConflict | null {
  const writeWitness = firstIntersectionWitness(a.planned, b.planned);
  if (writeWitness !== null) {
    return { a: a.id, b: b.id, kind: "write-write", witness: writeWitness };
  }

  const aBeforeB = firstIntersectionWitness(a.planned, b.read ?? []);
  if (aBeforeB !== null) {
    return { a: a.id, b: b.id, kind: "read-write", witness: aBeforeB };
  }

  const bBeforeA = firstIntersectionWitness(b.planned, a.read ?? []);
  if (bBeforeA !== null) {
    return { a: b.id, b: a.id, kind: "read-write", witness: bBeforeA };
  }

  return null;
}
