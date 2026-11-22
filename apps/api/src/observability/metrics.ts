export type RunMetricRecord = {
  status: string;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
};

export type MetricRange = "24h" | "7d" | "30d";

export const metricRangeMs: Record<MetricRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildRunOverview(
  runs: RunMetricRecord[],
  range: MetricRange,
  now = new Date()
) {
  const duration = metricRangeMs[range];
  const bucketCount = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const bucketMs = duration / bucketCount;
  const from = new Date(now.getTime() - duration);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    start: new Date(from.getTime() + index * bucketMs).toISOString(),
    total: 0,
    succeeded: 0,
    failed: 0,
    waitingApproval: 0,
    running: 0,
    queued: 0
  }));

  const counts = { total: runs.length, succeeded: 0, failed: 0, waitingApproval: 0, running: 0, queued: 0, cancelled: 0 };
  const durations: number[] = [];

  for (const run of runs) {
    const createdAt = asDate(run.createdAt);
    if (createdAt && createdAt >= from && createdAt <= now) {
      const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((createdAt.getTime() - from.getTime()) / bucketMs)));
      const bucket = buckets[index];
      if (!bucket) continue;
      bucket.total += 1;
      if (run.status === "succeeded") bucket.succeeded += 1;
      else if (run.status === "failed") bucket.failed += 1;
      else if (run.status === "waiting_approval") bucket.waitingApproval += 1;
      else if (run.status === "running") bucket.running += 1;
      else if (run.status === "queued") bucket.queued += 1;
    }

    if (Object.hasOwn(counts, run.status)) counts[run.status as keyof typeof counts] += 1;
    if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
      const startedAt = asDate(run.startedAt);
      const completedAt = asDate(run.completedAt);
      if (startedAt && completedAt && completedAt >= startedAt) durations.push(completedAt.getTime() - startedAt.getTime());
    }
  }

  const completed = counts.succeeded + counts.failed + counts.cancelled;
  const successRate = completed ? Number(((counts.succeeded / completed) * 100).toFixed(2)) : 0;
  const averageDurationMs = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : null;

  return {
    range,
    from: from.toISOString(),
    to: now.toISOString(),
    totals: counts,
    successRate,
    averageDurationMs,
    throughput: buckets
  };
}
