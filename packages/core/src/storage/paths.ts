import { join } from "node:path";

/**
 * Layout of the per-repo `.scopelock/` directory. Single source of truth:
 * CLI, hooks and MCP must never hardcode these paths.
 */
export type ScopelockPaths = {
  root: string;
  dir: string;
  configPath: string;
  contractsDir: string;
  reportsDir: string;
  hooksDir: string;
  activePath: string;
  gitignorePath: string;
};

export function scopelockPaths(repoRoot: string): ScopelockPaths {
  const dir = join(repoRoot, ".scopelock");
  return {
    root: repoRoot,
    dir,
    configPath: join(dir, "config.json"),
    contractsDir: join(dir, "contracts"),
    reportsDir: join(dir, "reports"),
    hooksDir: join(dir, "hooks"),
    activePath: join(dir, "active"),
    gitignorePath: join(dir, ".gitignore"),
  };
}

/**
 * Contracts are shared artifacts and should be committed; reports and the
 * active pointer are per-machine working state.
 */
export const SCOPELOCK_GITIGNORE = `reports/
active
`;
