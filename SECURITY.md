# Security Policy

## Reporting

Do not post credentials, private prompts, customer data, exploit details, or sensitive execution traces in public issues. Use GitHub's private vulnerability reporting channel when available. Provide affected components, impact, safe reproduction steps, and redacted evidence.

## Security requirements

- Treat agent instructions, tool outputs, retrieved documents, and external events as untrusted input.
- Enforce tenant isolation and server-side authorization for every agent, run, secret, and artifact.
- Apply least privilege and explicit allowlists to tools and external actions.
- Require human approval for high-impact or irreversible actions.
- Isolate agent execution from control-plane credentials and other tenants.
- Apply time, token, cost, concurrency, and retry budgets to every run.
- Redact secrets and sensitive payloads from logs, traces, and model context where possible.
- Record actor, policy version, tool calls, approvals, and outcomes in auditable run history.
- Never treat model output as proof that an action succeeded or a policy was satisfied.

## Project status

AegisFlow is in its foundation phase. This policy describes intended safeguards, not implemented or independently verified controls.
