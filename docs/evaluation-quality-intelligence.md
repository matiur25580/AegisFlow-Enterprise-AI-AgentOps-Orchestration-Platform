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

## Regression-aware release gates

A suite may define an optional `releaseGate` when created:

```json
{
  "releaseGate": {
    "minScore": 80,
    "maxRegressionPoints": 10
  }
}
```

Both values are bounded from 0 to 100. Defaults are 80 and 10 respectively. Each run compares its weighted score with the most recent prior run for the same tenant and suite. The run stores a gate snapshot containing `passed` or `blocked`, the configured thresholds, previous score, regression points, and human-readable reasons. A first run has no regression baseline. Falling below the minimum score or exceeding the permitted regression blocks promotion; it does not prevent the evaluation run from being recorded. The gate result is also included in the evaluation audit event.

## Current scope and limitations

The UI accepts candidate outputs and submits them to the scoring API. It does not yet invoke an LLM provider. There is no model-as-judge, latency measurement, token/cost accounting, dataset import/export, or automated multi-version execution yet. Treat these scores as deterministic checks of submitted outputs, not as a comprehensive measure of model quality.

For production-grade provider evaluation, connect the evaluator to the future provider adapter using a controlled execution sandbox, redacted fixtures, timeouts, budget limits, and explicit secret-manager integration.
