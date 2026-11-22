import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { Workflow } from "../models/workflow.model.js";
import { WorkflowVersion } from "../models/workflow-version.model.js";
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
  config: z.record(z.unknown()).default({})
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

function validateGraph(nodes: WorkflowNodeInput[], edges: WorkflowEdgeInput[]) {
  const issues = validateWorkflowGraph(nodes, edges);
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
  validateGraph(input.graph.nodes, input.graph.edges);
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
  validateGraph(input.nodes, input.edges);
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

workflowsRouter.post("/:workflowId/versions/:version/promote", requirePermission("workflows:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const workflowId = idSchema.parse(req.params.workflowId);
  const versionNumber = z.coerce.number().int().min(1).parse(req.params.version);
  const version = await WorkflowVersion.findOne({ tenantId: auth.tenantId, workflowId, version: versionNumber }).lean();
  if (!version) { res.status(404).json({ error: { code: "VERSION_NOT_FOUND", message: "Workflow version not found." } }); return; }
  const workflow = await Workflow.findOneAndUpdate(
    { _id: workflowId, tenantId: auth.tenantId, status: { $ne: "archived" } },
    { $set: { activeVersion: versionNumber, status: "published" } }, { new: true }
  );
  if (!workflow) { res.status(404).json({ error: { code: "WORKFLOW_NOT_FOUND_OR_LOCKED", message: "Workflow not found or archived." } }); return; }
  await audit(req, auth, "workflow.version.promoted", workflowId, { version: versionNumber, graphHash: version.graphHash });
  res.json({ data: workflow });
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
