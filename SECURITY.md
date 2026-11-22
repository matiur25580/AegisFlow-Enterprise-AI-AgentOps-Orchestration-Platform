# Security policy

## Reporting

Please do not publish exploitable vulnerabilities in public issues. Contact the repository owner privately through GitHub to coordinate a responsible disclosure.

## Development requirements

- Never commit credentials, production data, private keys, or real environment files.
- Validate untrusted input at API boundaries.
- Derive tenant scope from authenticated server-side identity; do not trust client-provided tenant IDs.
- Apply least-privilege authorization on every protected operation.
- Keep logs free of credentials, tokens, and sensitive payloads.
- Use bounded request sizes, dependency timeouts, and safe error responses.
- Add tests for authorization boundaries and cross-tenant isolation before enabling a feature in production.

## Current status

This repository is in its foundation milestone. Authentication, authorization, tenant isolation, and audit controls are not yet complete. Do not expose this preview as a production service.
