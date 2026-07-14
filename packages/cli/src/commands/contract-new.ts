import { join, isAbsolute } from "node:path";
import {
  CONTRACT_SCHEMA_VERSION,
  approvedContractSchema,
  writeJsonAtomic,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "contract";
}

/**
 * Deterministic contract scaffolder: no LLM. Emits a schema-valid draft
 * contract (baseline is stamped later by `scopelock contract approve`). Prints JSON to
 * stdout by default so it is pipeable (`scopelock contract new ... > c.json`),
 * or writes a file with --out.
 */
export async function contractNewCommand(options: {
  task: string;
  id?: string;
  planned?: string[];
  allowAll?: boolean;
  forbidden?: string[];
  read?: string[];
  agent?: string[];
  test?: string[];
  out?: string;
}, cwd: string = process.cwd()): Promise<CommandResult> {
  if (options.task.trim().length === 0) {
    throw new CliError("MISSING_TASK", "contract new requires a non-empty --task");
  }
  if ((options.planned?.length ?? 0) === 0 && options.allowAll !== true) {
    throw new CliError(
      "MISSING_SCOPE",
      "contract new requires at least one --planned glob or explicit --allow-all",
    );
  }

  const date = new Date();
  const id = options.id ?? `${slugify(options.task)}-${date.toISOString().slice(0, 10)}`;

  const contract = approvedContractSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id,
    task: options.task,
    createdAt: date.toISOString(),
    baseline: null,
    targetAgents: options.agent ?? [],
    scope: {
      plannedPathPatterns: options.planned ?? [],
      forbiddenPathPatterns: options.forbidden ?? [],
      allowAllPaths: options.allowAll === true,
      readPathPatterns: options.read ?? [],
    },
    tests: (options.test ?? []).map((type) => ({ type, command: null, required: true })),
  });

  const pretty = JSON.stringify(contract, null, 2);

  if (options.out !== undefined) {
    const outPath = isAbsolute(options.out)
      ? options.out
      : join(cwd, options.out);
    await writeJsonAtomic(outPath, contract);
    return {
      data: { contract, path: outPath },
      human: renderSections([
        { title: "Context", lines: `Task  ${options.task}` },
        { title: "Result", lines: [`Draft created  ${outPath}`, "Approved       no"] },
        { title: "Next", lines: `Review it, then run: scopelock contract approve ${JSON.stringify(options.out)}` },
      ]),
      exitCode: 0,
    };
  }

  return {
    data: { contract },
    human: pretty,
    exitCode: 0,
  };
}
