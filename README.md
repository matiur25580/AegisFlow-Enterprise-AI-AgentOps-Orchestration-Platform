# AegisFlow

**Enterprise AI AgentOps, Orchestration & Reliability Platform**

> Operate AI agents and workflows with evaluation, observability, cost controls and human governance.

## 1. Product overview

AegisFlow is a multi-tenant control-plane foundation for registering, orchestrating, observing, evaluating and governing AI agents and workflows. The design emphasizes auditable changes, measurable quality, policy gates and human oversight.

## 2. Current implementation

- Tenant-scoped audit explorer with bounded filters and pagination.
- Agent and workflow lifecycle foundations with versioned workflow graphs.
- Regression-aware evaluation quality gates.
- Workflow promotion checks against referenced agent versions and evaluation evidence.
- Promotion history snapshots and explainable blocked decisions.
- Cost intelligence, budget alerts, approvals and run/trace workspaces.

**Operational boundary:** promotion records are point-in-time evidence snapshots. They do not deploy infrastructure or automatically re-evaluate when referenced agents change after promotion. Human approval and evaluation gates are not a substitute for runtime safety controls.

## 3. Technology stack

React 18 · TypeScript · Vite · Node.js · Express 4 · MongoDB · Mongoose · Zod · Recharts · npm workspaces.

## 4. Architecture

- `apps/web`: React operator console.
- `apps/api`: Express API, authentication, workflow, evaluation and audit domains.
- MongoDB: tenant-scoped application state and audit/promotion records.
- Redis/BullMQ: planned execution infrastructure, not assumed to be active in every milestone.
- `docs`: architecture, workflow runtime, evaluation and observability specifications.

## 5. Local development

Prerequisites: Node.js 20.11+ (Node 22 recommended), npm 10+, Docker and MongoDB.

```bash
npm install
# Configure root and app environment files using .env.example templates.
npm run dev
```

Web commonly runs at `http://localhost:5173`; API commonly runs at `http://localhost:4000`.

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

## 6. Security and governance principles

- Resolve tenant context and authorization server-side for every protected operation.
- Keep provider credentials in a secret manager; workflow node configuration must use references, not raw secrets.
- Validate graph structure, agent versions and evaluation evidence before promotion.
- Preserve actor, policy, evidence and correlation metadata for consequential decisions.
- Bound queries, payloads, execution duration and external tool responses.
- Require human review for high-impact actions and maintain an explicit rollback strategy.
- Use synthetic data for demos; conduct threat modelling, provider-risk review and operational readiness testing before production.

## 7. Illustrative dashboard gallery

These 12 views are **illustrative SVG dashboard concepts**, not screenshots captured from a running deployment. They contain synthetic sample values and do not prove that every depicted module is implemented. They are arranged in a single vertical column for full-width inspection.

### 01. AgentOps command center

Agent operations overview showing registered agents, active runs, approval backlog, reliability signals and platform health. All values are synthetic.

![AegisFlow AgentOps command center](docs/assets/dashboard/01-agentops-command-center.svg)

### 02. Agent registry

Agent registry view showing identity, owner, environment, model/provider, lifecycle state and governance metadata. All entries are illustrative.

![AegisFlow Agent registry](docs/assets/dashboard/02-agent-registry.svg)

### 03. Workflow studio

Workflow design workspace for composing agent steps, tool boundaries, retry policies and human approval checkpoints. This is a design concept.

![AegisFlow Workflow studio](docs/assets/dashboard/03-workflow-studio.svg)

### 04. Run & trace explorer

Execution trace explorer showing run timelines, step outcomes, tool calls, latency and failure context. All traces are synthetic.

![AegisFlow Run & trace explorer](docs/assets/dashboard/04-run-trace-explorer.svg)

### 05. Human approval inbox

Human approval inbox for risk-aware review of proposed actions, approver decisions, rationale and request expiry. All requests are synthetic.

![AegisFlow Human approval inbox](docs/assets/dashboard/05-human-approval-inbox.svg)

### 06. Evaluation & quality gates

Evaluation quality gates view for task success, groundedness, policy adherence, regression outcomes and release thresholds. All scores are illustrative.

![AegisFlow Evaluation & quality gates](docs/assets/dashboard/06-evaluation-quality-gates.svg)

### 07. Agent cost intelligence

Agent cost intelligence view for token usage, provider spend, cost per successful task and budget trends. All financial figures are synthetic.

![AegisFlow Agent cost intelligence](docs/assets/dashboard/07-agent-cost-intelligence.svg)

### 08. Budget & policy governance

Budget and policy governance view for per-agent limits, spend alerts, tool permissions and enforced operational guardrails. All policies are examples.

![AegisFlow Budget & policy governance](docs/assets/dashboard/08-budget-policy-governance.svg)

### 09. Prompt & version governance

Prompt and version governance view for prompt revisions, evaluation history, approval state and controlled promotion. All versions are illustrative.

![AegisFlow Prompt & version governance](docs/assets/dashboard/09-prompt-version-governance.svg)

### 10. Tool & integration health

Tool integration health view for connector availability, authentication state, rate limits and recent execution failures. All telemetry is synthetic.

![AegisFlow Tool & integration health](docs/assets/dashboard/10-tool-integration-health.svg)

### 11. Audit explorer

Audit explorer view for attributable agent actions, approvals, tool access and policy decisions with traceable event history. All events are synthetic.

![AegisFlow Audit explorer](docs/assets/dashboard/11-audit-explorer.svg)

### 12. Workflow promotion governance

Workflow promotion governance view for environment-specific releases, evaluation gates, approval checkpoints and rollback readiness. All release data is illustrative.

![AegisFlow Workflow promotion governance](docs/assets/dashboard/12-workflow-promotion-governance.svg)


## 8. Engineering delivery

GitHub Actions includes platform CI, CodeQL, secret scanning and dependency auditing. Review current dependency results before release. A committed reproducible npm lockfile is enforced in CI and the latest audit reports zero known vulnerabilities. Remaining priorities include ongoing advisory monitoring, cross-tenant authorization integration tests, browser E2E/accessibility coverage, immutable action pinning, execution observability and backup/restore validation.

## 9. Documentation

- [Architecture](docs/architecture.md)
- [Evaluation quality intelligence](docs/evaluation-quality-intelligence.md)
- [Workflow execution runtime](docs/workflow-execution-runtime.md)
- [Observability foundation](docs/observability-foundation.md)
- [Web workspace guide](apps/web/README.md)

## 10. Roadmap

1. Expand tenant and authorization integration coverage.
2. Add durable execution infrastructure, idempotency, retries and run recovery.
3. Add agent/prompt version regression suites and richer eval datasets.
4. Add reproducible lockfiles and eliminate remaining dependency advisories.
5. Add tool permission boundaries, sandboxing, quotas and provider health controls.
6. Add accessibility, end-to-end tests, operational runbooks and disaster recovery.

## 11. Responsible claims

AegisFlow is an actively developed AgentOps portfolio project. Illustrative dashboard modules are not proof of deployed capability. Evaluation scores are quality signals, not guarantees of safe behavior. Production use requires workload-specific threat modelling, human oversight, runtime isolation, monitoring and incident response.
