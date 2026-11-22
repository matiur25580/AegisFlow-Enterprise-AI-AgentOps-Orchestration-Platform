# AegisFlow API

All API routes are mounted below `/api/v1`.

## Identity and workspace

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` | Create a user, tenant and owner membership |
| POST | `/auth/login` | Authenticate and create a refresh session |
| POST | `/auth/refresh` | Rotate the HttpOnly refresh cookie |
| POST | `/auth/logout` | Revoke the current session |
| GET | `/auth/me` | Return the authenticated identity |
| GET | `/workspace/summary` | Permission-protected tenant context |
| GET | `/workspace/audit-events` | Tenant-scoped audit events |

Protected requests require `Authorization: Bearer <access-token>`. Tenant identity is derived exclusively from the verified membership and is never accepted from request input.

## Agent registry and lifecycle

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/agents?page=1&limit=25&status=draft&search=...` | `agents:read` | Tenant-scoped, paginated registry |
| POST | `/agents` | `agents:write` | Create agent and immutable initial version |
| GET | `/agents/:agentId` | `agents:read` | Agent detail and version history |
| GET | `/agents/:agentId/versions` | `agents:read` | Immutable version history |
| POST | `/agents/:agentId/versions` | `agents:write` | Create a new version snapshot |
| POST | `/agents/:agentId/versions/:version/promote` | `agents:write` | Promote or roll back to a version |
| PATCH | `/agents/:agentId/lifecycle` | `agents:write` | Deprecate or archive an agent |

Agent creation body:

```json
{
  "name": "Invoice Extraction Agent",
  "slug": "invoice-extraction",
  "description": "Extracts structured invoice data",
  "team": "finance-automation",
  "tags": ["finance", "document-ai"],
  "provider": "openai",
  "model": "gpt-4.1",
  "secretRef": "vault:production/openai/invoice-agent",
  "version": {
    "changelog": "Initial production candidate",
    "systemPrompt": "Extract invoice fields and return valid JSON.",
    "temperature": 0.1,
    "maxOutputTokens": 4096,
    "timeoutMs": 45000,
    "tools": ["document.read"],
    "responseFormat": "json"
  }
}
```

Never send raw API keys or credentials to the registry. `secretRef` accepts a reference URI for a future secrets-manager adapter; this milestone does not resolve or retrieve secrets. Version snapshots are immutable at the Mongoose schema level. Promotion changes only the agent's active-version pointer and lifecycle state, so rollback is a promotion of a prior version rather than an edit.

Every registry query filters by the authenticated tenant. Agent and version creation, promotion, deprecation and archival write tenant-scoped audit events. Archived agents cannot be promoted or versioned; lifecycle changes are intentionally one-way from archived.

## Role baseline

- `owner`: all defined permissions
- `admin`: all permissions except billing read
- `operator`: agent/workflow operations, run operations and approval decisions
- `viewer`: read-only workspace, agent, workflow, run, policy, audit and billing access

Permission checks deny by default.

## Security and operational limitations

This is an evolving platform foundation, not a production certification. Invitations, password reset, MFA, SSO, billing, organization switching, external secret-manager resolution, agent execution, and automated database-backed integration tests remain future milestones. Use TLS, managed secrets, backups, replica-set deployment, monitoring and a reviewed retention policy before production use.
