import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { realpath, stat, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectChangedFiles,
  commitExists,
  findRepoRoot,
  isRepoRelativeSafe,
  resolveRepoPath,
  toPosix,
} from "@mindthediff/core";

// `spawnProcessTree` lives in the CLI package; importing it locally avoids
// changing core just for an opt-in validation command.
import { createRunSignalCoordinator, spawnProcessTree } from "../process-tree.js";

export const SENSITIVE_ACCESS_PROFILE = "sensitive-local-files" as const;
export type SensitiveAccessProfile = typeof SENSITIVE_ACCESS_PROFILE;
export const SENSITIVE_ACCESS_ENGINE = "semgrep" as const;
export const SENSITIVE_ACCESS_ENGINE_VERSION = "1.171.0" as const;
export const SENSITIVE_ACCESS_RULE_PACK_SHA256 =
  "5197d46ad53bd1f8c22b4ba1c3963154558808c3e0c9dfd486bca973cc347f51" as const; // gitleaks:allow -- public SHA-256 digest of bundled rules

export type SensitiveAccessOutcome = "passed" | "not-applicable" | "denied" | "blocked";

export type SensitiveFinding = {
  ruleId: string;
  path: string;
  line: number;
  fingerprint: string;
};

export type SensitiveAccessResult = {
  profile: SensitiveAccessProfile;
  outcome: SensitiveAccessOutcome;
  baseSha: string;
  engine: typeof SENSITIVE_ACCESS_ENGINE;
  engineVersion: string | null;
  rulePackSha256: string | null;
  targets: string[];
  scanned: string[];
  findings: SensitiveFinding[];
  reason?: string;
};

export type ScanInput = {
  repoRoot: string;
  baseSha: string;
  profile?: string;
  semgrepPath?: string;
  timeoutMs?: number;
  /** Test-only argv prefix; production always invokes the semgrep executable directly. */
  semgrepArgsPrefix?: string[];
  rulesPath?: string;
  expectedEngineVersion?: string;
  expectedRulePackSha256?: string;
};

const supportedExtensions = new Set([".py", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const knownSourceExtensions = new Set([
  ...supportedExtensions,
  ".go", ".rs", ".java", ".kt", ".kts", ".swift", ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp",
  ".vue", ".svelte", ".astro", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".dart", ".ex", ".exs", ".scala", ".cs", ".fs", ".fsx", ".lua", ".r", ".sql", ".pl", ".jl",
  ".hs", ".clj", ".groovy", ".m", ".mm", ".html", ".htm", ".css", ".scss", ".sass", ".less",
]);
const ignoredExtensions = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini",
  ".lock", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".map",
]);
const ignoredFileNames = new Set(["README", "README.md", "CHANGELOG.md", "LICENSE", "NOTICE"]);
const outputLimitBytes = 4 * 1024 * 1024;
const defaultRulesPath = fileURLToPath(new URL("../../security/sensitive-local-files.yml", import.meta.url));

export type SensitiveScannerAttestation = {
  engine: typeof SENSITIVE_ACCESS_ENGINE;
  engineVersion: string;
  rulePackSha256: string;
};

function resultBase(input: ScanInput, outcome: SensitiveAccessOutcome, targets: string[] = []): SensitiveAccessResult {
  return {
    profile: SENSITIVE_ACCESS_PROFILE,
    outcome,
    baseSha: input.baseSha,
    engine: SENSITIVE_ACCESS_ENGINE,
    engineVersion: null,
    rulePackSha256: null,
    targets,
    scanned: [],
    findings: [],
  };
}

function blocked(input: ScanInput, reason: string, targets: string[] = []): SensitiveAccessResult {
  return { ...resultBase(input, "blocked", targets), reason };
}

function blockedResult(
  base: SensitiveAccessResult,
  reason: string,
  targets = base.targets,
  scanned = base.scanned,
): SensitiveAccessResult {
  return { ...base, outcome: "blocked", targets, scanned, findings: [], reason };
}

function normalizeTarget(raw: string): string | null {
  if (!raw || raw.includes("\0")) return null;
  const normalized = toPosix(raw);
  if (!isRepoRelativeSafe(normalized)) return null;
  const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  return segments.join("/");
}

function isSupportedSource(path: string): boolean {
  return supportedExtensions.has(extname(path).toLowerCase());
}

function isIgnoredPath(path: string): boolean {
  const name = path.split("/").at(-1) ?? path;
  if (ignoredFileNames.has(name)) return true;
  if (path.startsWith("dist/") || path.startsWith("build/") || path.startsWith("coverage/") || path.includes("/generated/")) {
    return true;
  }
  return ignoredExtensions.has(extname(path).toLowerCase());
}

async function safeTarget(repoRoot: string, path: string): Promise<boolean> {
  const absolute = resolveRepoPath(repoRoot, path);
  const rootReal = await realpath(repoRoot);
  const entry = await lstat(absolute);
  if (entry.isSymbolicLink() || !entry.isFile()) return false;
  const targetReal = await realpath(absolute);
  const rel = relative(rootReal, targetReal);
  return rel.length > 0 && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}

async function changedTargets(input: ScanInput): Promise<
  { targets: string[]; blockedReason?: string }
> {
  if (!/^[a-f0-9]{40}$/u.test(input.baseSha) || !commitExists(input.repoRoot, input.baseSha)) {
    return { targets: [], blockedReason: "baseline is not a full commit SHA in this repository" };
  }
  let files: Awaited<ReturnType<typeof collectChangedFiles>>["files"];
  try {
    files = (await collectChangedFiles(input.repoRoot, input.baseSha)).files;
  } catch (error) {
    return { targets: [], blockedReason: error instanceof Error ? error.message : "cannot enumerate changed files" };
  }

  const targets: string[] = [];
  for (const file of files) {
    if (file.status === "deleted") continue;
    const path = normalizeTarget(file.path);
    if (path === null) return { targets, blockedReason: `unsafe changed path: ${file.path}` };
    if (file.isBinary) continue;
    if (isIgnoredPath(path)) continue;
    if (!knownSourceExtensions.has(extname(path).toLowerCase())) {
      return { targets, blockedReason: `unsupported changed source language: ${path}` };
    }
    if (!isSupportedSource(path)) {
      return { targets, blockedReason: `unsupported changed source language: ${path}` };
    }
    try {
      if (!(await safeTarget(input.repoRoot, path))) {
        return { targets, blockedReason: `changed source target is not a safe regular file: ${path}` };
      }
      const entry = await stat(resolveRepoPath(input.repoRoot, path));
      if (entry.size > 20 * 1024 * 1024) {
        return { targets, blockedReason: `changed source target is too large to scan: ${path}` };
      }
    } catch {
      return { targets, blockedReason: `cannot read changed source target: ${path}` };
    }
    targets.push(path);
  }
  return { targets: [...new Set(targets)].sort() };
}

function appendOutput(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current, "utf8") >= outputLimitBytes) return current;
  const remaining = outputLimitBytes - Buffer.byteLength(current, "utf8");
  return current + chunk.toString("utf8", 0, remaining);
}

function normalizeScannedPath(raw: unknown): string | null {
  return typeof raw === "string" ? normalizeTarget(raw) : null;
}

function normalizeRuleId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const known = [
    "python.sensitive-local-file-read",
    "javascript-typescript.sensitive-local-file-read",
  ];
  const match = known.find((id) => raw === id || raw.endsWith("." + id) || raw.endsWith("/" + id));
  if (match !== undefined) return match;
  return /^[a-z0-9][a-z0-9._-]*$/u.test(raw) ? raw : null;
}

export function parseSensitiveSemgrepOutput(
  raw: string,
  targets: string[],
  base: SensitiveAccessResult,
): SensitiveAccessResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blockedResult(base, "scanner returned malformed JSON", targets);
  }
  if (typeof parsed !== "object" || parsed === null) return blockedResult(base, "scanner JSON must be an object", targets);
  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.errors)) return blockedResult(base, "scanner errors must be an array", targets);
  if (value.errors.length > 0) return blockedResult(base, "scanner returned errors", targets);
  if (!Array.isArray(value.results)) return blockedResult(base, "scanner results must be an array", targets);
  const paths = value.paths;
  if (typeof paths !== "object" || paths === null || !Array.isArray((paths as Record<string, unknown>).scanned)) {
    return blockedResult(base, "scanner did not report paths.scanned", targets);
  }
  const scanned: string[] = [];
  for (const item of (paths as { scanned: unknown[] }).scanned) {
    const path = normalizeScannedPath(item);
    if (path === null) return blockedResult(base, "scanner reported an unsafe scanned path", targets);
    scanned.push(path);
  }
  const scannedSet = new Set(scanned);
  if (scannedSet.size !== targets.length || targets.some((target) => !scannedSet.has(target))) {
    return blockedResult(base, "scanner target coverage did not match the requested set", targets, scanned);
  }
  const findings: SensitiveFinding[] = [];
  for (const rawFinding of value.results) {
    if (typeof rawFinding !== "object" || rawFinding === null) return blockedResult(base, "scanner returned an invalid finding", targets, scanned);
    const finding = rawFinding as Record<string, unknown>;
    const path = normalizeScannedPath(finding.path);
    const start = finding.start;
    const line = typeof start === "object" && start !== null && typeof (start as Record<string, unknown>).line === "number"
      ? (start as { line: number }).line
      : null;
    const ruleId = normalizeRuleId(finding.check_id);
    if (path === null || line === null || !Number.isSafeInteger(line) || line < 1 || ruleId === null || !targets.includes(path)) {
      return blockedResult(base, "scanner returned an unsafe finding", targets, scanned);
    }
    const fingerprint = createHash("sha256").update(`${ruleId}\0${path}\0${line}`).digest("hex");
    findings.push({ ruleId, path, line, fingerprint });
  }
  findings.sort((a, b) => `${a.path}\0${a.line}\0${a.ruleId}`.localeCompare(`${b.path}\0${b.line}\0${b.ruleId}`));
  return {
    ...base,
    outcome: findings.length > 0 ? "denied" : "passed",
    targets,
    scanned: [...new Set(scanned)].sort(),
    findings,
  };
}

function parseSemgrepVersion(output: string): string | null {
  const match = output.match(/(?:semgrep\s+)?v?(\d+\.\d+\.\d+)/iu);
  return match?.[1] ?? null;
}

export function getSemgrepAttestation(
  path = "semgrep",
  rulesPath = defaultRulesPath,
): SensitiveScannerAttestation | null {
  const result = spawnSync(path, ["--version"], {
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  const engineVersion = parseSemgrepVersion(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (engineVersion === null) return null;
  let rulePackSha256: string;
  try {
    rulePackSha256 = createHash("sha256").update(readFileSync(rulesPath)).digest("hex");
  } catch {
    return null;
  }
  return {
    engine: SENSITIVE_ACCESS_ENGINE,
    engineVersion,
    rulePackSha256,
  };
}

export function isSemgrepAvailable(path = "semgrep"): boolean {
  return getSemgrepAttestation(path) !== null;
}

export async function runSensitiveAccessScan(input: ScanInput): Promise<SensitiveAccessResult> {
  if (input.profile !== undefined && input.profile !== SENSITIVE_ACCESS_PROFILE) {
    return blocked(input, `unsupported security profile: ${input.profile}`);
  }
  const root = findRepoRoot(input.repoRoot);
  if (root === null) return blocked(input, "repoRoot is not a repository root");
  try {
    if (await realpath(root) !== await realpath(input.repoRoot)) {
      return blocked(input, "repoRoot is not a repository root");
    }
  } catch {
    return blocked(input, "repoRoot is not a readable repository root");
  }
  const selection = await changedTargets(input);
  if (selection.blockedReason !== undefined) return blocked(input, selection.blockedReason, selection.targets);
  const targets = selection.targets;
  if (targets.length === 0) return { ...resultBase(input, "not-applicable"), targets };
  const semgrepPath = input.semgrepPath ?? "semgrep";
  const rulesPath = input.rulesPath ?? defaultRulesPath;
  const attestation = getSemgrepAttestation(semgrepPath, rulesPath);
  if (attestation === null) return blocked(input, "Semgrep is not available or could not be attested; install it and retry", targets);
  if (input.expectedEngineVersion !== undefined && attestation.engineVersion !== input.expectedEngineVersion) {
    return blocked(input, `Semgrep version mismatch: expected ${input.expectedEngineVersion}, got ${attestation.engineVersion}`, targets);
  }
  if (input.expectedRulePackSha256 !== undefined && attestation.rulePackSha256 !== input.expectedRulePackSha256) {
    return blocked(input, "Semgrep rule pack hash mismatch", targets);
  }
  const attestedBase = { ...resultBase(input, "passed", targets), ...attestation };
  const args = [
    ...(input.semgrepArgsPrefix ?? []),
    "scan", "--config", rulesPath, "--json", "--metrics", "off", "--disable-nosem", "--no-git-ignore", "--",
    ...targets,
  ];
  const tree = spawnProcessTree({
    command: [semgrepPath, ...args],
    cwd: input.repoRoot,
    env: process.env,
    gracefulTimeoutMs: 1_000,
  });
  const coordinator = createRunSignalCoordinator();
  const unregister = coordinator.register(tree);
  let stdout = "";
  tree.child.stdout?.on("data", (chunk) => { stdout = appendOutput(stdout, chunk); });
  tree.child.stderr?.on("data", () => {});
  const timeoutMs = input.timeoutMs ?? 30_000;
  const timer = setTimeout(() => tree.terminate("timeout"), timeoutMs);
  timer.unref();
  const termination = await tree.wait();
  clearTimeout(timer);
  unregister();
  coordinator.dispose();
  if (termination.reason === "timeout") return blocked(input, `scanner timed out after ${timeoutMs}ms`, targets);
  if (termination.reason !== null) return blocked(input, "scanner interrupted", targets);
  if (termination.exitCode !== 0) return blocked(input, "scanner exited unsuccessfully", targets);
  return parseSensitiveSemgrepOutput(stdout, targets, attestedBase);
}
