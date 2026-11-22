# AI cost intelligence and budget governance

AegisFlow records provider-reported input/output token counts on agent execution steps. The cost foundation adds tenant-owned model rates and transparent estimated-spend aggregation. Budget governance adds tenant, model and agent monthly policy scopes.

## Rate card

- Each tenant configures its own USD-per-million-token input and output rates.
- Rates are keyed by provider and normalized model name.
- No default prices are assumed; missing rates remain unpriced.
- Rate changes are audited and require owner/admin permission.
- The configured source and effective date are retained as metadata.

## Cost API

- `GET /api/v1/costs/pricing` — read configured rates.
- `PUT /api/v1/costs/pricing` — upsert a model rate.
- `GET /api/v1/costs/overview?range=24h|7d|30d` — estimate spend from provider usage.

## Budget governance API

- `GET /api/v1/budgets` — list tenant policies with current-month estimated spend, remaining amount, utilization, warning and exceeded states.
- `PUT /api/v1/budgets` — create or update a policy.
- `DELETE /api/v1/budgets/:scopeType?scopeValue=...` — remove a policy.

Example tenant-wide policy:

```json
{
  "scopeType": "tenant",
  "scopeValue": "*",
  "monthlyLimitUsd": 500,
  "warningThresholdPercent": 80,
  "enforcement": "soft",
  "enabled": true
}
```

Scope values:
- `tenant`: exactly `*`.
- `agent`: the tenant-owned agent's MongoDB ID.
- `model`: `provider/model`, for example `openai/gpt-4.1`.

Policies use UTC calendar months. Each policy has a USD monthly limit, a warning threshold from 1–99%, an enabled flag, and a soft/hard enforcement mode. Owner/admin can create, update and delete policies; operator/viewer can read them. All queries are tenant-scoped and mutations are audited. Hard policies block new workflow-run admission once observed estimated month-to-date spend reaches the configured cap; idempotent replays are still returned. If the 5,000-run accounting window is saturated, admission fails closed with `BUDGET_USAGE_INCOMPLETE` rather than pretending the cap is safe.

Budget usage is calculated from recorded provider token usage using the current configured model rates. Agent scope is attributed through the run's private pinned agent snapshot and matching node ID. The API samples at most 5,000 recent monthly runs and reports the sampled flag. Unknown model rates are excluded from estimated spend, so configure rate cards before relying on budget utilization.



## Budget governance and admission controls

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/budgets` | `budgets:read` | List monthly policies and estimated utilization |
| PUT | `/budgets` | `budgets:manage` | Upsert tenant, agent or model monthly policy |
| DELETE | `/budgets/:scopeType?scopeValue=...` | `budgets:manage` | Delete a policy |

Budget body example:

```json
{
  "scopeType": "tenant",
  "scopeValue": "*",
  "monthlyLimitUsd": 500,
  "warningThresholdPercent": 80,
  "enforcement": "hard",
  "enabled": true
}
```

Supported scopes are tenant (`*`), agent (tenant-owned agent ID), and model (`provider/model`). Budgets use UTC calendar months and current configured rates. Hard policies reject new run admission with HTTP 429 / `BUDGET_LIMIT_REACHED` when observed spend is at or above the cap. If the accounting sample reaches 5,000 runs, admission fails closed with HTTP 503 / `BUDGET_USAGE_INCOMPLETE`. This is best-effort admission control: in-flight work and concurrent admission races can still exceed the configured amount. Persistent alerts and atomic spend reservations remain future work.

## Estimate formula

`(inputTokens × inputUsdPerMillionTokens + outputTokens × outputUsdPerMillionTokens) / 1,000,000`

## Important limitations

These are estimates, not provider invoices. The current implementation applies the currently configured rate card to all selected historical runs. It does not retain immutable price snapshots, so editing a rate can revise historical estimates. Provider cached-token pricing, batch discounts, tool/image/audio charges, taxes, FX, and billing-grade reconciliation are not included. Budget threshold states are derived on read; persistent alert delivery, atomic spend reservations and strict concurrent hard-cap enforcement are future work. Concurrent run admissions can race before either run records provider usage. Hard policies therefore provide a best-effort admission gate, not a guaranteed billing ceiling. The 5,000-run sample limit means large tenants should treat sampled budget totals as lower-bound operational estimates; hard admission fails closed when the window is saturated.
