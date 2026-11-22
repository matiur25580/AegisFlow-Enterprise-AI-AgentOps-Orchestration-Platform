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

## Visual workflow foundation

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/workflows?page=1&limit=25&status=draft&search=...` | `workflows:read` | Tenant-scoped, paginated workflow registry |
| POST | `/workflows` | `workflows:write` | Create a workflow and immutable version 1 |
| GET | `/workflows/:workflowId` | `workflows:read` | Workflow metadata and version history |
| PATCH | `/workflows/:workflowId` | `workflows:write` | Update workflow metadata (not graph snapshots) |
| POST | `/workflows/:workflowId/versions` | `workflows:write` | Validate and create a new immutable graph snapshot |
| POST | `/workflows/:workflowId/versions/:version/promote` | `workflows:write` | Publish a version or roll back by promoting an earlier version |
| PATCH | `/workflows/:workflowId/lifecycle` | `workflows:write` | Return a published workflow to draft or archive it |

A graph contains `nodes` and `edges`. Supported node types are `start`, `agent`, `condition`, `approval`, and `end`. Each node has a stable `id`, `label`, canvas `position`, and typed `config`; edges reference node IDs using `source` and `target`.

Example graph payload (the same `graph` object is accepted by workflow creation and version creation):

```json
{
  "changelog": "Initial workflow",
  "nodes": [
    { "id": "start", "type": "start", "label": "Start", "position": { "x": 80, "y": 120 }, "config": {} },
    { "id": "agent-step", "type": "agent", "label": "Extract invoice", "position": { "x": 320, "y": 120 }, "config": { "agentId": "0123456789abcdef01234567", "secretRef": "vault:production/invoice-agent" } },
    { "id": "finish", "type": "end", "label": "Complete", "position": { "x": 560, "y": 120 }, "config": {} }
  ],
  "edges": [
    { "id": "start-agent", "source": "start", "target": "agent-step" },
    { "id": "agent-finish", "source": "agent-step", "target": "finish" }
  ]
}
```

Graph validation enforces exactly one start node, at least one end node, unique node/edge IDs, valid edge endpoints, reachability from start, an acyclic directed graph, node-specific required configuration, valid secret-reference URIs, and tenant-owned non-archived agent references. Graphs are capped at 200 nodes and 500 edges. Cycles are intentionally disallowed until bounded loop semantics exist. Validation errors return HTTP 422 with structured issue details.

Workflow versions are append-only snapshots with a SHA-256 graph hash and Mongoose immutable fields. Promotion updates the active-version pointer and publishes the workflow; promoting an earlier version provides the rollback mechanism. All workflow and version reads/writes filter by the authenticated tenant ID from server-side auth context. Workflow lifecycle and version events are written to the tenant audit log. Secret values must never be placed in workflow configuration; use secret-reference URIs only.

The current milestone provides the API and graph-validation foundation. It does not yet include the React drag-and-drop canvas, execution engine, conditional branch evaluator, durable scheduling, or approval runtime. Mongoose immutability is an application-level guard, not a tamper-proof archival store; use database roles and external audit retention for stronger controls.

## Role baseline

- `owner`: all defined permissions
- `admin`: all permissions except billing read
- `operator`: agent/workflow operations, run operations and approval decisions
- `viewer`: read-only workspace, agent, workflow, run, policy, audit and billing access

Permission checks deny by default.

## Security and operational limitations

This is an evolving platform foundation, not a production certification. Invitations, password reset, MFA, SSO, billing, organization switching, external secret-manager resolution, agent execution, and automated database-backed integration tests remain future milestones. Use TLS, managed secrets, backups, replica-set deployment, monitoring and a reviewed retention policy before production use.
