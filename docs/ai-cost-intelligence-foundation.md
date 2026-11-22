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
- `GET /api/v1/budget-alerts?limit=50` — evaluate current monthly usage and list persistent alert history.
- `PATCH /api/v1/budget-alerts/:alertId/read` — mark one tenant-owned alert as read.

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

## Persistent in-app budget alerts

The budget alert evaluator runs when the authenticated alert-history endpoint is read. It evaluates enabled policies against the current UTC month and persists a warning event once the configured warning threshold is crossed, or an exceeded event once spend reaches the limit. A unique tenant + policy + month + event key prevents duplicate records on repeated reads. Alerts capture the observed estimated spend, limit, utilization, threshold, scope and period at creation time. The alert history is tenant-isolated; viewers and operators can read and mark alerts as read.

If the 5,000-run sample is saturated, the evaluator deliberately skips alert creation because the sampled total may understate actual spend. The response exposes `sampleSaturated` so clients can display that limitation. A warning is only created if the observed state is warning-but-not-exceeded; if usage jumps directly beyond the cap, the evaluator records the exceeded event. External email/webhook delivery, automatic push notifications, recovery events, scheduled background evaluation and atomic spend reservations remain future work. This is an in-app persisted event history, not a real-time delivery guarantee.

## Estimate formula

`(inputTokens × inputUsdPerMillionTokens + outputTokens × outputUsdPerMillionTokens) / 1,000,000`

## Important limitations

These are estimates, not provider invoices. The current implementation applies the currently configured rate card to all selected historical runs. It does not retain immutable price snapshots, so editing a rate can revise historical estimates. Provider cached-token pricing, batch discounts, tool/image/audio charges, taxes, FX, and billing-grade reconciliation are not included. Budget threshold states are derived from current usage. Concurrent run admissions can race before either run records provider usage. Hard policies therefore provide a best-effort admission gate, not a guaranteed billing ceiling. The 5,000-run sample limit means large tenants should treat sampled budget totals as lower-bound operational estimates; hard admission fails closed when the window is saturated.

## Budget Management workspace

The React navigation entry **Govern → Budgets** provides a browser interface for listing tenant, agent and model policies; displaying estimated spend and utilization; creating, editing and deleting policies; and showing when the 5,000-run accounting sample is saturated. The screen uses the authenticated API session and refresh-cookie flow. Backend permissions remain authoritative.

The enabled monthly-limit KPI sums configured limits across scopes and is not a unique workspace cap. Estimates are not invoices. Hard enforcement remains best-effort admission control; it is not a strict billing ceiling.
