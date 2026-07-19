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
  "-h",
  "--help",
]);

export type PlanPrepareArgvExtraction = {
  validationCommand: string[] | undefined;
  validationSetupCommand: string[] | undefined;
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
 * Given the raw argv tokens that follow `plan prepare` (not including
 * "plan"/"prepare" themselves), pull out `--validation-command` and
 * `--validation-setup-command`'s full value arrays - option-like tokens and
 * all - and return the remaining argv with those flags and values removed,
 * ready for Commander to parse normally.
 */
export function extractPlanPrepareValidationArgv(
  argvAfterPrepare: string[],
): PlanPrepareArgvExtraction {
  const step1 = extractFlagValues(argvAfterPrepare, "--validation-command");
  const step2 = extractFlagValues(step1.rest, "--validation-setup-command");
  return {
    validationCommand: step1.value,
    validationSetupCommand: step2.value,
    rest: step2.rest,
  };
}
