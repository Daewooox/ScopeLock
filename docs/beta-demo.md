# Five-minute silent beta demo

This is the reproducible recording script for a silent English walkthrough.
Use a clean terminal profile, 1280 x 720 or larger, and captions instead of
voice-over. Do not show credentials, personal names, private repository paths,
or agent chat history.

The existing short demo is generated locally with:

```bash
pnpm demo:progressive
```

It is deterministic, uses a temporary Git repository, and does not call an
agent. Keep the final output directory for the recording:

```bash
pnpm demo:progressive -- --keep-fixture
```

## Recording sequence

| Time | Show | On-screen caption |
|---:|---|---|
| 0:00-0:20 | ScopeLock title and the clean fixture | `Flight control for AI coding agents` |
| 0:20-1:10 | `scopelock setup` readiness table | `Check the repository and available agent hooks` |
| 1:10-2:00 | `task start` with allowed and blocked paths | `Review the task boundary before the agent edits` |
| 2:00-2:35 | One allowed edit and one harmless blocked-write probe | `Allowed work proceeds. Out-of-scope writes are denied where the harness supports it.` |
| 2:35-3:15 | `task finish --open` and the HTML Flight Report | `Verify drift and keep local evidence` |
| 3:15-4:05 | `plan prepare` for two tasks with a read dependency | `Conflicting tasks are placed into safe execution stages` |
| 4:05-4:35 | Review `ready-plan.json`; show the explicit `run --yes --isolate` next step | `Preparation never starts an agent` |
| 4:35-5:00 | Final limitations frame | `Local-first. Rule-based. Not an OS sandbox. Human approval remains explicit.` |

## Recording rules

- English only; no audio.
- Use real terminal output or the shipped deterministic demo, not a fabricated
  success screen.
- Keep the denied write: it demonstrates the product working, not a failed
  demo. State that the forbidden file was not created.
- Do not imply that `task start` launches an agent or that `task finish` runs
  project tests.
- Do not call Cursor hooks a hard deny. Cursor remains audit-only; isolated
  promotion provides the separate patch gate.
- End on the generated artifact paths so viewers can see what is reviewable.

For a real-agent recording, repeat the same sequence in a public fixture and
show the exact harness, test command, receipt, and accepted patch. Label the
result as one pilot, not universal compatibility evidence.

