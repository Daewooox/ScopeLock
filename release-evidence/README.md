# Release evidence

ScopeLock release evidence binds a candidate version to its commit, package
tarball digests, clean-install results, security checks, and human approval.
The schema is exported as `releaseEvidenceSchema` from `@scopelock/core`.

Generated candidate evidence is not committed because it belongs to an exact
CI run and artifact set. The `release-readiness` workflow uploads it as a
retained GitHub artifact. A record with `pending` checks is useful evidence of
what remains, but it is not a release approval.

The artifact set also includes `production-audit.json`. It is generated from
an npm lock built from the exact candidate tarballs, so the security check
covers the packed production dependency graph rather than development tools.

Required invariant: `publication` is `not-performed`. Actual npm staging and
the later 2FA approval are separate audited events.

The first `@scopelock/*` publication is special: npm requires a package to
already exist before Trusted Publishing or staged publishing can be configured.
The package names are currently unregistered; ownership and creation rights for
the `@scopelock` npm scope still require a maintainer check. The bootstrap must
be performed manually,
then each package must be configured to trust `publish-npm.yml` in
`Daewooox/ScopeLock`, environment
`npm-production`, with only `npm stage publish` allowed.
