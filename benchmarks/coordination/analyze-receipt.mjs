#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function parseCodexUsage(stdout) {
  const lines = String(stdout ?? "").trim().split("\n").reverse();
  for (const line of lines) {
    if (!line.includes('"turn.completed"')) continue;
    try {
      const usage = JSON.parse(line).usage;
      if (usage && typeof usage === "object") return usage;
    } catch {
      // Ignore non-JSON tool output around Codex NDJSON events.
    }
  }
  return null;
}

function mergeUsage(usages) {
  const total = {};
  for (const usage of usages.filter(Boolean)) {
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value === "number") total[key] = (total[key] ?? 0) + value;
    }
  }
  return Object.keys(total).length > 0 ? total : null;
}

export function analyzeReceipt(receipt, source = "<memory>") {
  if (!receipt || typeof receipt !== "object" || !Array.isArray(receipt.taskRuns)) {
    throw new Error(`${source}: receipt must contain taskRuns[]`);
  }

  const totalBytes = jsonBytes(receipt);
  const taskRunsBytes = jsonBytes(receipt.taskRuns);
  const commandBytes = sum(receipt.taskRuns.map((task) => jsonBytes(task.command ?? null)));
  const stdoutBytes = sum(receipt.taskRuns.map((task) => jsonBytes(task.stdout ?? "")));
  const stderrBytes = sum(receipt.taskRuns.map((task) => jsonBytes(task.stderr ?? "")));
  const taskMetadataBytes = taskRunsBytes - commandBytes - stdoutBytes - stderrBytes;
  const coordinationBytes = sum([
    jsonBytes(receipt.waves ?? []),
    jsonBytes(receipt.conflicts ?? []),
    jsonBytes(receipt.cycles ?? []),
    jsonBytes(receipt.deferredTasks ?? []),
  ]);
  const driftBytes = jsonBytes(receipt.drift ?? null);
  const rootMetadataBytes = totalBytes - taskRunsBytes - coordinationBytes - driftBytes;

  const tasks = receipt.taskRuns.map((task) => ({
    id: task.id,
    status: task.status,
    bytes: jsonBytes(task),
    commandBytes: jsonBytes(task.command ?? null),
    stdoutBytes: jsonBytes(task.stdout ?? ""),
    stderrBytes: jsonBytes(task.stderr ?? ""),
    usage: parseCodexUsage(task.stdout),
  }));

  return {
    source,
    planId: receipt.planId ?? null,
    schemaVersion: receipt.schemaVersion ?? null,
    totalBytes,
    taskCount: tasks.length,
    categories: {
      commands: commandBytes,
      stdout: stdoutBytes,
      stderr: stderrBytes,
      taskMetadata: taskMetadataBytes,
      coordination: coordinationBytes,
      drift: driftBytes,
      rootMetadata: rootMetadataBytes,
    },
    usage: mergeUsage(tasks.map((task) => task.usage)),
    largestTask: tasks.toSorted((a, b) => b.bytes - a.bytes)[0] ?? null,
    tasks,
  };
}

export function summarizeAnalyses(analyses) {
  if (analyses.length === 0) throw new Error("at least one receipt is required");
  const values = analyses.map((analysis) => analysis.totalBytes);
  return {
    receipts: analyses.length,
    totalBytes: sum(values),
    averageBytes: Math.round(sum(values) / values.length),
    minBytes: Math.min(...values),
    maxBytes: Math.max(...values),
    usage: mergeUsage(analyses.map((analysis) => analysis.usage)),
  };
}

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function humanReport(analyses, summary) {
  const lines = [];
  for (const analysis of analyses) {
    lines.push(`Receipt: ${analysis.source}`);
    lines.push(`  size: ${formatBytes(analysis.totalBytes)}; tasks: ${analysis.taskCount}`);
    for (const [category, bytes] of Object.entries(analysis.categories)) {
      const percentage = analysis.totalBytes === 0 ? 0 : Math.round((bytes / analysis.totalBytes) * 100);
      lines.push(`  ${category}: ${formatBytes(bytes)} (${percentage}%)`);
    }
    if (analysis.largestTask) {
      lines.push(`  largest task: ${analysis.largestTask.id} (${formatBytes(analysis.largestTask.bytes)})`);
    }
  }
  if (analyses.length > 1) {
    lines.push(`Average: ${formatBytes(summary.averageBytes)} (${summary.receipts} receipts)`);
    lines.push(`Range: ${formatBytes(summary.minBytes)} - ${formatBytes(summary.maxBytes)}`);
  }
  if (summary.usage) lines.push(`Usage: ${JSON.stringify(summary.usage)}`);
  return lines.join("\n");
}

function main(argv) {
  const json = argv.includes("--json");
  const paths = argv.filter((arg) => arg !== "--json");
  if (paths.length === 0) throw new Error("usage: analyze-receipt.mjs [--json] <receipt...>");
  const analyses = paths.map((path) => analyzeReceipt(JSON.parse(readFileSync(path, "utf8")), path));
  const summary = summarizeAnalyses(analyses);
  process.stdout.write(json
    ? `${JSON.stringify({ summary, receipts: analyses }, null, 2)}\n`
    : `${humanReport(analyses, summary)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
