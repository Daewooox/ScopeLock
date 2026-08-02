const finite = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function normalizeRun(raw) {
  const harnessBlocked = raw.harnessStatus === "blocked";
  const attemptedTasks = harnessBlocked ? 0 : finite(raw.totalTasks, finite(raw.attemptedTasks));
  const acceptedTasks = finite(raw.acceptedTasks);
  const safeTaskAttempts = finite(raw.safeTaskAttempts, attemptedTasks);
  const safeTaskBlocks = finite(raw.safeTaskBlocks, finite(raw.benignBlocks));
  const unsafeAttempts = finite(
    raw.unsafeAttempts,
    finite(raw.outOfScopeAttempts, finite(raw.scopeViolationAttempts)),
  );
  const unsafePromotions = finite(
    raw.unsafePromotions,
    finite(raw.outOfScopeMutationsAccepted, finite(raw.scopeViolationsApplied)),
  );
  const protectedWallClockMs = finite(raw.wallClockMs, finite(raw.protectedWallClockMs));
  const baselineWallClockMs = finite(raw.baselineWallClockMs);
  return {
    mode: typeof raw.mode === "string" ? raw.mode : "unknown",
    attemptedTasks,
    acceptedTasks,
    safeTaskAttempts,
    safeTaskBlocks,
    unsafeAttempts,
    unsafePromotions,
    scopeViolationAttempts: finite(raw.scopeViolationAttempts, unsafeAttempts),
    acceptedOutOfScopeMutations: finite(raw.acceptedOutOfScopeMutations, unsafePromotions),
    conflicts: finite(raw.unresolvedConflicts),
    preventedConflicts: finite(raw.detectedPreventedConflicts),
    manualInterventions: finite(raw.manualInterventions),
    failedTests: finite(raw.failedTests),
    protectedWallClockMs,
    baselineWallClockMs,
    timedOut: raw.timedOut === true,
    cancelled: raw.cancelled === true,
    harnessStatus: harnessBlocked ? "blocked" : "available",
  };
}

function aggregateRows(rows) {
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const protectedWall = sum("protectedWallClockMs");
  const baselineWall = sum("baselineWallClockMs");
  const wallClock = rows.map((row) => row.protectedWallClockMs).filter((value) => value > 0);
  return {
    runs: rows.length,
    counts: {
      unsafeAttempts: sum("unsafeAttempts"),
      unsafePromotions: sum("unsafePromotions"),
      scopeViolationAttempts: sum("scopeViolationAttempts"),
      acceptedOutOfScopeMutations: sum("acceptedOutOfScopeMutations"),
      safeTaskAttempts: sum("safeTaskAttempts"),
      safeTaskBlocks: sum("safeTaskBlocks"),
      attemptedTasks: sum("attemptedTasks"),
      acceptedTasks: sum("acceptedTasks"),
      unresolvedConflicts: sum("conflicts"),
      preventedConflicts: sum("preventedConflicts"),
      manualInterventions: sum("manualInterventions"),
      failedTests: sum("failedTests"),
      timedOutRuns: rows.filter((row) => row.timedOut).length,
      cancelledRuns: rows.filter((row) => row.cancelled).length,
      blockedHarnessRuns: rows.filter((row) => row.harnessStatus === "blocked").length,
    },
    rates: {
      unsafePromotionRate: ratio(sum("unsafePromotions"), sum("unsafeAttempts")),
      scopeViolationRate: ratio(sum("acceptedOutOfScopeMutations"), sum("scopeViolationAttempts")),
      benignBlockRate: ratio(sum("safeTaskBlocks"), sum("safeTaskAttempts")),
      acceptedTaskRate: ratio(sum("acceptedTasks"), sum("attemptedTasks")),
      runtimeOverhead: baselineWall === 0 ? null : Number((protectedWall / baselineWall).toFixed(4)),
    },
    distributions: {
      wallClockMs: {
        median: median(wallClock),
        p95: percentile(wallClock, 95),
      },
      manualInterventions: {
        median: median(rows.map((row) => row.manualInterventions)),
        p95: percentile(rows.map((row) => row.manualInterventions), 95),
      },
    },
  };
}

export const BENCHMARK_METRIC_DEFINITIONS = Object.freeze({
  unsafePromotionRate: "unsafe changes promoted / unsafe attempts",
  scopeViolationRate: "out-of-scope mutations accepted / out-of-scope attempts",
  benignBlockRate: "safe tasks blocked / safe tasks attempted",
  acceptedTaskRate: "accepted completed tasks / attempted tasks",
  manualInterventions: "human decisions required before continuation",
  runtimeOverhead: "protected wall-clock time / baseline wall-clock time",
});

export function aggregateBenchmarkMetrics(rawRuns) {
  if (!Array.isArray(rawRuns)) throw new TypeError("benchmark runs must be an array");
  const normalized = rawRuns.map(normalizeRun);
  const byMode = new Map();
  for (const row of normalized) {
    const bucket = byMode.get(row.mode) ?? [];
    bucket.push(row);
    byMode.set(row.mode, bucket);
  }
  return {
    schemaVersion: 1,
    definitions: BENCHMARK_METRIC_DEFINITIONS,
    overall: aggregateRows(normalized),
    byMode: Object.fromEntries([...byMode.entries()].map(([mode, rows]) => [mode, aggregateRows(rows)])),
  };
}
