# npm beta release runbook

`@mindthediff/core`, `@mindthediff/cli`, and `@mindthediff/mcp` are the
canonical npm packages. Version `0.1.0-beta.5` is the published engineering
beta. The initial manual bootstrap is complete, and Trusted Publisher is
configured for all three packages. Future releases use `publish-npm.yml`, the
protected `npm-production` environment, and npm staged approval. The old
`@scopelock/*` packages remain installable during the migration but do not
receive parallel releases.

## Current release boundary

Preparation is allowed. Publication of a new version is not authorized by
this document alone.

Do not run `npm publish`, `npm stage publish`, or `npm stage approve`; do not
enable `NPM_PUBLISH_ENABLED`; and do not create a GitHub tag or release until a
separate task explicitly authorizes the release. This boundary applied to
`beta.1` (completed 2026-07-22) and applies again, unchanged, to every future
version.

The initial beta.5 bootstrap was completed manually because new packages must
exist before a trusted publisher can be configured. That one-time exception is
historical; it is not the procedure for future releases.

## Maintainer readiness

Keep this evidence outside the repository and never record secrets or recovery
codes here.

- npm username and verified email confirmed;
- publishing/settings 2FA enabled and recovery codes stored offline;
- `@mindthediff` ownership and package-creation rights confirmed;
- second owner or documented account-recovery path available;
- dedicated npm CLI profile selected so work credentials are not overwritten.

Reconfirm before any future publish if the npm account, 2FA, or scope ownership
changes. Any missing item is a release blocker.

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

## Historical bootstrap record

The three `@mindthediff/*` beta.5 packages were manually published from the
reviewed release artifacts, then verified in the registry. Trusted Publisher
was configured for each package after that bootstrap. No future release should
repeat the manual package-creation or publisher-setup steps.

## Current trusted publishing flow

For every future release:

1. Prepare the new version in a separate release branch.
2. Run typecheck, build, tests, audit, pack, and release rehearsal.
3. Merge through a green pull request.
4. Run `release-readiness.yml` against the exact `main` SHA.
5. Verify tarball SHA-256 values and install smoke on Linux, macOS, and
   Windows.
6. Obtain separate, explicit owner authorization for publication.
7. Temporarily set `NPM_PUBLISH_ENABLED=true`.
8. Run `publish-npm.yml` with the exact version and confirmation.
9. Approve the protected `npm-production` environment.
10. Review the staged packages and approve them with npm 2FA.
11. Verify registry metadata, provenance, dist-tags, and a clean install.
12. Set `NPM_PUBLISH_ENABLED=false` immediately after the release.

The staging job alone may have `id-token: write`; checkout credentials remain
disabled. Store no `NPM_TOKEN`. Documentation is not publication authorization.

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
evidence, reproducible tarballs, three-OS smoke, security checks, dry-runs, and
the future trusted-publishing checks are all complete, followed by explicit
owner authorization in a new task. Otherwise it is NO-GO.

The beta.5 bootstrap GO decision was made and executed as a one-time manual
publication. The trusted-publishing gate re-applies in full to every next
version.
