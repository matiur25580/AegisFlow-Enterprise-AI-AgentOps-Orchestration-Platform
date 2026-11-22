import { Router } from "express";
import { z } from "zod";
import { BudgetPolicy } from "../models/budget-policy.model.js";
import { ExecutionRun } from "../models/execution-run.model.js";
import { ModelPrice } from "../models/model-price.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";
import { estimateUsageCost } from "../costs/cost-intelligence.js";
import { budgetState } from "../costs/budget-governance.js";

export const budgetsRouter = Router();
budgetsRouter.use(authenticate);
const policySchema = z.object({
  scopeType: z.enum(["tenant", "agent", "model"]),
  scopeValue: z.string().trim().min(1).max(160),
  monthlyLimitUsd: z.number().finite().min(0.01).max(100_000_000),
  warningThresholdPercent: z.number().int().min(1).max(99).default(80),
  enforcement: z.enum(["soft", "hard"]).default("soft"),
  enabled: z.boolean().default(true)
}).strict().superRefine((value, context) => {
  if (value.scopeType === "tenant" && value.scopeValue !== "*") context.addIssue({ code: "custom", path: ["scopeValue"], message: "Tenant scope must use *." });
  if (value.scopeType === "agent" && !/^[a-f\\d]{24}$/i.test(value.scopeValue)) context.addIssue({ code: "custom", path: ["scopeValue"], message: "Agent scope must be a MongoDB ID." });
  if (value.scopeType === "model" && !/^(openai|anthropic|google)\\/.{1,120}$/i.test(value.scopeValue)) context.addIssue({ code: "custom", path: ["scopeValue"], message: "Model scope must use provider/model format." });
});

async function usageForTenant(tenantId: string, from: Date) {
  const [runs, rates] = await Promise.all([
    ExecutionRun.find({ tenantId, createdAt: { $gte: from } }).sort({ createdAt: -1 }).limit(5000)
      .select("steps.providerUsage agentSnapshots").lean(),
    ModelPrice.find({ tenantId, effectiveFrom: { $lte: new Date() } })
      .select("provider model inputUsdPerMillionTokens outputUsdPerMillionTokens").lean()
  ]);
  const totals = new Map<string, number>();
  for (const run of runs) {
    for (const step of run.steps ?? []) {
      const usage = step.providerUsage;
      if (!usage?.provider || !usage.model) continue;
      const estimate = estimateUsageCost(usage, rates);
      if (estimate.estimatedCostUsd === null) continue;
      totals.set("tenant:*", (totals.get("tenant:*") ?? 0) + estimate.estimatedCostUsd);
      totals.set("model:" + usage.provider + "/" + usage.model, (totals.get("model:" + usage.provider + "/" + usage.model) ?? 0) + estimate.estimatedCostUsd);
      const snapshot = (run.agentSnapshots ?? []).find(item => (item as { nodeId?: string }).nodeId === step.nodeId) as { agentId?: string } | undefined;
      if (snapshot?.agentId) totals.set("agent:" + snapshot.agentId, (totals.get("agent:" + snapshot.agentId) ?? 0) + estimate.estimatedCostUsd);
    }
  }
  return { totals, sampled: runs.length === 5000 };
}

budgetsRouter.get("/", requirePermission("budgets:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [policies, usage] = await Promise.all([
    BudgetPolicy.find({ tenantId: auth.tenantId }).sort({ scopeType: 1, scopeValue: 1 }).lean(),
    usageForTenant(auth.tenantId, monthStart)
  ]);
  const data = policies.map(policy => {
    const spent = usage.totals.get(policy.scopeType + ":" + policy.scopeValue) ?? 0;
    return { ...policy, ...budgetState(spent, policy), periodStart: monthStart.toISOString() };
  });
  res.json({ data, meta: { sampled: usage.sampled, currency: "USD", estimateBasis: "current configured rates; historical rate snapshots are not retained" } });
}));

budgetsRouter.put("/", requirePermission("budgets:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = policySchema.parse(req.body);
  const policy = await BudgetPolicy.findOneAndUpdate(
    { tenantId: auth.tenantId, scopeType: input.scopeType, scopeValue: input.scopeValue },
    { $set: { ...input, updatedBy: auth.userId }, $setOnInsert: { tenantId: auth.tenantId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "budget.policy.updated", resourceType: "budget_policy", resourceId: input.scopeType + ":" + input.scopeValue, metadata: { monthlyLimitUsd: input.monthlyLimitUsd, warningThresholdPercent: input.warningThresholdPercent, enforcement: input.enforcement, enabled: input.enabled }, ipAddress: req.ip });
  res.json({ data: policy });
}));

budgetsRouter.delete("/:scopeType/:scopeValue", requirePermission("budgets:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const scopeType = z.enum(["tenant", "agent", "model"]).parse(req.params.scopeType);
  const scopeValue = decodeURIComponent(req.params.scopeValue);
  const deleted = await BudgetPolicy.findOneAndDelete({ tenantId: auth.tenantId, scopeType, scopeValue }).select("_id").lean();
  if (!deleted) { res.status(404).json({ error: { code: "BUDGET_NOT_FOUND", message: "Budget policy was not found." } }); return; }
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "budget.policy.deleted", resourceType: "budget_policy", resourceId: scopeType + ":" + scopeValue, ipAddress: req.ip });
  res.status(204).send();
}));
