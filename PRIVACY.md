# Privacy

ScopeLock is local-first. Core drift checks, scheduling, hooks, manifests, and
receipts do not call an LLM or cloud service.

## Local Data

ScopeLock may write:

- `.scopelock/contracts/*.json` - approved shared contracts;
- `.scopelock/reports/*.json` and `audit.ndjson` - local reports, gitignored;
- user-local approval seals under the platform state directory.

Report directories and state files are written with private permissions on
POSIX systems where supported.

## Receipts

Receipts store command status, digests, byte counts, and redacted bounded
previews. Raw command/stdout/stderr artifacts are disabled by default. Enabling
`--store-raw-output` writes redacted local artifacts and should be used only on
trusted machines.

Redaction is best-effort. Avoid printing real secrets during demos or benchmark
runs.
