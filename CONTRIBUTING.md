# Contributing to ScopeLock

Thanks for helping improve ScopeLock. Bug fixes, compatibility reports,
documentation improvements, and focused product changes are welcome.

## Before changing code

- Search existing issues and pull requests first.
- Use a public issue for normal bugs and feature discussion.
- Follow [SECURITY.md](SECURITY.md) for vulnerabilities or possible data
  exposure. Never post a secret or exploit detail in a public issue.
- Keep one pull request focused on one outcome. Large behavior changes should
  have an issue or design discussion before implementation.

## Local setup

ScopeLock requires Node.js 22 or newer and pnpm 10.

```bash
git clone https://github.com/YOUR-USER/ScopeLock.git
cd ScopeLock
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

If `corepack` is unavailable, install `pnpm@10` with npm.

## Branch and pull request flow

1. Fork the repository.
2. Create a descriptive branch such as `feature/...`, `fix/...`, `docs/...`,
   `security/...`, or `chore/...`.
3. Make the smallest complete change that solves the problem.
4. Add focused tests when behavior changes.
5. Push to your fork and open a pull request against `main`.

Use a clear PR title such as `fix: reject an unsafe path`. ScopeLock uses
squash merge, so the PR title becomes the commit message on `main`.

## Required checks

Run the checks relevant to your change before opening the PR:

```bash
pnpm typecheck
pnpm build
pnpm test
git diff --check
```

CI also runs CodeQL, secret scanning, the packed production dependency audit,
cross-platform tests, and three-OS package install smoke. Do not bypass a
failing check by weakening the workflow or deleting the assertion.

Documentation-only changes do not need artificial test files. Verify their
commands, links, and examples instead.

## Security and privacy

- Never commit credentials, tokens, private keys, proprietary source, prompts,
  raw receipts, or unredacted command output.
- Do not add shell-string execution where an argv array works.
- Preserve fail-closed behavior at security and promotion boundaries.
- Do not claim OS containment: ScopeLock is not an OS sandbox.
- Do not silently install hooks, approve contracts, start agents, or publish
  packages.

## AI-assisted changes

AI-assisted contributions are welcome, but the contributor is responsible for
the final patch. Review every generated change, run the checks, and describe
the agent-assisted scope in the PR. Do not submit unreviewed bulk output.

By submitting a contribution, you agree that it may be distributed under the
repository's [MIT License](LICENSE).

