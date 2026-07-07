import { describe, it } from "node:test";
import assert from "node:assert/strict";
import picomatch from "picomatch";
import {
  buildConflictGraph,
  globSetsIntersect,
  globsIntersect,
  intersectionWitness,
  schedule,
  SCHEDULE_PLAN_SCHEMA_VERSION,
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

function expandForTest(glob: string): string[] {
  const start = glob.indexOf("{");
  if (start === -1) return [glob];
  const end = glob.indexOf("}", start + 1);
  if (end === -1) return [glob];
  const before = glob.slice(0, start);
  const after = glob.slice(end + 1);
  return glob
    .slice(start + 1, end)
    .split(",")
    .flatMap((part) => expandForTest(`${before}${part}${after}`));
}

function sampleSegment(segment: string): string[] {
  const samples = new Set<string>([""]);
  let literal = "";
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (char === "*") literal += "z";
    else if (char === "?") literal += "q";
    else if (char === "[") {
      const end = segment.indexOf("]", index + 1);
      if (end === -1) return [segment];
      const body = segment.slice(index + 1, end);
      if (body.startsWith("^")) literal += "z";
      else literal += body[0] === "!" && body.length > 1 ? "!" : (body[0] ?? "z");
      index = end;
    } else {
      literal += char ?? "";
    }
  }
  samples.add(literal);
  return [...samples];
}

function instantiate(segments: string[]): string[] {
  let paths = [""];
  for (const segment of segments) {
    const segmentSamples = segment === "**" ? ["", "z"] : sampleSegment(segment);
    paths = paths.flatMap((path) =>
      segmentSamples.map((sample) => [path, sample].filter(Boolean).join("/")),
    );
  }
  return paths;
}

function samplePaths(glob: string): string[] {
  const out = new Set<string>();
  for (const expanded of expandForTest(glob)) {
    for (const variant of instantiate(expanded.split("/"))) {
      if (variant.length > 0) out.add(variant);
    }
  }
  return [...out];
}

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
    assert.equal(globsIntersect("[a-c]", "[b-d]"), true);
    assert.equal(globsIntersect("[!a]", "[!b]"), true);
    assert.equal(globsIntersect("[a-c]", "[x-z]"), false);
  });

  it("checks sets and conservative unsupported fallback", () => {
    assert.equal(globSetsIntersect(["src/ui/**"], ["src/api/**", "test/**"]), false);
    assert.equal(globSetsIntersect(["src/ui/**"], ["src/api/**", "src/ui/button.ts"]), true);
    assert.equal(globsIntersect("!(src)/**", "test/**"), true);
    assert.notEqual(intersectionWitness("!(src)/**", "test/**"), null);
  });
});

describe("trailing globstar semantics match picomatch (regression #0024)", () => {
  it("does not over-approximate wildcard-segment + trailing /**", () => {
    // Bug: engine returned "test-.ts", but picomatch("test-*/**") rejects it,
    // because a single-segment path never matches `wildcard/**`.
    assert.equal(globsIntersect("*.ts", "test-*/**"), false);
    assert.equal(intersectionWitness("*.ts", "test-*/**"), null);
  });

  it("keeps picomatch's literal/** parent match", () => {
    assert.equal(globsIntersect("a/**", "a"), true);
    assert.equal(globsIntersect("src/**", "src"), true);
  });

  it("still intersects when descent actually exists", () => {
    assert.equal(globsIntersect("test-*/**", "test-x/y.ts"), true);
  });
});

describe("intersection witness is a real path under picomatch", () => {
  it("witness matches both globs (supported globs)", () => {
    const random = mulberry32(11);
    for (let index = 0; index < 10_000; index += 1) {
      const a = randomGlob(random);
      const b = randomGlob(random);
      const witness = intersectionWitness(a, b);
      if (witness === null) continue;
      const matchA = picomatch(a, { dot: true });
      const matchB = picomatch(b, { dot: true });
      assert.ok(
        matchA(witness) && matchB(witness),
        `witness "${witness}" must match both ${a} and ${b}`,
      );
    }
  });
});

describe("soundness: disjoint verdict has no shared member drawn from either glob", () => {
  it("no path instantiated from a or b matches both when declared disjoint", () => {
    const random = mulberry32(99);
    for (let index = 0; index < 10_000; index += 1) {
      const a = randomGlob(random);
      const b = randomGlob(random);
      const matchA = picomatch(a, { dot: true });
      const matchB = picomatch(b, { dot: true });
      const samplesA = samplePaths(a).filter((path) => matchA(path));
      const samplesB = samplePaths(b).filter((path) => matchB(path));
      if (globsIntersect(a, b)) continue;
      const shared = [...samplesA, ...samplesB].find((path) => matchA(path) && matchB(path));
      assert.equal(shared, undefined, `${a} & ${b} disjoint but both match ${shared}`);
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
    assert.equal(SCHEDULE_PLAN_SCHEMA_VERSION, 1);

    assert.deepEqual(
      schedulePlanSchema.parse({
        schemaVersion: SCHEDULE_PLAN_SCHEMA_VERSION,
        planId: "demo",
        tasks: [{ id: "t1", contract: ".scopelock/contracts/t1.json" }],
      }),
      {
        schemaVersion: SCHEDULE_PLAN_SCHEMA_VERSION,
        planId: "demo",
        tasks: [{ id: "t1", contract: ".scopelock/contracts/t1.json" }],
      },
    );

    assert.throws(() =>
      schedulePlanSchema.parse({
        schemaVersion: SCHEDULE_PLAN_SCHEMA_VERSION,
        planId: "empty",
        tasks: [],
      }),
    );
  });

  it("rejects a plan with duplicate task ids", () => {
    assert.throws(
      () =>
        schedulePlanSchema.parse({
          schemaVersion: SCHEDULE_PLAN_SCHEMA_VERSION,
          planId: "dup",
          tasks: [
            { id: "t1", contract: "a.json" },
            { id: "t1", contract: "b.json" },
          ],
        }),
      /duplicate task id: t1/,
    );
  });
});
