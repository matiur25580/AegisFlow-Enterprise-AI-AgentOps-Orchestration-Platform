import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { Workflow } from "../models/workflow.model.js";
import { WorkflowVersion } from "../models/workflow-version.model.js";
import { Agent } from "../models/agent.model.js";
import { AgentVersion } from "../models/agent-version.model.js";
import { ExecutionRun } from "../models/execution-run.model.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";

export const runsRouter = Router();
runsRouter.use(authenticate);
const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const keySchema = z.string().trim().min(1).max(128).regex(/^[\w.:/-]+$/);
async function audit(auth: AuthContext, action: string, runId: string, metadata: Record<string, unknown> = {}) {
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action, resourceType: "execution_run", resourceId: runId, metadata });
}

runsRouter.post("/workflows/:workflowId/runs", requirePermission("runs:operate"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const workflow = await Workflow.findOne({ _id: workflowId, tenantId: auth.tenantId, status: "published", activeVersion: { $ne: null } }).lean();
  if (!workflow || !workflow.activeVersion) {
    res.status(404).json({ error: { code: "PUBLISHED_WORKFLOW_NOT_FOUND", message: "A published workflow with an active version was not found." } }); return;
  }
  const version = await WorkflowVersion.findOne({ tenantId: auth.tenantId, workflowId, version: workflow.activeVersion }).lean();
  if (!version) { res.status(409).json({ error: { code: "ACTIVE_VERSION_MISSING", message: "The active workflow snapshot is missing." } }); return; }
  const agentIds = [...new Set(version.nodes.filter(node => node.type === "agent").map(node => node.config?.agentId).filter((id): id is string => typeof id === "string"))];
  const agentSnapshots: Array<Record<string, unknown>> = [];
  if (agentIds.length) {
    const agents = await Agent.find({ tenantId: auth.tenantId, _id: { $in: agentIds }, status: "active", activeVersion: { $ne: null } })
      .select("_id activeVersion provider model secretRef").lean();
    const versions = await AgentVersion.find({ tenantId: auth.tenantId, agentId: { $in: agents.map(agent => agent._id) }, version: { $in: agents.map(agent => agent.activeVersion) } })
      .select("agentId version systemPrompt temperature maxOutputTokens timeoutMs responseFormat").lean();
    for (const id of agentIds) {
      const agent = agents.find(item => String(item._id) === id);
      const versionSnapshot = agent && versions.find(item => String(item.agentId) === id && item.version === agent.activeVersion);
      if (!agent || !versionSnapshot) {
        res.status(409).json({ error: { code: "AGENT_NOT_EXECUTABLE", message: `Agent "${id}" is not active with a valid active version.` } }); return;
      }
      for (const node of version.nodes.filter(item => item.type === "agent" && item.config?.agentId === id)) {
        agentSnapshots.push({
          nodeId: node.id, agentId: id, agentVersion: versionSnapshot.version,
          provider: agent.provider, model: agent.model, secretRef: agent.secretRef ?? null,
          systemPrompt: versionSnapshot.systemPrompt, temperature: versionSnapshot.temperature,
          maxOutputTokens: versionSnapshot.maxOutputTokens, timeoutMs: versionSnapshot.timeoutMs,
          responseFormat: versionSnapshot.responseFormat
        });
      }
    }
  }
  const suppliedKey = req.header("Idempotency-Key");
  const idempotencyKey = suppliedKey ? keySchema.parse(suppliedKey) : randomUUID();
  const existing = await ExecutionRun.findOne({ tenantId: auth.tenantId, workflowId, idempotencyKey }).lean();
  if (existing) { res.status(200).json({ data: existing, idempotentReplay: true }); return; }
  const run = await ExecutionRun.create({
    tenantId: auth.tenantId, workflowId, workflowVersion: version.version, graphHash: version.graphHash,
    nodes: version.nodes, edges: version.edges, agentSnapshots, status: "queued", idempotencyKey, requestedBy: auth.userId, nextAttemptAt: new Date()
  });
  await audit(auth, "run.queued", String(run._id), { workflowId, workflowVersion: version.version, graphHash: version.graphHash });
  res.status(202).json({ data: run, idempotentReplay: false });
}));

runsRouter.get("/", requirePermission("runs:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter: Record<string, unknown> = { tenantId: auth.tenantId };
  if (typeof req.query.status === "string" && ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"].includes(req.query.status)) filter.status = req.query.status;
  if (typeof req.query.workflowId === "string") filter.workflowId = idSchema.parse(req.query.workflowId);
  const [items, total] = await Promise.all([
    ExecutionRun.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select("-nodes -edges").lean(),
    ExecutionRun.countDocuments(filter)
  ]);
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

runsRouter.get("/:runId", requirePermission("runs:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const runId = idSchema.parse(req.params.runId);
  const run = await ExecutionRun.findOne({ _id: runId, tenantId: auth.tenantId }).lean();
  if (!run) { res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Execution run not found." } }); return; }
  res.json({ data: run });
}));

runsRouter.post("/:runId/cancel", requirePermission("runs:operate"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const runId = idSchema.parse(req.params.runId);
  const run = await ExecutionRun.findOneAndUpdate({ _id: runId, tenantId: auth.tenantId, status: { $in: ["queued", "running", "waiting_approval"] } }, { $set: { cancelRequestedAt: new Date() } }, { new: true });
  if (!run) { res.status(409).json({ error: { code: "RUN_NOT_CANCELLABLE", message: "Run was not found or is already terminal." } }); return; }
  if (run.status === "queued" || run.status === "waiting_approval") { run.status = "cancelled"; run.completedAt = new Date(); await run.save(); }
  if (run.status === "cancelled") {
    const { Approval } = await import("../models/approval.model.js");
    await Approval.updateMany({ tenantId: auth.tenantId, runId, status: "pending" }, { $set: { status: "cancelled", decidedAt: new Date(), decisionComment: "Workflow run cancelled." } });
  }
  await audit(auth, "run.cancel_requested", runId);
  res.json({ data: run });
}));

runsRouter.post("/:runId/retry", requirePermission("runs:operate"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const runId = idSchema.parse(req.params.runId);
  const source = await ExecutionRun.findOne({ _id: runId, tenantId: auth.tenantId, status: "failed" }).lean();
  if (!source) { res.status(409).json({ error: { code: "RUN_NOT_RETRYABLE", message: "Only failed runs can be retried." } }); return; }
  const retry = await ExecutionRun.create({
    tenantId: source.tenantId, workflowId: source.workflowId, workflowVersion: source.workflowVersion, graphHash: source.graphHash,
    nodes: source.nodes, edges: source.edges, status: "queued", idempotencyKey: `retry:${runId}:${randomUUID()}`,
    requestedBy: auth.userId, currentNodeId: source.currentNodeId, steps: source.steps.filter(step => step.status === "succeeded"),
    nextAttemptAt: new Date(), retryOf: source._id
  });
  await audit(auth, "run.retried", String(retry._id), { retryOf: runId });
  res.status(202).json({ data: retry });
}));
