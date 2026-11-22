# Architecture baseline

## System boundaries

AegisFlow is a TypeScript monorepo with a React operator console and a Node.js/Express API. MongoDB is the system of record. Redis/BullMQ, durable workflow execution, realtime transport, and provider adapters will be introduced as separately testable capabilities in later milestones.

## API conventions

- Versioned application routes live under `/api/v1`.
- Health probes are available at `/health/live` and `/health/ready`.
- Responses use stable error codes and include a request correlation ID.
- JSON request bodies are capped at 1 MiB.
- Production errors do not expose stack traces or internal exception messages.
- Structured logs redact authorization, cookie, password, token, and secret fields.

## Multi-tenant security model (implementation target)

Tenant identity must be derived from a verified authenticated principal and membership record, never trusted from a client-supplied tenant header or request body. Every tenant-owned database query must include the resolved tenant identifier. Cross-tenant access tests are a release gate. Roles are permission bundles; route handlers must authorize the required permission rather than compare display labels.

## Reliability principles

- Liveness checks report process health only.
- Readiness checks include required dependency state.
- Long-running work belongs in durable queues, not HTTP request lifetimes.
- Retries must be bounded and paired with idempotency.
- External provider calls require timeouts, safe error classification, and trace correlation.
- Destructive operations and privileged policy changes must be auditable.

## Planned milestones

1. Platform foundation, API bootstrap, operator console shell, security baseline.
2. Identity, tenant provisioning, RBAC, invitations, sessions and audit events.
3. Agent registry, versioning, secrets references and lifecycle controls.
4. Workflow studio, graph validation, durable orchestration and execution queue.
5. Traces, logs, metrics, approvals, evaluations and incident workflows.
6. Integrations, cost intelligence, admin controls and production hardening.
