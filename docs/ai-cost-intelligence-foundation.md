# AI cost intelligence foundation

AegisFlow records provider-reported input/output token counts on agent execution steps. This milestone adds a tenant-owned model rate card and transparent estimated-spend aggregation.

## Rate card

- Each tenant configures its own USD-per-million-token input and output rates.
- Rates are keyed by provider and normalized model name.
- No default prices are assumed; missing rates remain unpriced.
- Rate changes are audited and require owner/admin permission.
- The configured source and effective date are retained as metadata.

## API

- `GET /api/v1/costs/pricing` — read configured rates.
- `PUT /api/v1/costs/pricing` — upsert a model rate.
- `GET /api/v1/costs/overview?range=24h|7d|30d` — estimate spend from provider usage.

The overview includes input/output tokens, estimated USD, per-model breakdown, priced/unpriced step counts, pricing coverage, and sampling metadata. All reads and writes are tenant-scoped from authenticated server context.

## Workspace UI

The React Usage & billing workspace is available from the Govern navigation. It supports sign-in, 24-hour/7-day/30-day cost summaries, per-model token and estimated-cost breakdowns, pricing coverage, and owner/admin model-rate configuration. The interface intentionally labels figures as estimates and shows when run sampling is active. Viewers can inspect cost summaries; only owners and admins can save rates.

## Estimate formula

`(inputTokens × inputUsdPerMillionTokens + outputTokens × outputUsdPerMillionTokens) / 1,000,000`

## Important limitations

These are estimates, not provider invoices. The current implementation applies the currently configured rate card to all selected historical runs. It does not yet retain immutable price snapshots on execution steps, so editing a rate can revise historical estimates. Provider cached-token pricing, batch discounts, tool/image/audio charges, taxes, FX, budgets, alerts, and reconciliation are not included. The endpoint samples at most 5,000 runs and exposes that condition in its response.
