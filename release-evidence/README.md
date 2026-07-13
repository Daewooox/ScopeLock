# Release evidence

ScopeLock release evidence binds a candidate version to its commit, package
tarball digests, clean-install results, security checks, and human approval.
The schema is exported as `releaseEvidenceSchema` from `@scopelock/core`.

Generated candidate evidence is not committed because it belongs to an exact
CI run and artifact set. The `release-readiness` workflow uploads it as a
retained GitHub artifact. A record with `pending` checks is useful evidence of
what remains, but it is not a release approval.

Required invariant: `publication` is `not-performed`. Actual npm staging and
the later 2FA approval are separate audited events.

The first `@scopelock/*` publication is special: npm requires a package to
already exist before Trusted Publishing or staged publishing can be configured.
The `@scopelock` npm scope does not exist yet and must first be created under a
2FA-protected maintainer account. The bootstrap must be performed manually,
then each package must be configured to trust `publish-npm.yml` in
`Daewooox/ScopeLock`, environment
`npm-production`, with only `npm stage publish` allowed.
