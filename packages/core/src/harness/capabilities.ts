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
 * - codex: official docs fetched 2026-07-10 confirm `PreToolUse` can deny
 *   `apply_patch`. Step 3b live spike captured the real event shape and
 *   verified 3/3 denied `apply_patch` mutations before write when hook trust
 *   was bypassed/trusted. Confidence is still degraded in static preflight,
 *   because project trust has no statically-readable indicator.
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
