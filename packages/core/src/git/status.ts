import type { ChangedFile, GitFileStatus, GitStage } from "../schemas/drift.js";

function splitNul(raw: Buffer): string[] {
  return raw
    .toString("utf8")
    .split("\0")
    .filter((part) => part.length > 0);
}

function stageFromRecord(kind: string, xy: string): GitStage {
  if (kind === "?") return "untracked";
  if (kind === "u") return "conflicted";
  return xy[0] !== "." ? "staged" : "unstaged";
}

function statusFromRecord(kind: string, xy: string): GitFileStatus {
  if (kind === "?") return "untracked";
  if (kind === "u") return "conflicted";
  if (xy.includes("R")) return "renamed";
  if (xy.includes("C")) return "copied";
  if (xy.includes("A")) return "added";
  if (xy.includes("D")) return "deleted";
  return "modified";
}

function changedFile(input: {
  path: string;
  previousPath?: string | null;
  kind: string;
  xy: string;
}): ChangedFile {
  return {
    path: input.path,
    previousPath: input.previousPath ?? null,
    status: statusFromRecord(input.kind, input.xy),
    stage: stageFromRecord(input.kind, input.xy),
    isBinary: false,
    insertions: 0,
    deletions: 0,
    sizeBytes: 0,
  };
}

export function parsePorcelainV2(raw: Buffer): ChangedFile[] {
  const records = splitNul(raw);
  const files: ChangedFile[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length === 0) continue;

    const kind = record[0];
    if (kind === "?") {
      files.push(changedFile({ path: record.slice(2), kind, xy: "??" }));
      continue;
    }

    const parts = record.split(" ");
    const xy = parts[1] ?? "..";

    if (kind === "1") {
      files.push(
        changedFile({
          path: parts.slice(8).join(" "),
          kind,
          xy,
        }),
      );
      continue;
    }

    if (kind === "2") {
      files.push(
        changedFile({
          path: parts.slice(9).join(" "),
          previousPath: records[index + 1] ?? null,
          kind,
          xy,
        }),
      );
      index += 1;
      continue;
    }

    if (kind === "u") {
      files.push(
        changedFile({
          path: parts.slice(10).join(" "),
          kind,
          xy,
        }),
      );
    }
  }

  return files.filter((file) => file.path.length > 0);
}
