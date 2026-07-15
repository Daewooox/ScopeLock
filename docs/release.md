# npm beta release runbook

ScopeLock is prepared for an npm beta, but no npm package has been published.
This runbook separates safe rehearsal from the first publication ceremony.

## Current release boundary

Preparation is allowed. Publication is not authorized by this document.

Do not run `npm publish`, `npm stage publish`, or `npm stage approve`; do not
enable `NPM_PUBLISH_ENABLED`; and do not create a GitHub tag or release until a
separate task explicitly authorizes the release.

The first publication cannot use npm staged publishing because each package
must already exist before a trusted publisher can be configured. The existing
`publish-npm.yml` workflow is therefore post-bootstrap infrastructure only.

## Maintainer readiness

Keep this evidence outside the repository and never record secrets or recovery
codes here.

- npm username and verified email confirmed;
- publishing/settings 2FA enabled and recovery codes stored offline;
- `@scopelock` ownership and package-creation rights confirmed;
- second owner or documented account-recovery path available;
- dedicated npm CLI profile selected so work credentials are not overwritten.

Any missing item is a release blocker.

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

## First-publication checklist (HOLD)

The commands below are release-day references only. Do not execute them during
preparation. After explicit authorization, run each command separately and
read back the result before continuing.

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
