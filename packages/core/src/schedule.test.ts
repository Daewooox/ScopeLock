import { describe, it } from "node:test";
import assert from "node:assert/strict";
import picomatch from "picomatch";
import {
  buildConflictGraph,
  globSetsIntersect,
  globToRegExp,
  globsIntersect,
  intersectionWitness,
  schedule,
  schedulePlanSchema,
  scopesConflict,
  type TaskScope,
} from "./index.js";

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

const literalParts = ["a", "b", "c", "api", "ui", "core", "x", "test", ".env"];
const segmentParts = ["a", "b", "c", "x", "*.ts", "*.tsx", "*", "?", "[ab]", "[!c]", "{api,ui}", "test-*"];

function randomSegment(random: () => number): string {
  if (random() < 0.45) return pick(random, literalParts);
  if (random() < 0.9) return pick(random, segmentParts);
  return `${pick(random, ["a", "b", "x"])}${pick(random, ["*", "?", "[ab]"])}`;
}

function randomGlob(random: () => number): string {
  const count = 1 + Math.floor(random() * 4);
  const segments: string[] = [];
  for (let index = 0; index < count; index += 1) {
    segments.push(random() < 0.18 ? "**" : randomSegment(random));
  }
  return segments.join("/");
}

function randomPath(random: () => number): string {
  const count = 1 + Math.floor(random() * 4);
  return Array.from({ length: count }, () =>
    pick(random, ["a", "b", "c", "api", "ui", "core", "x", "test-a", "x.ts", "x.tsx", ".env"]),
  ).join("/");
}

const corpus = (() => {
  const random = mulberry32(42);
  const paths = new Set<string>(["src/api/x.ts", "src/ui/view.ts", "pkg/b/x", "a/x/b", ".env"]);
  for (let index = 0; index < 300; index += 1) paths.add(randomPath(random));
  return [...paths];
})();

describe("glob intersection known pairs", () => {
  it("handles the release-gate examples", () => {
    assert.equal(globsIntersect("*.ts", "*.tsx"), false);
    assert.equal(globsIntersect("src/**", "src/api/x.ts"), true);
    assert.equal(intersectionWitness("src/**", "src/api/x.ts"), "src/api/x.ts");
    assert.equal(globsIntersect("**/*.ts", "src/**"), true);
    assert.equal(globsIntersect("a/*/b", "a/b/c"), false);
    assert.equal(intersectionWitness("a/*/b", "a/x/b"), "a/x/b");
    assert.equal(globsIntersect("src/ui/**", "src/api/**"), false);
    assert.equal(globsIntersect("pkg/{a,b}/**", "pkg/b/**"), true);
  });

  it("checks sets and conservative unsupported fallback", () => {
    assert.equal(globSetsIntersect(["src/ui/**"], ["src/api/**", "test/**"]), false);
    assert.equal(globSetsIntersect(["src/ui/**"], ["src/api/**", "src/ui/button.ts"]), true);
    assert.equal(globsIntersect("!(src)/**", "test/**"), true);
    assert.notEqual(intersectionWitness("!(src)/**", "test/**"), null);
  });
});

describe("glob matcher consistency", () => {
  it("matches picomatch for supported random globs and paths", () => {
    const random = mulberry32(7);
    for (let index = 0; index < 10_000; index += 1) {
      const glob = randomGlob(random);
      const path = randomPath(random);
      const ours = globToRegExp(glob).test(path);
      const theirs = picomatch(glob, { dot: true })(path);
      assert.equal(ours, theirs, `${glob} should match ${path} like picomatch`);
    }
  });
});

describe("glob intersection property soundness", () => {
  it("does not declare disjoint when the path corpus finds a shared match", () => {
    const random = mulberry32(99);
    for (let index = 0; index < 10_000; index += 1) {
      const a = randomGlob(random);
      const b = randomGlob(random);
      if (globsIntersect(a, b)) continue;

      const matchA = picomatch(a, { dot: true });
      const matchB = picomatch(b, { dot: true });
      const counterexample = corpus.find((path) => matchA(path) && matchB(path));
      assert.equal(counterexample, undefined, `${a} and ${b} both match ${counterexample}`);
    }
  });
});

describe("scope algebra conflict graph and scheduler", () => {
  const uiTask: TaskScope = {
    id: "ui",
    planned: ["packages/app/src/ui/**"],
    forbidden: [],
  };
  const apiTask: TaskScope = {
    id: "api",
    planned: ["packages/app/src/api/**"],
    forbidden: [],
  };
  const sharedTask: TaskScope = {
    id: "shared",
    planned: ["packages/app/src/ui/button.ts"],
    forbidden: [],
  };

  it("detects disjoint scopes and write-write conflicts with witnesses", () => {
    assert.equal(scopesConflict(uiTask, apiTask), null);
    assert.deepEqual(scopesConflict(uiTask, sharedTask), {
      a: "ui",
      b: "shared",
      kind: "write-write",
      witness: "packages/app/src/ui/button.ts",
    });
  });

  it("adds read-write hazards in the writer-to-reader direction when requested", () => {
    const writer: TaskScope = {
      id: "domain",
      planned: ["packages/app/src/domain/**"],
      forbidden: [],
    };
    const reader: TaskScope = {
      id: "ui",
      planned: ["packages/app/src/ui/**"],
      forbidden: [],
      read: ["packages/app/src/domain/models.ts"],
    };

    assert.deepEqual(scopesConflict(writer, reader), {
      a: "domain",
      b: "ui",
      kind: "read-write",
      witness: "packages/app/src/domain/models.ts",
    });

    const graph = buildConflictGraph([reader, writer], { readHazards: true });
    assert.deepEqual(graph.readEdges, [["domain", "ui"]]);
    assert.deepEqual(graph.writeEdges, []);
  });

  it("builds a deterministic write graph and F1 coloring schedule", () => {
    const graph = buildConflictGraph([
      { id: "t3", planned: ["src/domain/**"], forbidden: [] },
      { id: "t1", planned: ["src/ui/**"], forbidden: [] },
      { id: "t2", planned: ["src/api/**"], forbidden: [] },
      { id: "t4", planned: ["src/ui/button.ts"], forbidden: [] },
    ]);

    assert.deepEqual(graph.nodes, ["t1", "t2", "t3", "t4"]);
    assert.deepEqual(graph.writeEdges, [["t1", "t4"]]);
    assert.equal(graph.conflicts[0]?.witness, "src/ui/button.ts");
    assert.deepEqual(schedule(graph), {
      waves: [["t1", "t2", "t3"], ["t4"]],
      cycles: [],
    });
  });

  it("validates the plan-parallel input schema shape", () => {
    assert.deepEqual(
      schedulePlanSchema.parse({
        schemaVersion: 1,
        planId: "demo",
        tasks: [{ id: "t1", contract: ".scopelock/contracts/t1.json" }],
      }),
      {
        schemaVersion: 1,
        planId: "demo",
        tasks: [{ id: "t1", contract: ".scopelock/contracts/t1.json" }],
      },
    );

    assert.throws(() =>
      schedulePlanSchema.parse({
        schemaVersion: 1,
        planId: "empty",
        tasks: [],
      }),
    );
  });
});
