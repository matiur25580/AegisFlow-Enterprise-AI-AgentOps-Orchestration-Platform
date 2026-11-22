import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { Router, type Request } from "express";
import { z } from "zod";
import { Workflow } from "../models/workflow.model.js";
import { Agent } from "../models/agent.model.js";
import { Membership } from "../models/membership.model.js";
import { WorkflowVersion } from "../models/workflow-version.model.js";
import { WorkflowPromotion } from "../models/workflow-promotion.model.js";
import { EvaluationSuite } from "../models/evaluation-suite.model.js";
import { EvaluationRun } from "../models/evaluation-run.model.js";
import { assessWorkflowPromotion, type AgentPromotionEvidence } from "../workflows/promotion-governance.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";
import { validateWorkflowGraph, type WorkflowEdgeInput, type WorkflowNodeInput } from "../workflows/graph-validation.js";

export const workflowsRouter = Router();
workflowsRouter.use(authenticate);

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const nodeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(["start", "agent", "condition", "approval", "end"]),
  label: z.string().trim().min(1).max(120),
  position: z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }),
  config: z.record(z.string(), z.unknown()).default({})
});
const edgeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  label: z.string().max(120).optional().default("")
});
const graphSchema = z.object({
  changelog: z.string().max(1000).optional().default(""),
  nodes: z.array(nodeSchema).min(2).max(200),
  edges: z.array(edgeSchema).max(500)
});
const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(slugPattern).max(140),
  description: z.string().max(1000).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional().default([]),
  graph: graphSchema
});
const metadataSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional()
}).strict();
const idSchema = z.string().regex(/^[a-f\d]{24}$/i, "A valid workflow id is required.");

async function audit(req: Request, auth: AuthContext, action: string, workflowId: string, metadata: Record<string, unknown> = {}) {
  await writeAuditEvent({
    tenantId: auth.tenantId, actorUserId: auth.userId, action, resourceType: "workflow",
    resourceId: workflowId, metadata, ipAddress: req.ip
  });
}

async function validateGraph(nodes: WorkflowNodeInput[], edges: WorkflowEdgeInput[], tenantId: string) {
  const issues = validateWorkflowGraph(nodes, edges);
  const agentIds = [...new Set(nodes.filter(node => node.type === "agent").map(node => node.config.agentId).filter((id): id is string => typeof id === "string" && /^[a-f\d]{24}$/i.test(id)))];
  if (agentIds.length) {
    const existing = await Agent.find({ tenantId, _id: { $in: agentIds }, status: { $ne: "archived" } }).select("_id").lean();
    const found = new Set(existing.map(agent => String(agent._id)));
    for (const agentId of agentIds) if (!found.has(agentId)) issues.push({ code: "AGENT_REFERENCE_NOT_FOUND", message: `Agent "${agentId}" does not exist in this workspace or is archived.` });
  }
  const assignedReviewerIds = [...new Set(nodes.filter(node => node.type === "approval")
    .map(node => node.config.assigneeUserId).filter((id): id is string => typeof id === "string" && /^[a-f\\d]{24}$/i.test(id)))];
  if (assignedReviewerIds.length) {
    const memberships = await Membership.find({ tenantId, userId: { $in: assignedReviewerIds }, status: "active", role: { $in: ["owner", "admin", "operator"] } }).select("userId").lean();
    const eligible = new Set(memberships.map(item => String(item.userId)));
    for (const userId of assignedReviewerIds) if (!eligible.has(userId)) {
      issues.push({ code: "APPROVAL_ASSIGNEE_NOT_ELIGIBLE", message: `Approval reviewer "${userId}" is not an active decision-capable member of this workspace.` });
    }
  }
  if (issues.length) {
    const error = Object.assign(new Error("Workflow graph validation failed."), { statusCode: 422, code: "WORKFLOW_GRAPH_INVALID", details: issues });
    throw error;
  }
}

workflowsRouter.get("/", requirePermission("workflows:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter: Record<string, unknown> = { tenantId: auth.tenantId };
  if (typeof req.query.status === "string" && ["draft", "published", "archived"].includes(req.query.status)) filter.status = req.query.status;
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: { $regex: escaped, $options: "i" } }, { slug: { $regex: escaped, $options: "i" } }];
  }
  const [items, total] = await Promise.all([
    Workflow.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Workflow.countDocuments(filter)
  ]);
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

workflowsRouter.post("/", requirePermission("workflows:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = createSchema.parse(req.body);
  await validateGraph(input.graph.nodes, input.graph.edges, auth.tenantId);
  const workflow = await Workflow.create({
    tenantId: auth.tenantId, ownerUserId: auth.userId, name: input.name, slug: input.slug,
    description: input.description, tags: input.tags, status: "draft", latestVersion: 1
  });
  try {
    const graphHash = createHash("sha256").update(JSON.stringify({ nodes: input.graph.nodes, edges: input.graph.edges })).digest("hex");
    const version = await WorkflowVersion.create({
      tenantId: auth.tenantId, workflowId: workflow._id, version: 1, changelog: input.graph.changelog,
      nodes: input.graph.nodes, edges: input.graph.edges, graphHash, createdBy: auth.userId
    });
    await audit(req, auth, "workflow.created", String(workflow._id), { slug: workflow.slug, version: 1, graphHash });
    res.status(201).json({ data: { workflow, version } });
  } catch (error) {
    await Workflow.deleteOne({ _id: workflow._id, tenantId: auth.tenantId });
    throw error;
  }
}));

workflowsRouter.get("/:workflowId", requirePermission("workflows:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const workflow = await Workflow.findOne({ _id: workflowId, tenantId: auth.tenantId }).lean();
  if (!workflow) { res.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found." } }); return; }
  const versions = await WorkflowVersion.find({ workflowId, tenantId: auth.tenantId }).sort({ version: -1 }).lean();
  res.json({ data: { workflow, versions } });
}));

workflowsRouter.patch("/:workflowId", requirePermission("workflows:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const input = metadataSchema.parse(req.body);
  if (!Object.keys(input).length) { res.status(400).json({ error: { code: "EMPTY_UPDATE", message: "At least one metadata field is required." } }); return; }
  const workflow = await Workflow.findOneAndUpdate(
    { _id: workflowId, tenantId: auth.tenantId, status: { $ne: "archived" } },
    { $set: input }, { new: true, runValidators: true }
  );
  if (!workflow) { res.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND_OR_LOCKED", message: "Workflow not found or archived." } }); return; }
  await audit(req, auth, "workflow.metadata.updated", workflowId, { fields: Object.keys(input) });
  res.json({ data: workflow });
}));

workflowsRouter.post("/:workflowId/versions", requirePermission("workflows:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const input = graphSchema.parse(req.body);
  await validateGraph(input.nodes, input.edges, auth.tenantId);
  const workflow = await Workflow.findOneAndUpdate(
    { _id: workflowId, tenantId: auth.tenantId, status: { $in: ["draft", "published"] } },
    { $inc: { latestVersion: 1 } }, { new: true }
  );
  if (!workflow) { res.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND_OR_LOCKED", message: "Workflow not found or archived." } }); return; }
  const graphHash = createHash("sha256").update(JSON.stringify({ nodes: input.nodes, edges: input.edges })).digest("hex");
  const version = await WorkflowVersion.create({
    tenantId: auth.tenantId, workflowId, version: workflow.latestVersion, changelog: input.changelog,
    nodes: input.nodes, edges: input.edges, graphHash, createdBy: auth.userId
  });
  await audit(req, auth, "workflow.version.created", workflowId, { version: version.version, graphHash });
  res.status(201).json({ data: version });
}));

workflowsRouter.get("/:workflowId/promotions", requirePermission("workflows:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const workflow = await Workflow.findOne({ _id: workflowId, tenantId: auth.tenantId }).select("_id").lean();
  if (!workflow) { res.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND", message: "Workflow not found." } }); return; }
  const history = await WorkflowPromotion.find({ tenantId: auth.tenantId, workflowId }).sort({ promotedAt: -1 }).limit(50).lean();
  res.json({ data: history });
}));

workflowsRouter.post("/:workflowId/versions/:version/promote", requirePermission("workflows:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const versionNumber = z.coerce.number().int().min(1).parse(req.params.version);
  const version = await WorkflowVersion.findOne({ tenantId: auth.tenantId, workflowId, version: versionNumber }).lean();
  if (!version) { res.status(404).json({ error: { code: "VERSION_NOT_FOUND", message: "Workflow version not found." } }); return; }

  const nodes = version.nodes as Array<{ type?: string; config?: Record<string, unknown> }>;
  const agentIds = [...new Set(nodes.filter(node => node.type === "agent")
    .map(node => node.config?.agentId)
    .filter((value): value is string => typeof value === "string" && /^[a-f\\d]{24}$/i.test(value)))];
  const agents = agentIds.length
    ? await Agent.find({ tenantId: auth.tenantId, _id: { $in: agentIds } }).select("_id activeVersion status").lean()
    : [];
  const agentById = new Map(agents.map(agent => [String(agent._id), agent]));
  const requiredAgents = agentIds.map(agentId => {
    const agent = agentById.get(agentId);
    return { agentId, activeVersion: agent?.activeVersion ?? null, status: agent?.status ?? "missing" };
  });
  const activeVersionByAgent = new Map(requiredAgents.map(agent => [agent.agentId, agent.activeVersion]));
  const suites = agentIds.length
    ? await EvaluationSuite.find({ tenantId: auth.tenantId, agentId: { $in: agentIds } }).select("_id agentId agentVersion").lean()
    : [];
  const suiteToAgent = new Map<string, string>();
  for (const suite of suites) {
    const agentId = String(suite.agentId);
    if (suite.agentVersion === activeVersionByAgent.get(agentId)) suiteToAgent.set(String(suite._id), agentId);
  }
  const suiteIds = [...suiteToAgent.keys()];
  const runs = suiteIds.length
    ? await EvaluationRun.find({ tenantId: auth.tenantId, suiteId: { $in: suiteIds } })
      .sort({ createdAt: -1, _id: -1 }).select("_id suiteId score gate createdAt").lean()
    : [];
  const latestByAgent = new Map<string, AgentPromotionEvidence>();
  for (const run of runs) {
    const agentId = suiteToAgent.get(String(run.suiteId));
    if (!agentId || latestByAgent.has(agentId)) continue;
    const required = requiredAgents.find(agent => agent.agentId === agentId);
    latestByAgent.set(agentId, {
      agentId,
      agentVersion: required?.activeVersion ?? null,
      suiteId: String(run.suiteId),
      runId: String(run._id),
      score: run.score,
      gateStatus: run.gate?.status === "passed" ? "passed" : "blocked",
      evaluatedAt: run.createdAt
    });
  }
  const assessment = assessWorkflowPromotion(requiredAgents, [...latestByAgent.values()]);
  if (!assessment.eligible) {
    res.status(409).json({
      error: {
        code: "WORKFLOW_PROMOTION_BLOCKED",
        message: "Every agent in this workflow version must have a passing evaluation for its current active version.",
        reasons: assessment.reasons
      },
      data: { eligible: false, agentEvidence: assessment.evidence }
    });
    return;
  }

  const promotedAt = new Date();
  const session = await mongoose.startSession();
  let promotedWorkflow: unknown = null;
  let promotionRecord: unknown = null;
  try {
    await session.withTransaction(async () => {
      const updated = await Workflow.findOneAndUpdate(
        { _id: workflowId, tenantId: auth.tenantId, status: { $ne: "archived" } },
        { $set: { activeVersion: versionNumber, status: "published" } },
        { new: true, session }
      );
      if (!updated) return;
      const [record] = await WorkflowPromotion.create([{
        tenantId: auth.tenantId, workflowId, workflowVersion: versionNumber,
        graphHash: version.graphHash, promotedBy: auth.userId, promotedAt,
        agentEvidence: assessment.evidence
      }], { session });
      promotedWorkflow = updated;
      promotionRecord = record;
    });
  } finally {
    await session.endSession();
  }
  if (!promotedWorkflow) { res.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND_OR_LOCKED", message: "Workflow not found or archived." } }); return; }
  await audit(req, auth, "workflow.version.promoted", workflowId, {
    version: versionNumber, graphHash: version.graphHash,
    evaluatedAgentCount: assessment.evidence.length,
    evaluationRunIds: assessment.evidence.map(item => item.runId)
  });
  res.json({ data: { workflow: promotedWorkflow, promotion: promotionRecord } });
}));

workflowsRouter.patch("/:workflowId/lifecycle", requirePermission("workflows:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const input = z.object({ status: z.enum(["draft", "archived"]) }).strict().parse(req.body);
  const workflow = await Workflow.findOneAndUpdate(
    { _id: workflowId, tenantId: auth.tenantId, status: { $ne: "archived" } },
    { $set: { status: input.status } }, { new: true, runValidators: true }
  );
  if (!workflow) { res.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND_OR_LOCKED", message: "Workflow not found or archived." } }); return; }
  await audit(req, auth, `workflow.${input.status}`, workflowId);
  res.json({ data: workflow });
}));
