/**
 * `plan prepare --validation-command`/`--validation-setup-command` values are
 * themselves arbitrary child-tool argv (e.g. `uv run --frozen pytest`).
 * Commander's variadic `<argv...>` option stops collecting values as soon as
 * it sees a token starting with `-`, then tries to parse that token as a
 * *new* top-level ScopeLock option - so any option-like child token
 * (`--frozen`, `--group`, ...) breaks parsing with "unknown option" before
 * the command ever runs. Confirmed empirically against a real pinned Python
 * fixture (`pallets/click`) during the Pilot 4 readiness spike.
 *
 * Fix: extract these two flags' raw values from `process.argv` ourselves,
 * before Commander parses anything, stopping only at one of `plan prepare`'s
 * own known flags (or end of input) - never at an arbitrary `-`-prefixed
 * token. This makes every token between the flag and the next known flag
 * data, regardless of what it looks like.
 */
export const PLAN_PREPARE_KNOWN_FLAGS = new Set([
  "--target",
  "--out",
  "--manifest",
  "--no-read-hazards",
  "--json",
  "--validation-command",
  "--validation-setup-command",
  "--validation-cwd",
  "--validation-check",
  "--acceptance-check",
  "-h",
  "--help",
]);

export type ValidationCheckArgv = {
  id: string;
  command: string[];
};

export type PlanPrepareArgvExtraction = {
  validationCommand: string[] | undefined;
  validationSetupCommand: string[] | undefined;
  /**
   * One entry per `--validation-check <id> <argv...>` occurrence, in the
   * order given on the command line. Duplicate ids are intentionally NOT
   * rejected here - that is a schema-level concern (see Task 1's
   * `normalizePlanValidation`), which has the full picture of a plan's
   * validation checks (including any declared directly in plan JSON) and is
   * the right place to enforce uniqueness.
   */
  validationChecks: ValidationCheckArgv[] | undefined;
  /**
   * One id per `--acceptance-check <id>` occurrence. Duplicates are passed
   * through unchanged for the same reason as `validationChecks` above.
   */
  acceptanceChecks: string[] | undefined;
  rest: string[];
};

function extractFlagValues(
  argv: string[],
  flag: string,
): { value: string[] | undefined; rest: string[] } {
  const index = argv.indexOf(flag);
  if (index === -1) return { value: undefined, rest: argv };

  let end = index + 1;
  while (end < argv.length && !PLAN_PREPARE_KNOWN_FLAGS.has(argv[end])) end++;

  const value = argv.slice(index + 1, end);
  const rest = [...argv.slice(0, index), ...argv.slice(end)];
  return { value: value.length > 0 ? value : undefined, rest };
}

/**
 * Like `extractFlagValues`, but repeats the scan so every occurrence of
 * `flag` in `argv` is collected (not just the first). Each occurrence's
 * tokens are windowed the same way: everything up to the next known
 * ScopeLock flag (or end of input) belongs to that occurrence, including
 * option-like child tokens.
 */
function extractAllOccurrences(
  argv: string[],
  flag: string,
): { occurrences: string[][]; rest: string[] } {
  let rest = argv;
  const occurrences: string[][] = [];
  while (true) {
    const index = rest.indexOf(flag);
    if (index === -1) break;

    let end = index + 1;
    while (end < rest.length && !PLAN_PREPARE_KNOWN_FLAGS.has(rest[end])) end++;

    occurrences.push(rest.slice(index + 1, end));
    rest = [...rest.slice(0, index), ...rest.slice(end)];
  }
  return { occurrences, rest };
}

function extractValidationChecks(argv: string[]): {
  checks: ValidationCheckArgv[] | undefined;
  rest: string[];
} {
  const { occurrences, rest } = extractAllOccurrences(argv, "--validation-check");
  if (occurrences.length === 0) return { checks: undefined, rest };

  const checks = occurrences.map((tokens) => {
    if (tokens.length < 2) {
      throw new Error(
        "--validation-check requires an id followed by a command, e.g. " +
          "--validation-check <id> <argv...>",
      );
    }
    const [id, ...command] = tokens;
    return { id, command };
  });
  return { checks, rest };
}

function extractAcceptanceChecks(argv: string[]): {
  ids: string[] | undefined;
  rest: string[];
} {
  const { occurrences, rest } = extractAllOccurrences(argv, "--acceptance-check");
  if (occurrences.length === 0) return { ids: undefined, rest };

  const ids = occurrences.map((tokens) => {
    if (tokens.length !== 1) {
      throw new Error(
        "--acceptance-check requires exactly one id, e.g. --acceptance-check <id>",
      );
    }
    return tokens[0];
  });
  return { ids, rest };
}

/**
 * Given the raw argv tokens that follow `plan prepare` (not including
 * "plan"/"prepare" themselves), pull out `--validation-command`,
 * `--validation-setup-command`, repeated `--validation-check <id>
 * <argv...>`, and repeated `--acceptance-check <id>` values - option-like
 * tokens and all - and return the remaining argv with those flags and
 * values removed, ready for Commander to parse normally.
 *
 * Mixing legacy `--validation-command` with new `--validation-check` is
 * NOT rejected here: both are simply extracted and returned. Rejecting the
 * combination requires knowing how the command intends to combine them with
 * checks declared directly in plan JSON, which is the plan-prepare command's
 * job (see plan-prepare.ts), not this argv-decoding layer's.
 */
export function extractPlanPrepareValidationArgv(
  argvAfterPrepare: string[],
): PlanPrepareArgvExtraction {
  const step1 = extractFlagValues(argvAfterPrepare, "--validation-command");
  const step2 = extractFlagValues(step1.rest, "--validation-setup-command");
  const step3 = extractValidationChecks(step2.rest);
  const step4 = extractAcceptanceChecks(step3.rest);
  return {
    validationCommand: step1.value,
    validationSetupCommand: step2.value,
    validationChecks: step3.checks,
    acceptanceChecks: step4.ids,
    rest: step4.rest,
  };
}
