import { Router } from "express";
import { z } from "zod";
import { BudgetPolicy } from "../models/budget-policy.model.js";
import { Agent } from "../models/agent.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";
import { getTenantBudgetUsage } from "../costs/budget-usage.js";
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

budgetsRouter.get("/", requirePermission("budgets:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [policies, usage] = await Promise.all([
    BudgetPolicy.find({ tenantId: auth.tenantId }).sort({ scopeType: 1, scopeValue: 1 }).lean(),
    getTenantBudgetUsage(auth.tenantId, monthStart)
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
  const scopeValue = input.scopeType === "tenant" ? input.scopeValue : input.scopeValue.toLowerCase();
  if (input.scopeType === "agent" && !await Agent.exists({ _id: scopeValue, tenantId: auth.tenantId })) {
    res.status(404).json({ error: { code: "BUDGET_AGENT_NOT_FOUND", message: "The budget agent must belong to this workspace." } });
    return;
  }
  const policy = await BudgetPolicy.findOneAndUpdate(
    { tenantId: auth.tenantId, scopeType: input.scopeType, scopeValue },
    { $set: { ...input, scopeValue, updatedBy: auth.userId }, $setOnInsert: { tenantId: auth.tenantId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "budget.policy.updated", resourceType: "budget_policy", resourceId: input.scopeType + ":" + scopeValue, metadata: { monthlyLimitUsd: input.monthlyLimitUsd, warningThresholdPercent: input.warningThresholdPercent, enforcement: input.enforcement, enabled: input.enabled }, ipAddress: req.ip });
  res.json({ data: policy });
}));

budgetsRouter.delete("/:scopeType", requirePermission("budgets:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const scopeType = z.enum(["tenant", "agent", "model"]).parse(req.params.scopeType);
  const scopeValue = z.string().trim().min(1).max(160).parse(req.query.scopeValue);
  const deleted = await BudgetPolicy.findOneAndDelete({ tenantId: auth.tenantId, scopeType, scopeValue }).select("_id").lean();
  if (!deleted) { res.status(404).json({ error: { code: "BUDGET_NOT_FOUND", message: "Budget policy was not found." } }); return; }
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "budget.policy.deleted", resourceType: "budget_policy", resourceId: scopeType + ":" + scopeValue, ipAddress: req.ip });
  res.status(204).send();
}));
