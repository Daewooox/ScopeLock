import { readFile, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  approvedContractSchema,
  buildConflictGraph,
  buildDriftReport,
  collectChangedFiles,
  commitExists,
  driftReportFileName,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  schedule,
  schedulePlanSchema,
  scopelockConfigSchema,
  scopelockPaths,
  scopesConflict,
  verifyApprovalSeal,
  writeJsonAtomic,
  type ApprovedContract,
  type SchedulePlan,
  type TaskScope,
} from "@scopelock/core";
import { join } from "node:path";
import { z } from "zod/v4";

export const SERVER_NAME = "scopelock";
export const SERVER_VERSION = "0.1.0";

const taskScopeInputSchema = z.object({
  id: z.string().min(1),
  planned: z.array(z.string().min(1)),
  forbidden: z.array(z.string().min(1)).default([]),
  read: z.array(z.string().min(1)).default([]),
});

const planParallelInputSchema = {
  plan: z.unknown().describe("A ScopeLock schedule plan JSON object."),
  includeReadHazards: z.boolean().optional().default(false),
};

const scopesConflictInputSchema = {
  a: taskScopeInputSchema,
  b: taskScopeInputSchema,
};

const checkDriftInputSchema = {
  base: z.string().min(1).optional(),
};

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function resolveFromRoot(repoRoot: string, path: string): string {
  if (isAbsolute(path)) {
    throw new Error("contract paths must be relative to the MCP server repo root");
  }
  const resolved = resolve(repoRoot, path);
  const rel = relative(repoRoot, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("contract path escapes the MCP server repo root");
  }
  return resolved;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadTaskScope(repoRoot: string, task: SchedulePlan["tasks"][number]): Promise<TaskScope> {
  const contractPath = await realpath(resolveFromRoot(repoRoot, task.contract));
  const rel = relative(repoRoot, contractPath);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("contract path resolves outside the MCP server repo root");
  }
  const raw = await readJsonFile(contractPath);
  const contract = approvedContractSchema.parse(raw);
  return scopeFromContract(task.id, contract);
}

function scopeFromContract(id: string, contract: ApprovedContract): TaskScope {
  return {
    id,
    planned: contract.scope.plannedPathPatterns,
    forbidden: contract.scope.forbiddenPathPatterns,
    read: contract.scope.readPathPatterns,
  };
}

async function loadConfig(paths: ReturnType<typeof scopelockPaths>) {
  try {
    const raw = await readFile(paths.configPath, "utf8");
    return scopelockConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return scopelockConfigSchema.parse({ schemaVersion: 1 });
    }
    throw error;
  }
}

function requireRepoRoot(candidate?: string): string {
  const root = findRepoRoot(candidate ?? process.cwd());
  if (root === null) {
    throw new Error("ScopeLock MCP tools must run inside a git repository");
  }
  return realpathSync(root);
}

export async function planParallelTool(input: {
  plan: unknown;
  includeReadHazards?: boolean;
}, serverRepoRoot?: string) {
  const repoRoot = requireRepoRoot(serverRepoRoot);
  const plan = schedulePlanSchema.parse(input.plan);
  const scopes: TaskScope[] = [];
  for (const task of plan.tasks) {
    scopes.push(await loadTaskScope(repoRoot, task));
  }

  const graph = buildConflictGraph(scopes, { readHazards: input.includeReadHazards === true });
  const result = schedule(graph);
  return {
    planId: plan.planId,
    waves: result.waves,
    conflicts: graph.conflicts,
    cycles: result.cycles,
  };
}

export function scopesConflictTool(input: { a: TaskScope; b: TaskScope }) {
  const a = taskScopeInputSchema.parse(input.a);
  const b = taskScopeInputSchema.parse(input.b);
  const conflict = scopesConflict(a, b);
  return {
    conflict: conflict !== null,
    detail: conflict,
  };
}

export async function checkDriftTool(input: { base?: string } = {}, serverRepoRoot?: string) {
  const repoRoot = requireRepoRoot(serverRepoRoot);
  const paths = scopelockPaths(repoRoot);
  const config = await loadConfig(paths);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new Error("no active approved contract; approve one with `scopelock contract approve <file>`");
  }

  const contract = await loadContract(paths, activeId);
  const approvalIntegrity = await verifyApprovalSeal(repoRoot, contract);
  if (!approvalIntegrity.ok) {
    throw new Error(`approval integrity failed: ${approvalIntegrity.detail}`);
  }
  const baselineSha = input.base ?? contract.baseline?.headSha ?? null;
  if (baselineSha === null) {
    throw new Error("active contract has no baseline; approve it with `scopelock contract approve <file>`");
  }
  if (!commitExists(repoRoot, baselineSha)) {
    throw new Error(
      `baseline commit ${baselineSha} not found (history rewritten?); run \`scopelock contract rebaseline\``,
    );
  }

  const collected = await collectChangedFiles(repoRoot, baselineSha, {
    degradedThreshold: config.degradedFileThreshold,
  });
  const checkedAt = new Date().toISOString();
  const report = buildDriftReport({
    contract,
    files: collected.files,
    repoState: collected.repoState,
    repoMode: collected.repoMode,
    projectTypes: config.projectTypes,
    checkedAt,
  });
  const reportPath = join(paths.reportsDir, driftReportFileName(checkedAt));
  await writeJsonAtomic(reportPath, report);

  return {
    ok: report.violations.length === 0,
    reportPath,
    report,
  };
}

export function createScopeLockMcpServer(repoRoot = requireRepoRoot()): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "plan_parallel",
    {
      title: "Plan Parallel",
      description:
        "Build a deterministic ScopeLock wave schedule from a plan JSON object and draft/approved contract files.",
      inputSchema: planParallelInputSchema,
    },
    async (input) => jsonContent(await planParallelTool(input, repoRoot)),
  );

  server.registerTool(
    "scopes_conflict",
    {
      title: "Scopes Conflict",
      description: "Check whether two ScopeLock task scopes conflict and return the concrete witness.",
      inputSchema: scopesConflictInputSchema,
    },
    async (input) => jsonContent(scopesConflictTool(input)),
  );

  server.registerTool(
    "check_drift",
    {
      title: "Check Drift",
      description:
        "Run ScopeLock drift verification for the active approved contract in a git repository.",
      inputSchema: checkDriftInputSchema,
    },
    async (input) => jsonContent(await checkDriftTool(input, repoRoot)),
  );

  return server;
}
