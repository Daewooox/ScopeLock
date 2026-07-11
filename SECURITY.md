# Security Policy

## Supported Versions

ScopeLock is pre-1.0. Security fixes target the current `main` branch and the
latest published prerelease once packages are public.

## Reporting a Vulnerability

Please report security issues privately to alexander.sanchuk@gmail.com.

Include:

- affected ScopeLock version or commit SHA;
- operating system and Node.js version;
- reproduction steps;
- whether the issue can read/write outside the repository, bypass a hook, leak
  secrets, or run unexpected commands.

We aim to acknowledge reports within 7 days. Please do not publish exploit
details until a fix or mitigation is available.

## Security Boundary

ScopeLock is a local guardrail and flight recorder. It is not an OS sandbox. It
helps catch accidental scope drift, unsafe multi-agent overlap, and tampering
with approved local state. It does not protect against a malicious process that
already has unrestricted shell access as the same user.
