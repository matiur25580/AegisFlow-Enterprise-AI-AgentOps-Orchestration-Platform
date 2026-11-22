# AI provider execution and secrets vault

AegisFlow can execute agent nodes through OpenAI Chat Completions, Anthropic Messages, and Google Gemini generateContent adapters.

## Tenant secrets vault

The API provides an application-managed encrypted secret vault. It is a secure baseline for local development and controlled deployments; organizations requiring centralized rotation, HSM-backed key custody, or external policy enforcement should replace the resolver with Vault, AWS Secrets Manager, Azure Key Vault, or Google Secret Manager.

Configure `SECRETS_ENCRYPTION_KEY` as exactly 32 cryptographically random bytes encoded as 64 hexadecimal characters. Generate one with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the key in the deployment secret store, never in MongoDB or source control. Back it up securely: losing it makes existing ciphertext unrecoverable. Rotation requires a deliberate decrypt/re-encrypt migration before replacing the key.

Secrets are encrypted using AES-256-GCM with a fresh 96-bit nonce and authentication tag per write. The database stores ciphertext, nonce and tag; API list/create responses never return these fields or the plaintext key. Records are scoped by tenant and opaque reference. Owner/admin roles can manage secrets; viewers/operators cannot read or change them.

### Secret API

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/secrets` | `secrets:read` | List metadata only |
| POST | `/secrets` | `secrets:manage` | Create or rotate a provider key |
| DELETE | `/secrets/:slug` | `secrets:manage` | Delete a tenant secret |

Example:

```http
POST /api/v1/secrets
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "name": "Production OpenAI",
  "slug": "primary-openai",
  "provider": "openai",
  "apiKey": "<provider-api-key>"
}
```

The response includes the reference `aegisflow:primary-openai`, not the credential. Set that reference on the agent's `secretRef` field. The secret's provider must match the agent provider. Secret values are never returned after creation.

## Agent execution

When a run is queued, the API resolves every referenced agent within the authenticated tenant, reads its active immutable version, and pins the provider, model, secret reference, system prompt, temperature, token limit, timeout and response format into a private run snapshot. The snapshot is immutable and retained for retries, so later agent promotions do not change an already queued run.

The worker resolves the secret by both tenant ID and secret reference, calls the fixed provider endpoint, parses the response and records output plus provider-reported input/output tokens, provider/model and elapsed time on the node step. Worker leases are renewed while a provider request is in flight, preventing a healthy long-running request from being reclaimed by another worker.

Run APIs deliberately omit private agent snapshots from their responses. Run detail and step output remain tenant-scoped and permission-protected. Raw credentials, secret ciphertext, nonces and authentication tags are not included in traces or audit metadata.

## Provider behavior

| Provider | Endpoint/API | Usage |
| --- | --- | --- |
| OpenAI | Chat Completions | Prompt and completion tokens |
| Anthropic | Messages | Input and output tokens |
| Google | Gemini generateContent | Prompt and candidate tokens |

Requests have a bounded timeout. 408, 429, 5xx, timeout and network failures are retryable; invalid credentials and malformed JSON output fail without retry. Upstream response bodies and secret resolver errors are sanitized before they reach persisted execution errors. Google credentials are sent in a request header rather than a query string.

## Operational limitations

- This first vault stores encrypted credentials in the same MongoDB cluster as application data. Protect database access and the encryption key independently.
- Key rotation tooling, external secrets-manager adapters, provider spend pricing, per-tenant budgets and token-cost accounting are not yet implemented.
- Provider usage is recorded only when the upstream response includes token counts; it is not a billing ledger.
- Provider execution is at-least-once across worker crashes. A provider may process a request even if the worker loses its process before checkpointing the response. A stable provider idempotency mechanism is still required where supported.
- Agent tools/function calling, streaming responses, multimodal input and provider-specific structured-output constraints are future work.

Unit tests use mocked provider responses and a fake secret resolver; encryption tests verify AES-GCM round trips, nonce uniqueness and tamper rejection. No live provider credentials or network calls are required by the test suite.
