# npm beta release runbook

`@mindthediff/core`, `@mindthediff/cli`, and `@mindthediff/mcp` are the
canonical npm packages. Version `0.1.0-beta.5` is their first release
candidate. The old `@scopelock/*` packages remain installable during the
migration but do not receive parallel releases.

## Current release boundary

Preparation is allowed. Publication of a new version is not authorized by
this document alone.

Do not run `npm publish`, `npm stage publish`, or `npm stage approve`; do not
enable `NPM_PUBLISH_ENABLED`; and do not create a GitHub tag or release until a
separate task explicitly authorizes the release. This boundary applied to
`beta.1` (completed 2026-07-22) and applies again, unchanged, to every future
version.

Bootstrap publication cannot use npm staged publishing, since each new package
must exist before a trusted publisher can be configured. Publish the three
reviewed tarballs manually, one at a time; `publish-npm.yml` governs later
releases after Trusted Publisher is configured.

## Maintainer readiness

Keep this evidence outside the repository and never record secrets or recovery
codes here.

- npm username and verified email confirmed;
- publishing/settings 2FA enabled and recovery codes stored offline;
- `@mindthediff` ownership and package-creation rights confirmed;
- second owner or documented account-recovery path available;
- dedicated npm CLI profile selected so work credentials are not overwritten.

Reconfirm before bootstrap and any future publish if the npm account, 2FA, or
scope ownership changes. Any missing item is a release blocker.

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

## First-publication checklist

Run each command separately and read back the result before continuing, never
as a batch.

1. Reconfirm the package names are still available and scope ownership is
   correct.
2. Point npm at a dedicated user config, authenticate interactively, and check
   identity:

   ```bash
   export NPM_CONFIG_USERCONFIG="$HOME/.npmrc-mindthediff"
   npm login
   npm whoami
   ```

3. Compare every tarball SHA-256 with the approved CI evidence.
4. Publish the already verified core tarball with public access and the beta
   tag, then verify its registry metadata and clean install.
5. Publish the already verified CLI and MCP tarballs one at a time, verifying
   each before continuing.
6. Confirm the `beta` dist-tag points to `0.1.0-beta.5`; do not rely on
   `latest` during beta.

Do not use loops, rebuilt tarballs, a long-lived automation token, or a
different commit during bootstrap.

## Trusted publishing after bootstrap

Only after all three packages exist, configure one trusted publisher per npm
package with these exact values:

- GitHub owner: `Daewooox`;
- repository: `MindTheDiff`;
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

Do not treat unpublish as routine rollback. If the current beta is defective,
deprecate it with a precise message, prepare the next beta through the full
gate, and move only the `beta` tag. For a security incident, disable
publication, preserve the evidence, restrict package access as appropriate,
and publish an advisory.

## GO / NO-GO

Release is GO only when identity, 2FA, recovery, scope ownership, exact-main
evidence, reproducible tarballs, three-OS smoke, security checks, dry-runs and
the command-by-command bootstrap review are all complete, followed by explicit
user authorization in a new task. Otherwise it is NO-GO.

The `beta.1` bootstrap GO decision was made and executed on 2026-07-22. This
gate re-applies in full to every next version.
