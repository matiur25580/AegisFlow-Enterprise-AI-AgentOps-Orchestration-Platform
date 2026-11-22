import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ExecutionRun } from "../models/execution-run.model.js";
import { Approval } from "../models/approval.model.js";
import type { AuthContext } from "../auth/types.js";
import { buildRunOverview, metricRangeMs, type MetricRange } from "../observability/metrics.js";

export const observabilityRouter = Router();
observabilityRouter.use(authenticate);

const rangeSchema = z.enum(["24h", "7d", "30d"]);

observabilityRouter.get("/overview", requirePermission("runs:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const parsedRange = rangeSchema.safeParse(req.query.range ?? "24h");
  if (!parsedRange.success) {
    res.status(400).json({ error: { code: "INVALID_METRIC_RANGE", message: "Range must be 24h, 7d or 30d." } });
    return;
  }
  const range: MetricRange = parsedRange.data;
  const now = new Date();
  const from = new Date(now.getTime() - metricRangeMs[range]);
  const [runs, pendingApprovals] = await Promise.all([
    ExecutionRun.find({ tenantId: auth.tenantId, createdAt: { $gte: from, $lte: now } })
      .sort({ createdAt: -1 }).limit(5000)
      .select("status createdAt startedAt completedAt").lean(),
    Approval.countDocuments({ tenantId: auth.tenantId, status: "pending" })
  ]);
  const overview = buildRunOverview(runs, range, now);
  res.json({
    data: {
      ...overview,
      pendingApprovals,
      sampleLimit: 5000,
      sampled: runs.length === 5000
    }
  });
}));

observabilityRouter.get("/runs/:runId/trace", requirePermission("runs:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const runId = z.string().regex(/^[a-f\\d]{24}$/i).parse(req.params.runId);
  const run = await ExecutionRun.findOne({ _id: runId, tenantId: auth.tenantId })
    .select("-nodes -edges -leaseToken -leaseExpiresAt -cancelRequestedAt -idempotencyKey")
    .lean();
  if (!run) {
    res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Execution run was not found in this workspace." } });
    return;
  }
  const steps = (run.steps ?? []).map((step: Record<string, unknown>) => {
    const startedAt = step.startedAt instanceof Date ? step.startedAt : step.startedAt ? new Date(String(step.startedAt)) : null;
    const completedAt = step.completedAt instanceof Date ? step.completedAt : step.completedAt ? new Date(String(step.completedAt)) : null;
    const durationMs = startedAt && completedAt && completedAt >= startedAt ? completedAt.getTime() - startedAt.getTime() : null;
    const rawError = typeof step.error === "string" ? step.error : "";
    const errorCode = rawError.includes(":") ? rawError.slice(0, rawError.indexOf(":")) : rawError ? "STEP_FAILED" : null;
    return {
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      label: step.label,
      status: step.status,
      attempt: step.attempt,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      durationMs,
      errorCode
    };
  });
  const rawLastError = typeof run.lastError === "string" ? run.lastError : "";
  const lastErrorCode = rawLastError.includes(":") ? rawLastError.slice(0, rawLastError.indexOf(":")) : rawLastError ? "EXECUTION_FAILED" : null;
  res.json({
    data: {
      runId: String(run._id),
      workflowId: String(run.workflowId),
      workflowVersion: run.workflowVersion,
      graphHash: run.graphHash,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      totalDurationMs: run.startedAt && run.completedAt ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) : null,
      lastErrorCode,
      steps
    }
  });
}));
