import type { ChangedFile, GitFileStatus } from "../schemas/drift.js";
import { runGitAsync } from "./exec.js";

function statusFromCode(code: string): GitFileStatus {
  if (code.startsWith("R")) return "renamed";
  if (code.startsWith("C")) return "copied";
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  return "modified";
}

function parseNameStatus(raw: Buffer): ChangedFile[] {
  const tokens = raw
    .toString("utf8")
    .split("\0")
    .filter((token) => token.length > 0);
  const files: ChangedFile[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const code = tokens[index] ?? "";
    if (code.startsWith("R") || code.startsWith("C")) {
      const previousPath = tokens[index + 1] ?? "";
      const path = tokens[index + 2] ?? "";
      index += 2;
      files.push({
        path,
        previousPath,
        status: statusFromCode(code),
        stage: "staged",
        isBinary: false,
        insertions: 0,
        deletions: 0,
        sizeBytes: 0,
      });
      continue;
    }

    const path = tokens[index + 1] ?? "";
    index += 1;
    files.push({
      path,
      previousPath: null,
      status: statusFromCode(code),
      stage: "staged",
      isBinary: false,
      insertions: 0,
      deletions: 0,
      sizeBytes: 0,
    });
  }

  return files.filter((file) => file.path.length > 0);
}

function parseNumstat(raw: Buffer): Map<string, Pick<ChangedFile, "insertions" | "deletions" | "isBinary">> {
  const tokens = raw.toString("utf8").split("\0");
  const stats = new Map<string, Pick<ChangedFile, "insertions" | "deletions" | "isBinary">>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.length === 0) continue;

    const [insertionsRaw, deletionsRaw, pathRaw = ""] = token.split("\t");
    const isBinary = insertionsRaw === "-" || deletionsRaw === "-";
    const stat = {
      insertions: isBinary ? 0 : Number(insertionsRaw),
      deletions: isBinary ? 0 : Number(deletionsRaw),
      isBinary,
    };

    if (pathRaw.length > 0) {
      stats.set(pathRaw, stat);
      continue;
    }

    const newPath = tokens[index + 2];
    if (newPath !== undefined && newPath.length > 0) {
      stats.set(newPath, stat);
      index += 2;
    }
  }

  return stats;
}

export async function changedSinceBaseline(
  cwd: string,
  baselineSha: string,
): Promise<ChangedFile[]> {
  const nameStatus = await runGitAsync(
    ["diff", "--name-status", "-z", "-M", "-C", `${baselineSha}..HEAD`],
    cwd,
  );
  if (!nameStatus.ok) {
    throw new Error(nameStatus.stderr || "git diff --name-status failed");
  }

  const files = parseNameStatus(nameStatus.stdout);
  const numstat = await runGitAsync(
    ["diff", "--numstat", "-z", `${baselineSha}..HEAD`],
    cwd,
  );
  if (!numstat.ok) return files;

  const stats = parseNumstat(numstat.stdout);
  return files.map((file) => ({ ...file, ...stats.get(file.path) }));
}
