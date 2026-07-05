import { readFile } from "node:fs/promises";
import {
  findRepoRoot,
  getActiveContractId,
  gitVersion,
  hasScopeLockHooks,
  hooksConfigPath,
  loadContract,
  runGit,
  scopelockConfigSchema,
  scopelockPaths,
} from "@scopelock/core";
import type { CommandResult } from "../run.js";

type Check = {
  name: string;
  ok: boolean;
  severity: "error" | "warn";
  detail: string | null;
  fix: string | null;
};

function pass(name: string, detail: string | null = null): Check {
  return { name, ok: true, severity: "warn", detail, fix: null };
}

function fail(
  name: string,
  severity: "error" | "warn",
  detail: string,
  fix: string,
): Check {
  return { name, ok: false, severity, detail, fix };
}

export async function doctorCommand(): Promise<CommandResult> {
  const cwd = process.cwd();
  const checks: Check[] = [];

  const git = gitVersion(cwd);
  checks.push(
    git !== null
      ? pass("git-available", git)
      : fail("git-available", "error", "git executable not found", "install git"),
  );

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push(
    nodeMajor >= 22
      ? pass("node-version", `node ${process.versions.node}`)
      : fail(
          "node-version",
          "warn",
          `node ${process.versions.node} is below the supported 22.x`,
          "use Node 22 or newer",
        ),
  );

  const root = git !== null ? findRepoRoot(cwd) : null;
  checks.push(
    root !== null
      ? pass("inside-git-repo", root)
      : fail(
          "inside-git-repo",
          "error",
          "current directory is not inside a git repository",
          "run scopelock inside a git repository",
        ),
  );

  const paths = scopelockPaths(root ?? cwd);
  let initialized = false;
  try {
    const raw = await readFile(paths.configPath, "utf8");
    scopelockConfigSchema.parse(JSON.parse(raw));
    initialized = true;
    checks.push(pass("config-valid", paths.configPath));
  } catch (error) {
    const missing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    checks.push(
      missing
        ? fail(
            "config-valid",
            "warn",
            ".scopelock/config.json not found",
            "run `scopelock init`",
          )
        : fail(
            "config-valid",
            "error",
            `.scopelock/config.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
            "fix or delete the file and re-run `scopelock init`",
          ),
    );
  }

  if (initialized) {
    const activeId = await getActiveContractId(paths);
    if (activeId === null) {
      checks.push(
        fail(
          "active-contract",
          "warn",
          "no active approved contract",
          "approve a contract with `scopelock approve <file>`",
        ),
      );
    } else {
      try {
        const contract = await loadContract(paths, activeId);
        checks.push(pass("active-contract", activeId));
        if (contract.baseline === null) {
          checks.push(
            fail(
              "active-baseline",
              "error",
              "active contract has no baseline",
              "re-approve the contract with `scopelock approve <file>`",
            ),
          );
        } else if (root === null) {
          checks.push(
            fail(
              "active-baseline",
              "error",
              "cannot verify baseline outside a git repository",
              "run doctor inside the repository",
            ),
          );
        } else {
          const baseline = runGit(
            ["cat-file", "-e", `${contract.baseline.headSha}^{commit}`],
            root,
          );
          checks.push(
            baseline.ok
              ? pass("active-baseline", contract.baseline.headSha)
              : fail(
                  "active-baseline",
                  "error",
                  `baseline commit not found: ${contract.baseline.headSha}`,
                  "approve the contract again from an existing commit",
                ),
          );
        }
      } catch (error) {
        checks.push(
          fail(
            "active-contract",
            "error",
            `active contract is invalid: ${error instanceof Error ? error.message : String(error)}`,
            "fix or re-approve the contract",
          ),
        );
      }
    }

    if (root !== null) {
      for (const target of ["claude", "cursor"] as const) {
        const hookPath = hooksConfigPath(root, target);
        try {
          const raw = await readFile(hookPath, "utf8");
          const parsed: unknown = JSON.parse(raw);
          const ok =
            typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            hasScopeLockHooks(parsed as Record<string, unknown>, target);
          checks.push(
            ok
              ? pass(`${target}-hooks`, hookPath)
              : fail(
                  `${target}-hooks`,
                  "warn",
                  `ScopeLock hook entry not found in ${hookPath}`,
                  `run \`scopelock hooks install --target ${target}\``,
                ),
          );
        } catch (error) {
          const missing =
            error instanceof Error && "code" in error && error.code === "ENOENT";
          checks.push(
            missing
              ? fail(
                  `${target}-hooks`,
                  "warn",
                  `${hookPath} not found`,
                  `run \`scopelock hooks install --target ${target}\``,
                )
              : fail(
                  `${target}-hooks`,
                  "error",
                  `cannot read hook config: ${error instanceof Error ? error.message : String(error)}`,
                  "fix hook JSON before installing ScopeLock hooks",
                ),
          );
        }
      }
    }
  }

  const failedErrors = checks.filter((c) => !c.ok && c.severity === "error");
  const human = checks
    .map((c) => {
      const mark = c.ok ? "ok  " : c.severity === "error" ? "FAIL" : "warn";
      const fix = c.fix !== null ? ` -> ${c.fix}` : "";
      const detail = c.detail !== null ? ` (${c.detail})` : "";
      return `${mark} ${c.name}${detail}${fix}`;
    })
    .join("\n");

  return {
    data: { checks },
    human,
    exitCode: failedErrors.length > 0 ? 1 : 0,
  };
}
