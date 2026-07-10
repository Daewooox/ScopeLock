# Bounded receipt spike

Date: 2026-07-10

## Goal

Reduce `scopelock run --plan` receipt size without adding LLM summarization,
SQLite, FTS, a command proxy, or a generic runner layer.

The spike keeps the receipt deterministic and auditable:

- bounded command/stdout/stderr previews stay in the main JSON;
- full raw command/stdout/stderr are stored as local artifacts;
- each artifact is referenced with bytes, previewBytes, sha256, and truncated;
- analyzer can still extract Codex usage from raw stdout artifacts.

## Implementation

- `packages/cli/src/commands/run-plan.ts`
  - receipt `schemaVersion` moved from `1` to `2`;
  - added `limits`, `artifactsDir`, and `handoffSummary`;
  - command preview limit: 400 bytes;
  - stdout/stderr preview limit: 400 bytes;
  - raw command/stdout/stderr files written next to the receipt under
    `<receipt-name>-artifacts/`.
- `benchmarks/coordination/analyze-receipt.mjs`
  - understands `outputArtifacts`;
  - reports artifact byte totals separately from receipt JSON bytes;
  - extracts Codex usage from raw stdout artifact when receipt stdout is bounded.
- Tests cover bounded output, artifact readback, usage extraction, and demo schema.

## Measurements

Baseline from `flight-control-demo-receipt-baseline.md`:

- Real Codex K=3 average receipt: 30,306 bytes.
- Dominant categories: stdout 58%, stderr 19%, command/prompt 13%.

Bounded spike:

- Deterministic one-command demo: 6,657 bytes.
- Real Codex K=1 `scopelock_run`: 15,191 bytes.
- Real Codex K=1 artifacts retained outside receipt:
  - commands: 4,271 bytes;
  - stdout: 16,068 bytes;
  - stderr: 6,225 bytes;
  - total artifacts: 26,564 bytes.

Interpretation:

- Main receipt is now roughly half the previous real-agent baseline while still
  preserving raw evidence locally.
- Remaining receipt weight is mostly metadata, drift, previews, and artifact
  descriptors. Further reduction should target shorter artifact paths/metadata
  and optional omission of command previews, not LLM summarization.

## Decision

GO for bounded receipt v2 as the default dispatcher receipt shape.

Do not build LLM summaries yet. The deterministic artifact split already solves
the biggest token-consumption problem while keeping the audit trail verifiable.

Next useful step:

- add a `scopelock run --receipt-profile compact|debug` or equivalent only if
  interviews/usage show that 15KB is still too large for handoff prompts.
