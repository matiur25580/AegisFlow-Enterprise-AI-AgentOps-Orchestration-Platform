import { Router, type Request } from "express";
import { z } from "zod";
import { Agent } from "../models/agent.model.js";
import { AgentVersion } from "../models/agent-version.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";

export const agentsRouter = Router();
agentsRouter.use(authenticate);

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(slugPattern).max(140),
  description: z.string().max(1000).optional().default(""),
  team: z.string().trim().min(1).max(80).optional().default("platform"),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional().default([]),
  provider: z.enum(["openai", "anthropic", "google", "azure-openai", "bedrock", "custom"]),
  model: z.string().trim().min(1).max(120),
  secretRef: z.string().trim().min(3).max(200).regex(/^(vault|aws-sm|azure-kv|gcp-sm):[a-zA-Z0-9/_-]+$|^aegisflow:[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
  version: z.object({
    changelog: z.string().max(1000).optional().default("Initial version"),
    systemPrompt: z.string().min(1).max(30000),
    temperature: z.number().min(0).max(2).optional().default(0.2),
    maxOutputTokens: z.number().int().min(1).max(100000).optional().default(2048),
    timeoutMs: z.number().int().min(1000).max(300000).optional().default(30000),
    tools: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
    responseFormat: z.enum(["text", "json"]).optional().default("text")
  })
});

const versionSchema = createSchema.shape.version;
const statusSchema = z.object({ status: z.enum(["draft", "deprecated", "archived"]) });
const idSchema = z.string().regex(/^[a-f\d]{24}$/i, "A valid agent id is required.");

async function audit(req: Request, auth: AuthContext, action: string, agentId: string, metadata: Record<string, unknown> = {}) {
  await writeAuditEvent({
    tenantId: auth.tenantId, actorUserId: auth.userId, action, resourceType: "agent",
    resourceId: agentId, metadata,
    ipAddress: req.ip
  });
}

agentsRouter.get("/", requirePermission("agents:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter: Record<string, unknown> = { tenantId: auth.tenantId };
  if (typeof req.query.status === "string" && ["draft", "active", "deprecated", "archived"].includes(req.query.status)) filter.status = req.query.status;
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: { $regex: escaped, $options: "i" } }, { slug: { $regex: escaped, $options: "i" } }, { model: { $regex: escaped, $options: "i" } }];
  }
  const [items, total] = await Promise.all([
    Agent.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Agent.countDocuments(filter)
  ]);
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

agentsRouter.post("/", requirePermission("agents:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = createSchema.parse(req.body);
  const agent = await Agent.create({
    tenantId: auth.tenantId, name: input.name, slug: input.slug, description: input.description,
    ownerUserId: auth.userId, team: input.team, tags: input.tags, provider: input.provider,
    model: input.model, secretRef: input.secretRef ?? null, status: "draft", latestVersion: 1
  });
  const version = await AgentVersion.create({
    tenantId: auth.tenantId, agentId: agent._id, version: 1, ...input.version, createdBy: auth.userId
  });
  await audit(req, auth, "agent.created", String(agent._id), { slug: agent.slug, version: 1 });
  res.status(201).json({ data: { agent, version } });
}));

agentsRouter.get("/:agentId", requirePermission("agents:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const agentId = idSchema.parse(req.params.agentId);
  const agent = await Agent.findOne({ _id: agentId, tenantId: auth.tenantId }).lean();
  if (!agent) { res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Agent not found." } }); return; }
  const versions = await AgentVersion.find({ agentId, tenantId: auth.tenantId }).sort({ version: -1 }).lean();
  res.json({ data: { agent, versions } });
}));

agentsRouter.get("/:agentId/versions", requirePermission("agents:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const agentId = idSchema.parse(req.params.agentId);
  const agent = await Agent.findOne({ _id: agentId, tenantId: auth.tenantId }).select("_id").lean();
  if (!agent) { res.status(404).json({ error: { code: "AGENT_NOT_FOUND", message: "Agent not found." } }); return; }
  const versions = await AgentVersion.find({ agentId, tenantId: auth.tenantId }).sort({ version: -1 }).lean();
  res.json({ data: versions });
}));

agentsRouter.post("/:agentId/versions", requirePermission("agents:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const agentId = idSchema.parse(req.params.agentId);
  const input = versionSchema.parse(req.body);
  const agent = await Agent.findOneAndUpdate(
    { _id: agentId, tenantId: auth.tenantId, status: { $in: ["draft", "active"] } },
    { $inc: { latestVersion: 1 } }, { new: true }
  );
  if (!agent) { res.status(404).json({ error: { code: "AGENT_NOT_FOUND_OR_LOCKED", message: "Agent not found or its lifecycle state does not allow new versions." } }); return; }
  const version = await AgentVersion.create({ tenantId: auth.tenantId, agentId, version: agent.latestVersion, ...input, createdBy: auth.userId });
  await audit(req, auth, "agent.version.created", agentId, { version: version.version });
  res.status(201).json({ data: version });
}));

agentsRouter.post("/:agentId/versions/:version/promote", requirePermission("agents:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const agentId = idSchema.parse(req.params.agentId);
  const versionNumber = z.coerce.number().int().min(1).parse(req.params.version);
  const version = await AgentVersion.findOne({ tenantId: auth.tenantId, agentId, version: versionNumber }).lean();
  if (!version) { res.status(404).json({ error: { code: "VERSION_NOT_FOUND", message: "Agent version not found." } }); return; }
  const agent = await Agent.findOneAndUpdate(
    { _id: agentId, tenantId: auth.tenantId, status: { $in: ["draft", "active"] } },
    { $set: { activeVersion: versionNumber, status: "active" } }, { new: true }
  );
  if (!agent) { res.status(404).json({ error: { code: "AGENT_NOT_FOUND_OR_LOCKED", message: "Agent not found or cannot be promoted." } }); return; }
  await audit(req, auth, "agent.version.promoted", agentId, { version: versionNumber });
  res.json({ data: agent });
}));

agentsRouter.patch("/:agentId/lifecycle", requirePermission("agents:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const agentId = idSchema.parse(req.params.agentId);
  const { status } = statusSchema.parse(req.body);
  const agent = await Agent.findOneAndUpdate(
    { _id: agentId, tenantId: auth.tenantId, status: { $ne: "archived" } },
    { $set: { status } }, { new: true, runValidators: true }
  );
  if (!agent) { res.status(404).json({ error: { code: "AGENT_NOT_FOUND_OR_LOCKED", message: "Agent not found or already archived." } }); return; }
  await audit(req, auth, `agent.${status}`, agentId);
  res.json({ data: agent });
}));
