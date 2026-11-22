# AI provider adapter foundation

AegisFlow now has a provider-independent HTTP adapter contract and initial adapters for OpenAI, Anthropic, and Google Gemini.

## Contract

- `AgentProviderExecutor.execute(config, input)` returns response text, provider/model identifiers, elapsed time, and token usage when the upstream provider reports it.
- Secret resolution is injected through `SecretResolver`. The resolver receives the authenticated tenant ID, provider, and opaque secret reference.
- No API key is stored in agent documents, workflow graphs, run snapshots, audit metadata, or application source.
- Provider endpoints are fixed in code. Arbitrary base URLs and custom endpoints are not accepted, preventing user-controlled server-side request forgery.
- Requests use a bounded abort timeout based on the immutable agent version configuration.
- Provider error bodies and credential values are deliberately excluded from thrown error messages.
- 408, 429, 5xx, timeout, and network failures are marked retryable; credential rejection and unsupported provider configurations fail closed.

## Supported providers

| Provider | Adapter | Response usage |
| --- | --- | --- |
| OpenAI | Chat Completions | Prompt and completion tokens |
| Anthropic | Messages API | Input and output tokens |
| Google | Gemini generateContent | Prompt and candidate token counts |

Azure OpenAI, Bedrock, and custom providers remain unsupported by this first adapter implementation.

## Integration boundary

This is the adapter and secret-resolution contract, not a production secrets-manager integration. A deployment must provide a tenant-aware implementation backed by Vault, AWS Secrets Manager, Azure Key Vault, or Google Secret Manager before any live provider call is enabled. There is intentionally no environment-variable fallback or hard-coded credential source.

The existing workflow worker still fails agent nodes closed until the application composition root injects a configured secret resolver and pins each agent version into the execution snapshot. That wiring is a required follow-up; this change does not silently activate provider calls.

## Verification

Unit tests use mocked fetch responses and a fake resolver. They cover provider request construction, usage extraction, missing secrets, unsupported providers, and safe handling of upstream errors. No live provider credentials or network calls are required.
