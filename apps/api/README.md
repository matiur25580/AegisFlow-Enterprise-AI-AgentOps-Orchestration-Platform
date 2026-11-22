# AegisFlow API

## Identity endpoints

All routes are mounted below `/api/v1`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` | Create a user, tenant and owner membership |
| POST | `/auth/login` | Authenticate and create a refresh session |
| POST | `/auth/refresh` | Rotate the HttpOnly refresh cookie |
| POST | `/auth/logout` | Revoke the current session |
| GET | `/auth/me` | Return the authenticated identity |
| GET | `/workspace/summary` | Permission-protected tenant context |
| GET | `/workspace/audit-events` | Tenant-scoped audit events |

Signup requires an organization name, display name, email, and a 12+ character password containing lowercase, uppercase, and numeric characters. Access tokens are short-lived JWTs returned in the response body. Refresh tokens are opaque random values stored only as SHA-256 hashes and delivered in an HttpOnly, SameSite=Strict cookie.

Protected requests require `Authorization: Bearer <access-token>`. The API re-checks user status, tenant status, active membership, and refresh-session state against MongoDB for each protected request. Tenant identity is never accepted from a request header or body.

## Role baseline

- `owner`: all defined permissions
- `admin`: all permissions except billing read
- `operator`: agent/workflow operations, run operations and approval decisions
- `viewer`: read-only workspace, agent, workflow, run, policy, audit and billing access

Permission checks are explicit and deny by default. Add new routes behind `authenticate` and `requirePermission`.

## Important limitations

This is the initial identity milestone, not a complete production certification. Signup currently creates one owner and one workspace; invitations, password reset, MFA, SSO, billing and organization switching are future work. Refresh rotation uses atomic single-session replacement; deploy MongoDB with TLS, backups and appropriate replica-set configuration before production use.
