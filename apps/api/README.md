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
| PATCH | `/agents/:agentId/secret-reference` | `agents:write` | Attach, rotate or clear a tenant vault reference without changing agent version history |
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
  "secretRef": "aegisflow:primary-openai",
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

Never send raw API keys or credentials to the agent registry. Store them through the encrypted tenant secrets API (`POST /secrets`) and set the returned `aegisflow:<slug>` reference on the agent. The API encrypts values using AES-256-GCM and returns metadata only. Version snapshots are immutable at the Mongoose schema level. Promotion changes only the agent's active-version pointer and lifecycle state, so rollback is a promotion of a prior version rather than an edit.

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
    { "id": "agent-step", "type": "agent", "label": "Extract invoice", "position": { "x": 320, "y": 120 }, "config": { "agentId": "0123456789abcdef01234567" } },
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

The workflow API and graph-validation foundation is paired with a React workflow studio and a durable MongoDB-backed execution runtime. The runtime pins immutable workflow and active agent-version snapshots, queues idempotent runs, checkpoints node traces, uses renewable worker leases, supports cooperative cancellation and manual retry, and evaluates only literal boolean conditions. Agent nodes now execute through the OpenAI, Anthropic and Google adapters using tenant-scoped encrypted secret references. Human approval nodes are supported by the approval runtime documented below. See [Workflow execution runtime](../../docs/workflow-execution-runtime.md) and [AI provider execution and secrets vault](../../docs/ai-provider-adapter-foundation.md) for API and operational details. Mongoose immutability is an application-level guard, not a tamper-proof archival store; use database roles and external audit retention for stronger controls.

## Role baseline

- `owner`: all defined permissions
- `admin`: all permissions except billing read
- `operator`: agent/workflow operations, run operations and approval decisions
- `viewer`: read-only workspace, agent, workflow, run, policy, audit and billing access

Permission checks deny by default.

## Security and operational limitations

This is an evolving platform foundation, not a production certification. Invitations, password reset, MFA, SSO, billing, organization switching, external secret-manager resolution, agent execution, and automated database-backed integration tests remain future milestones. Use TLS, managed secrets, backups, replica-set deployment, monitoring and a reviewed retention policy before production use.

## Human approval runtime

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/approvals?status=pending&page=1&limit=25` | `approvals:read` | Reviewer inbox, scoped to the authenticated user's assigned role or identity |
| GET | `/approvals/:approvalId` | `approvals:read` | Approval detail and tenant-scoped execution context |
| POST | `/approvals/:approvalId/decision` | `approvals:decide` | Record an approve or reject decision exactly once |

Decision body:

```json
{ "decision": "approve", "comment": "Reviewed the extracted invoice and supporting evidence." }
```

Approval nodes may configure `title`, `description`, `assigneeRole` (owner, admin, operator or viewer), `assigneeUserId`, and `timeoutMinutes` (1–10080; defaults to 1440). The worker creates one approval per tenant/run/node, pins it to the immutable workflow version and graph hash, then moves the run into `waiting_approval` and releases its worker lease. Approving atomically records reviewer identity/comment and queues the run at the next graph node; rejecting fails the run. Expired requests are marked by the worker poller and fail the waiting run. Cancelling a waiting run also cancels its pending approval.

Decision writes use a MongoDB transaction across the approval and execution-run documents. The database must run as a replica set or transaction-capable sharded cluster; standalone MongoDB deployments cannot provide the atomic decision guarantee. Reviewer access is tenant-scoped and constrained to the assigned identity or role. Owner and admin members may escalate role-assigned requests; a request assigned to a specific user remains restricted to that identity. Raw credentials are not accepted or stored in approval records.

This runtime deliberately treats rejection and expiry as terminal failures. Configurable reject branches, delegation, escalation policies, quorum approvals, notifications, and a richer approval audit timeline remain future work.


## Observability foundation

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/observability/overview?range=24h` | `runs:read` | Tenant-scoped run totals, success rate, average duration, throughput and pending approval count |
| GET | `/observability/runs/:runId/trace` | `runs:read` | Sanitized node-level execution timeline for a tenant-owned run |

Ranges are `24h`, `7d`, and `30d`. The overview reads at most 5,000 runs and reports when the result is sampled. Trace responses omit graph payloads, node outputs, idempotency keys, lease tokens and raw error messages. Error codes are returned instead of raw provider or workflow error text.

These metrics are operational estimates derived from execution records, not billing-grade telemetry. Provider token usage, model cost, distributed trace propagation, streaming logs and alerting require future provider/event instrumentation. See [Observability foundation](../../docs/observability-foundation.md).


## Evaluation and quality intelligence

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/evaluations/suites` | `evaluations:read` | List tenant evaluation suites |
| POST | `/evaluations/suites` | `evaluations:write` | Create a suite and optional active-agent-version association |
| GET | `/evaluations/suites/:suiteId` | `evaluations:read` | Read suite and recent runs |
| POST | `/evaluations/suites/:suiteId/runs` | `evaluations:run` | Score submitted candidate outputs |
| GET | `/evaluations/runs` | `evaluations:read` | List recent evaluation runs |

The deterministic scoring modes are `exact_match` (structural JSON equality) and `contains` (case-sensitive string substring). Scores use case weights and range from 0 to 100. Current APIs score submitted outputs; they do not invoke providers or claim model-judge quality. See [Evaluation and quality intelligence](../../docs/evaluation-quality-intelligence.md).


## AI provider adapter foundation

The API exposes a tenant-scoped encrypted secret vault and provider adapters for OpenAI, Anthropic and Google Gemini. Store credentials through `POST /secrets`, configure `SECRETS_ENCRYPTION_KEY` (64 hex characters representing 32 random bytes), and assign the returned `aegisflow:<slug>` reference to an agent. Runs pin active agent versions, invoke the provider adapter in the durable worker, and persist provider-reported token usage and latency on each node step. Run APIs omit private agent snapshots. See [AI provider execution and secrets vault](../../docs/ai-provider-adapter-foundation.md) for setup, security boundaries and limitations.
