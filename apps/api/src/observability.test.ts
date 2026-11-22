import test from "node:test";
import assert from "node:assert/strict";
import { buildRunOverview } from "./observability/metrics.js";

test("buildRunOverview groups statuses and throughput into the requested range", () => {
  const now = new Date("2026-11-22T12:00:00.000Z");
  const runs = [
    { status: "succeeded", createdAt: "2026-11-22T11:00:00.000Z", startedAt: "2026-11-22T11:00:00.000Z", completedAt: "2026-11-22T11:00:02.000Z" },
    { status: "failed", createdAt: "2026-11-22T10:00:00.000Z", startedAt: "2026-11-22T10:00:00.000Z", completedAt: "2026-11-22T10:00:04.000Z" },
    { status: "waiting_approval", createdAt: "2026-11-22T09:00:00.000Z" },
    { status: "cancelled", createdAt: "2026-11-22T08:00:00.000Z" }
  ];
  const result = buildRunOverview(runs, "24h", now);
  assert.deepEqual(result.totals, { total: 4, succeeded: 1, failed: 1, waitingApproval: 1, running: 0, queued: 0, cancelled: 1 });
  assert.equal(result.successRate, 33.33);
  assert.equal(result.averageDurationMs, 3000);
  assert.equal(result.throughput.length, 24);
  assert.equal(result.throughput.reduce((sum, bucket) => sum + bucket.total, 0), 4);
});

test("buildRunOverview handles empty data without NaN values", () => {
  const result = buildRunOverview([], "7d", new Date("2026-11-22T12:00:00.000Z"));
  assert.equal(result.totals.total, 0);
  assert.equal(result.successRate, 0);
  assert.equal(result.averageDurationMs, null);
  assert.equal(result.throughput.length, 7);
});
