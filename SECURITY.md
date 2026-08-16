# Security Policy

## Supported Versions

Only the latest published major version of @arcaelas/whatsapp receives security updates. Older majors are not patched: upgrade to the current release before reporting.

## Reporting a Vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/arcaelas/whatsapp/security/advisories/new). Do not open public issues or pull requests for security problems: that discloses the flaw before a fix exists.

Include the affected version, a minimal reproduction, and the impact you observed. You will receive an acknowledgement within 72 hours and a resolution or a documented mitigation within 30 days. Once a fix is published, the advisory is disclosed and credits the reporter unless anonymity is requested.

## Dependencies

Dependencies are locked with a committed lockfile and installed with `--frozen-lockfile`; Dependabot alerts are reviewed as they arrive and version bumps land through pull requests to `main`, never by editing the lockfile by hand.

## Release Integrity

Packages are published to npm from the repository state of `main`. The `build/` artifacts are generated at publish time by `prepublishOnly`; no prebuilt or externally produced files are ever included in a release.
