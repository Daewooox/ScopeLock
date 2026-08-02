import test from "node:test";
import assert from "node:assert/strict";
import { aggregateBenchmarkMetrics } from "./benchmark-metrics.mjs";

test("aggregates rates and keeps zero denominators honest", () => {
  const result = aggregateBenchmarkMetrics([
    {
      mode: "without_scopelock",
      unsafeAttempts: 2,
      unsafePromotions: 2,
      safeTaskAttempts: 4,
      safeTaskBlocks: 0,
      attemptedTasks: 6,
      acceptedTasks: 4,
      wallClockMs: 100,
      baselineWallClockMs: 100,
    },
    {
      mode: "protected",
      unsafeAttempts: 2,
      unsafePromotions: 0,
      safeTaskAttempts: 4,
      safeTaskBlocks: 1,
      attemptedTasks: 6,
      acceptedTasks: 5,
      wallClockMs: 150,
      baselineWallClockMs: 100,
    },
  ]);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.overall.rates.unsafePromotionRate, 0.5);
  assert.equal(result.overall.rates.benignBlockRate, 0.125);
  assert.equal(result.overall.rates.acceptedTaskRate, 0.75);
  assert.equal(result.overall.rates.runtimeOverhead, 1.25);
  assert.equal(result.byMode.protected.rates.unsafePromotionRate, 0);
});

test("separates modes and reports median and p95 without a statistics dependency", () => {
  const result = aggregateBenchmarkMetrics([
    { mode: "protected", wallClockMs: 10, manualInterventions: 0 },
    { mode: "protected", wallClockMs: 20, manualInterventions: 1 },
    { mode: "protected", wallClockMs: 30, manualInterventions: 2 },
    { mode: "baseline", wallClockMs: 5 },
  ]);

  assert.deepEqual(result.byMode.protected.distributions.wallClockMs, { median: 20, p95: 30 });
  assert.equal(result.byMode.protected.distributions.manualInterventions.median, 1);
  assert.equal(result.byMode.baseline.runs, 1);
});

test("preserves blocked harnesses as blocked evidence", () => {
  const result = aggregateBenchmarkMetrics([
    { mode: "claude", harnessStatus: "blocked", attemptedTasks: 1 },
  ]);

  assert.equal(result.overall.counts.blockedHarnessRuns, 1);
  assert.equal(result.overall.rates.acceptedTaskRate, null);
});

test("rejects malformed top-level input", () => {
  assert.throws(() => aggregateBenchmarkMetrics(null), /must be an array/);
});
