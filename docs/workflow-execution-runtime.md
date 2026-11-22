# Workflow execution runtime

The API starts a MongoDB-backed worker after connecting to the database. It polls every second, atomically claims queued work or runs whose worker lease expired, and checkpoints node progress. A lease token fences stale workers from writing after another worker has reclaimed a run. Runs and graph snapshots survive process restarts.

## API

All endpoints use the authenticated tenant context and the permissions shown below.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| POST | `/workflows/:workflowId/runs` | `runs:operate` | Queue the published active workflow version |
| GET | `/runs?page=1&limit=25&status=queued` | `runs:read` | List tenant runs; optional status and workflowId filters |
| GET | `/runs/:runId` | `runs:read` | Inspect the immutable graph snapshot and step trace |
| POST | `/runs/:runId/cancel` | `runs:operate` | Request cancellation |
| POST | `/runs/:runId/retry` | `runs:operate` | Create a new run from a failed run's pinned version |

Supply an `Idempotency-Key` header (1–128 URL-safe characters) when queueing. The tenant/workflow/key unique index prevents duplicate submissions. If omitted, the API generates a unique key. Run creation returns HTTP 202; replaying a key returns the existing run.

## Runtime behavior and limits

- Lifecycle: `queued → running → succeeded | failed | cancelled`. A queued run is durable before a worker claims it.
- The run pins the exact workflow version, graph hash, nodes and edges, plus every referenced agent active immutable version and provider configuration; later workflow edits or agent promotions do not mutate an in-flight run.
- Node status, attempts, timestamps, output, sanitized error codes, and provider-reported input/output token counts, provider/model and latency are persisted as an execution trace.
- Worker claims use atomic MongoDB updates and expiring lease tokens. A heartbeat renews the lease while a provider call is in flight; expired leases can be reclaimed after a process crash.
- Retry delays use bounded exponential backoff. The worker retries only errors explicitly marked retryable; manual retry creates a new run and preserves the source graph version.
- Cancellation is immediate for queued runs and cooperative at node boundaries for running runs.
- Conditions currently accept only literal `true` or `false`, with outgoing edges labeled accordingly (or ordered true/false). Arbitrary expressions are never evaluated.
- Start and end nodes execute. Agent nodes call the OpenAI, Anthropic or Google adapter using a tenant-scoped encrypted secret reference. The worker resolves credentials at execution time and records provider usage on the step. Approval nodes create a tenant-scoped approval request, pause the run in `waiting_approval`, and release the worker lease. Approval decisions resume the run at the next node; rejection or expiry fails the run.
- Agent nodes are checked at enqueue time for a tenant-owned active agent and active version. The run stores a private immutable agent snapshot; run API responses intentionally omit that snapshot. Concurrent branch fan-out, distributed queue infrastructure and database-backed integration tests remain future milestones.
- Delivery is at-least-once across worker crashes. Any future external node adapter must pass a stable run/node idempotency key to its provider or downstream system before side effects are enabled.

The worker is an in-process poller backed by MongoDB, not a separate queue service. For horizontal scale, run one or more API/worker processes with shared MongoDB; atomic claims prevent two healthy workers from owning the same lease at once. Tune lease and polling intervals against real node timeouts before production use.


Before production rollout, validate worker lease duration against the maximum execution time of every enabled adapter and configure durable backups and monitoring for the execution collection.
