import type { AgentId } from "../schemas/contract.js";
import type { HookCapabilities } from "../schemas/agent-workspace.js";

/**
 * Nominal (documented-format) hook capabilities per harness. These are static
 * facts about what each host's hook system is *designed* to do - not a claim
 * that it is currently installed, trusted, or working in a given repo (see
 * `agents/hook-probe.ts` for that). Confidence starts at "documented" here;
 * a probe may downgrade it to "degraded", never upgrade it to "live-verified"
 * (that requires an actual harness run, which is a separate, explicit,
 * non-automatic regression step - see the Step 3 spike gap below).
 *
 * Evidence:
 * - claude: PreToolUse deny is dogfooded live in this repo (task #0014) -
 *   synchronous, not trust-gated.
 * - cursor: `afterFileEdit` fires after the write, so it is audit-only, never
 *   a pre-write deny. The Step 0 spike could not live-probe Cursor (no
 *   executable available), so per the plan's decision this MUST NOT be
 *   upgraded to canDeny from assumption alone.
 * - codex: official docs (developers.openai.com/codex/config-advanced#hooks,
 *   fetched 2026-07-10) confirm a documented PreToolUse hook mechanism with a
 *   TOML `[[hooks.PreToolUse]]` inline form, and the Step 0 live probe
 *   confirmed a project-local PreToolUse hook CAN deny a Bash tool call.
 *   However: (a) the JSON `.codex/hooks.json` schema is explicitly undocumented,
 *   (b) the PreToolUse event shape for the file-editing tool (`apply_patch`,
 *   as opposed to the `Bash` tool Step 0 actually probed) was never captured
 *   live, and (c) "project trust" gates whether the hook loads at all and has
 *   no documented, statically-readable indicator. `canDeny: true` is recorded
 *   as the nominal/documented capability; the probe always reports codex
 *   confidence as "degraded" until a dedicated live sub-spike captures a real
 *   `apply_patch` PreToolUse event and a ScopeLock hook adapter can be built
 *   against a confirmed shape instead of a guess.
 */
export const NOMINAL_HOOK_CAPABILITIES: Record<AgentId, HookCapabilities> = {
  claude: {
    preToolUse: true,
    postToolUse: false,
    canDeny: true,
    canModifyInput: false,
    confidence: "documented",
  },
  cursor: {
    preToolUse: false,
    postToolUse: true,
    canDeny: false,
    canModifyInput: false,
    confidence: "documented",
  },
  codex: {
    preToolUse: true,
    postToolUse: false,
    canDeny: true,
    canModifyInput: false,
    confidence: "documented",
  },
};
