import { describe, it } from "node:test";
import assert from "node:assert/strict";
import picomatch from "picomatch";
import {
  globSetsIntersect,
  globToRegExp,
  globsIntersect,
  intersectionWitness,
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
