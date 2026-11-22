import { Router } from "express";
import { z } from "zod";
import { ModelPrice } from "../models/model-price.model.js";
import { ExecutionRun } from "../models/execution-run.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";
import { buildCostOverview } from "../costs/cost-intelligence.js";

export const costsRouter = Router();
costsRouter.use(authenticate);

const rangeSchema = z.enum(["24h", "7d", "30d"]);
const pricingSchema = z.object({
  provider: z.enum(["openai", "anthropic", "google"]),
  model: z.string().trim().toLowerCase().min(1).max(120),
  inputUsdPerMillionTokens: z.number().finite().min(0).max(1_000_000),
  outputUsdPerMillionTokens: z.number().finite().min(0).max(1_000_000),
  effectiveFrom: z.string().datetime().optional(),
  source: z.string().trim().max(300).optional()
}).strict();

costsRouter.get("/pricing", requirePermission("costs:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const rates = await ModelPrice.find({ tenantId: auth.tenantId })
    .select("provider model inputUsdPerMillionTokens outputUsdPerMillionTokens effectiveFrom source updatedAt")
    .sort({ provider: 1, model: 1 }).lean();
  res.json({ data: rates });
}));

costsRouter.put("/pricing", requirePermission("costs:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = pricingSchema.parse(req.body);
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const rate = await ModelPrice.findOneAndUpdate(
    { tenantId: auth.tenantId, provider: input.provider, model: input.model },
    { $set: {
      inputUsdPerMillionTokens: input.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: input.outputUsdPerMillionTokens,
      effectiveFrom,
      source: input.source ?? "tenant-configured",
      updatedBy: auth.userId
    }, $setOnInsert: { tenantId: auth.tenantId, provider: input.provider, model: input.model } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).select("provider model inputUsdPerMillionTokens outputUsdPerMillionTokens effectiveFrom source updatedAt").lean();
  await writeAuditEvent({
    tenantId: auth.tenantId, actorUserId: auth.userId,
    action: "cost.pricing.updated", resourceType: "model-price",
    resourceId: `${input.provider}/${input.model}`,
    metadata: { source: input.source ?? "tenant-configured", effectiveFrom: effectiveFrom.toISOString() },
    ipAddress: req.ip
  });
  res.json({ data: rate });
}));

costsRouter.get("/overview", requirePermission("costs:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const parsed = rangeSchema.safeParse(req.query.range ?? "30d");
  if (!parsed.success) {
    res.status(400).json({ error: { code: "INVALID_COST_RANGE", message: "Range must be 24h, 7d or 30d." } });
    return;
  }
  const now = new Date();
  const duration = parsed.data === "24h" ? 86_400_000 : parsed.data === "7d" ? 604_800_000 : 2_592_000_000;
  const from = new Date(now.getTime() - duration);
  const [runs, rates] = await Promise.all([
    ExecutionRun.find({ tenantId: auth.tenantId, createdAt: { $gte: from, $lte: now } })
      .sort({ createdAt: -1 }).limit(5000).select("status createdAt steps.providerUsage").lean(),
    ModelPrice.find({ tenantId: auth.tenantId, effectiveFrom: { $lte: now } })
      .select("provider model inputUsdPerMillionTokens outputUsdPerMillionTokens").lean()
  ]);
  const overview = buildCostOverview(runs, rates, from, now);
  res.json({ data: { ...overview, sampleLimit: 5000, sampled: runs.length === 5000, estimateBasis: "current tenant-configured rates; historical price snapshots are not yet retained" } });
}));
