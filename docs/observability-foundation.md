# Observability foundation

The first observability slice derives tenant-scoped operational metrics from durable execution records. It intentionally does not fabricate provider token counts, model spend, or distributed spans: those require provider adapters and explicit instrumentation.

## API

All endpoints require a bearer access token and the authenticated tenant context.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/observability/overview?range=24h` | `runs:read` | Run totals, success rate, average duration, throughput buckets and pending approval count |
| GET | `/observability/runs/:runId/trace` | `runs:read` | Sanitized node-level execution timeline for one tenant-owned run |

Supported ranges are `24h`, `7d`, and `30d`. The overview reads at most 5,000 recent runs in the selected period and reports `sampled: true` when the cap is reached. Counts and duration metrics are therefore exact only when the sample cap is not reached.

Trace responses omit workflow graph payloads, node outputs, idempotency keys, worker lease tokens, raw error messages and cancellation internals. They expose error codes only, reducing the risk of leaking prompt content or provider responses through the monitoring UI.

## Metric definitions

- Success rate = succeeded / (succeeded + failed + cancelled) × 100.
- Average duration uses runs with both start and completion timestamps and non-negative elapsed time.
- Throughput buckets group runs by creation time, not completion time.
- Pending approvals is a current tenant-wide snapshot, independent of the selected run time range.

## Deliberate limitations

Provider token usage, model cost, prompt/completion accounting, distributed trace propagation, live streaming logs, alert rules and incident correlation are not represented until agent provider adapters and event instrumentation exist. Do not treat the dashboard metrics as billing-grade data.
