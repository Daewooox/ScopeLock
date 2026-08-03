# @mindthediff/cli

The command-line interface for
[MindTheDiff](https://github.com/Daewooox/MindTheDiff), local flight control for AI
coding agents: define what an agent may change, coordinate overlapping
tasks, block scope drift, and keep a verifiable receipt of the result.

```bash
npm install --global @mindthediff/cli@beta
```

## Quick start

```bash
mindthediff setup
mindthediff task start "Add a dark mode toggle" --agent claude

# Let the agent work, then verify the repository evidence
mindthediff task finish --open
```

`task start` reviews and approves the change boundary but never starts an
agent — approval, instruction injection, and hook installation stay explicit
decisions. `task finish` checks drift against the approved boundary and
renders a local HTML Flight Report; it does not run the tests named in the
contract.

For coordinating several agents on non-overlapping tasks, see `mindthediff plan
prepare` and `mindthediff run` in the
[CLI reference](https://github.com/Daewooox/MindTheDiff/blob/main/docs/reference.md).

This tool is a guardrail, not an OS sandbox: it protects against accidental
scope drift and records tamper evidence, but cannot stop a malicious
same-user process with unrestricted shell access. See the repository's
[security model](https://github.com/Daewooox/MindTheDiff/blob/main/SECURITY.md)
before using strict enforcement in a sensitive repository.

MIT licensed. Requires Node.js 22 or newer.
