# Release evidence

MindTheDiff release evidence binds a candidate version to its commit, package
tarball digests, clean-install results, security checks, and human approval.
The schema is exported as `releaseEvidenceSchema` from `@mindthediff/core`.

Generated candidate evidence is not committed because it belongs to an exact
CI run and artifact set. The `release-readiness` workflow uploads it as a
retained GitHub artifact. A record with `pending` checks is useful evidence of
what remains, but it is not a release approval.

The artifact set also includes `production-audit.json`. It is generated from
an npm lock built from the exact candidate tarballs, so the security check
covers the packed production dependency graph rather than development tools.

Required invariant: `publication` is `not-performed`. Actual npm staging and
the later 2FA approval are separate audited events.

The first `@mindthediff/*` publication is special: npm requires a package to
already exist before Trusted Publishing or staged publishing can be configured.
The npm organization exists and is owned by the maintainer; the package names
must still be checked immediately before publication. The bootstrap must be
performed manually,
then each package must be configured to trust `publish-npm.yml` in
`Daewooox/MindTheDiff`, environment
`npm-production`, with only `npm stage publish` allowed.
