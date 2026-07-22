# npm beta release runbook

`@scopelock/core`, `@scopelock/cli`, and `@scopelock/mcp` (version
`0.1.0-beta.1`) were published to npm under the `beta` dist-tag on
2026-07-22, under npm account `daewooox`. This runbook now governs the
*next* publication (`beta.2` or later); the "First-publication checklist"
below is kept as a historical record of the completed bootstrap, not a
pending task.

## Current release boundary

Preparation is allowed. Publication of a new version is not authorized by
this document alone.

Do not run `npm publish`, `npm stage publish`, or `npm stage approve`; do not
enable `NPM_PUBLISH_ENABLED`; and do not create a GitHub tag or release until a
separate task explicitly authorizes the release. This boundary applied to
`beta.1` (completed 2026-07-22) and applies again, unchanged, to every future
version.

Bootstrap publication (the very first version of each package) could not use
npm staged publishing, since each package had to already exist before a
trusted publisher could be configured - that is why it was a manual,
command-by-command gate. `publish-npm.yml`'s trusted-publisher flow now
governs every subsequent release.

## Maintainer readiness

Keep this evidence outside the repository and never record secrets or recovery
codes here.

- npm username and verified email confirmed;
- publishing/settings 2FA enabled and recovery codes stored offline;
- `@scopelock` ownership and package-creation rights confirmed;
- second owner or documented account-recovery path available;
- dedicated npm CLI profile selected so work credentials are not overwritten.

Confirmed for the `beta.1` bootstrap (2026-07-22). Reconfirm before any
future publish if the npm account, 2FA, or scope ownership changes. Any
missing item is a release blocker.

## Candidate rehearsal

Run from a clean checkout of the exact intended `main` commit:

```bash
git status --short
git rev-parse HEAD
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm release:rehearse
```

`release:rehearse` runs the production dependency audit, creates tarballs,
performs npm publish dry-runs, installs and removes the packages in temporary
project/global prefixes, and writes local evidence. It never publishes.

The candidate artifacts are:

- `.release-artifacts/pack-manifest.json` with tarball SHA-256 values;
- `.release-artifacts/publish-dry-run.json` with normalized file inventories;
- `.release-artifacts/production-audit.json` from npm's audit of the exact
  packed production dependency graph;
- `.release-artifacts/release-evidence.json` with
  `publication=not-performed`;
- `.release-artifacts/smoke-local.json` with the local platform result.

Then manually dispatch `release-readiness.yml` against the same `main` SHA.
Download its artifacts, compare SHA-256 values independently, and require green
Linux, macOS, and Windows smoke jobs plus CodeQL and gitleaks. A PR merge ref or
a different SHA is not valid release evidence.

## First-publication checklist (completed 2026-07-22)

Kept as a historical record of the `beta.1` bootstrap. For any future
package that also needs a from-scratch bootstrap (unlikely for `core`/
`cli`/`mcp`, now that all three exist), the same command-by-command
discipline applies: run each command separately and read back the result
before continuing, never as a batch.

1. Reconfirm the package names are still available and scope ownership is
   correct.
2. Point npm at a dedicated user config, authenticate interactively, and check
   identity:

   ```bash
   export NPM_CONFIG_USERCONFIG="$HOME/.npmrc-scopelock"
   npm login
   npm whoami
   ```

3. Compare every tarball SHA-256 with the approved CI evidence.
4. Publish the already verified core tarball with public access and the beta
   tag, then verify its registry metadata and clean install.
5. Publish the already verified CLI and MCP tarballs one at a time, verifying
   each before continuing.
6. Confirm only the `beta` dist-tag points to `0.1.0-beta.1`; never move
   `latest` during beta.

Do not use loops, rebuilt tarballs, a long-lived automation token, or a
different commit during bootstrap.

## Trusted publishing after bootstrap

Only after all three packages exist, configure one trusted publisher per npm
package with these exact values:

- GitHub owner: `Daewooox`;
- repository: `ScopeLock`;
- workflow: `publish-npm.yml`;
- environment: `npm-production`.

Keep the GitHub environment restricted to protected branches with a required
reviewer. The staging job alone may have `id-token: write`; checkout credentials
must remain disabled. Keep `NPM_PUBLISH_ENABLED=false` and store no `NPM_TOKEN`.
The first OIDC exercise belongs to a separately approved future beta version.

## Verification and recovery

After an authorized publication, verify package owners, visibility, versions,
dist-tags, provenance and registry integrity. Test Node.js 22 and 24 with a
clean core import, CLI help/init/report flow, and MCP initialize handshake.

Do not treat unpublish as routine rollback. If beta.1 is defective, deprecate
it with a precise message, prepare beta.2 through the full gate, and move only
the `beta` tag. For a security incident, disable publication, preserve the
evidence, restrict package access as appropriate, and publish an advisory.

## GO / NO-GO

Release is GO only when identity, 2FA, recovery, scope ownership, exact-main
evidence, reproducible tarballs, three-OS smoke, security checks, dry-runs and
the command-by-command bootstrap review are all complete, followed by explicit
user authorization in a new task. Otherwise it is NO-GO.

The `beta.1` GO decision was made and executed on 2026-07-22. This gate
re-applies in full to the next version.
