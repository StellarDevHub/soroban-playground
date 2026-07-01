# Security Audit Policy

The CI pipeline runs `npm audit` for all workspaces on every pull request and
push to the release branches. It fails the build for high or critical findings.

Snyk scans run when `SNYK_TOKEN` is configured in repository secrets. The Snyk
jobs test npm dependencies and the backend container image with
`--severity-threshold=high`, and upload SARIF output to GitHub code scanning so
reports are visible in the Security tab.

Dependabot is configured to open dependency and security patch pull requests for
the frontend and backend workspaces. Security updates are labeled `security`.

## Override Policy

False-positive or accepted-risk overrides must be documented in the pull request
that introduces the exception. Include the advisory ID, affected package, why the
finding is not exploitable in this application, compensating controls, owner, and
an expiration date. Temporary overrides should use the narrowest possible Snyk
ignore or npm audit exception and must be revisited before production release.

Production release branches should not contain unresolved high or critical
findings unless an approved, time-bound override is linked from the release PR.
