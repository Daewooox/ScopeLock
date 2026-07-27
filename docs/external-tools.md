# External mutating tools

ScopeLock can gate an existing CLI that edits repository files in place. The
tool does not need a ScopeLock plugin: run it as a shell-free argv command in a
temporary worktree, validate the combined candidate, and promote only a patch
that stays inside its approved contract.

Use this for trusted tools such as codemods, formatters, migration utilities,
scanner autofixes, and local AI workers. The example below uses Semgrep.

## Example: gate a Semgrep autofix

First create a narrow contract draft:

```bash
scopelock contract new \
  --id semgrep-autofix \
  --task "Apply reviewed Semgrep autofixes" \
  --planned "src/**" \
  --read "rules/**" \
  --forbidden ".git/**" \
  --forbidden ".env*" \
  --out semgrep-contract.json
```

Create `semgrep-plan.json`. Replace the validation command with the
deterministic check for your repository:

```json
{
  "schemaVersion": 1,
  "planId": "semgrep-autofix",
  "execution": {
    "isolation": "required",
    "validation": {
      "checks": [
        {
          "id": "tests",
          "command": ["npm", "test"],
          "required": true
        }
      ],
      "acceptance": {
        "checkIds": ["tests"]
      }
    }
  },
  "tasks": [
    {
      "id": "semgrep-autofix",
      "contract": ".scopelock/contracts/semgrep-autofix.json",
      "command": [
        "semgrep",
        "scan",
        "--config",
        "rules/security.yaml",
        "--autofix",
        "--metrics=off",
        "src"
      ],
      "expectsChanges": true
    }
  ]
}
```

Review `semgrep-contract.json` and `semgrep-plan.json`, then commit them as the
clean baseline. Approve the contract only after that commit so it captures the
reviewed baseline:

```bash
scopelock contract approve semgrep-contract.json
git add .scopelock/contracts/semgrep-autofix.json
git commit -m "chore: approve Semgrep autofix scope"
```

Then run:

```bash
scopelock run semgrep-plan.json \
  --yes \
  --isolate \
  --receipt semgrep-receipt.json

scopelock report semgrep-receipt.json --open
```

ScopeLock runs Semgrep in a detached Git worktree. A candidate edit is promoted
only when:

- every changed path is allowed by the approved contract;
- every required validation check passes;
- the repository remains on the expected clean baseline;
- final promotion and worktree cleanup complete.

If Semgrep makes a Git-visible edit to a forbidden or outside-scope path, the
task is recorded as `rejected-scope` and its patch is not promoted. The receipt
records the command, changed paths, validation, promotion, cleanup, and patch
digest.

## Boundary

This is Git-workspace containment, not an OS sandbox. A command retains the
current user's permissions and can still write through an absolute path outside
the repository. Writes to ignored files and Git metadata are also outside
ScopeLock's patch evidence. Run only trusted executables, keep their native
sandboxing enabled, avoid shell-string commands, and keep credentials outside
the target repository.

ScopeLock does not install the external tool, generate its rules, judge whether
its transformation is semantically correct, or replace code review. It makes
the tool's repository mutation bounded, testable, and auditable.
