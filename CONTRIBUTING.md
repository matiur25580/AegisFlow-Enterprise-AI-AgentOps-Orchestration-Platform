# Contributing

AegisFlow is an early-stage AgentOps platform. Contributions should make agent execution safer, observable, and bounded.

## Before starting
- Read README.md and SECURITY.md.
- Discuss changes to execution isolation, tool permissions, tenancy, or approval workflows before implementation.
- Never commit API keys, private prompts, customer data, or sensitive run traces.

## Engineering expectations
- Treat prompts, tool outputs, retrieved content, and events as untrusted.
- Enforce tenant isolation and authorization server-side.
- Use explicit tool allowlists and least-privilege credentials.
- Bound runtime, tokens, cost, concurrency, and retries.
- Require human approval for high-impact actions.
- Add tests for permission boundaries, prompt/tool injection paths, cancellation, and failure handling.
- Log auditable metadata without exposing secrets or sensitive payloads.

## Pull requests
Describe the risk addressed, behavioral changes, tests and commands run, approval requirements, observability impact, and known limitations. Do not imply a control is implemented unless it is covered by code and tests.
