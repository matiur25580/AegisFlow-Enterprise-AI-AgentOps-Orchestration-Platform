# Evaluation and quality intelligence

This milestone adds tenant-scoped evaluation suites and immutable evaluation-run snapshots.

## API

All routes require authentication and derive tenant scope from the authenticated membership.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/evaluations/suites` | `evaluations:read` | List workspace suites |
| POST | `/evaluations/suites` | `evaluations:write` | Create a suite with version-pinned optional agent association |
| GET | `/evaluations/suites/:suiteId` | `evaluations:read` | Read suite and recent history |
| POST | `/evaluations/suites/:suiteId/runs` | `evaluations:run` | Score submitted candidate outputs |
| GET | `/evaluations/runs` | `evaluations:read` | List recent evaluation runs |

## Scoring

- `exact_match`: deterministic structural JSON comparison; object key order is ignored.
- `contains`: case-sensitive substring check for string expected/actual values.
- Scores are weighted by each case's positive weight and reported from 0 to 100.
- Missing outputs fail. Duplicate case IDs and IDs not present in the suite are rejected.
- Suite definitions and result snapshots are persisted under the tenant ID. Runs record the suite metric and pinned agent version at evaluation time.

## Current scope and limitations

The UI accepts candidate outputs and submits them to the scoring API. It does not yet invoke an LLM provider. There is no model-as-judge, latency measurement, token/cost accounting, regression threshold policy, dataset import/export, or multi-version comparison yet. Treat these scores as deterministic checks of submitted outputs, not as a comprehensive measure of model quality.

For production-grade provider evaluation, connect the evaluator to the future provider adapter using a controlled execution sandbox, redacted fixtures, timeouts, budget limits, and explicit secret-manager integration.
