import { BudgetPolicy } from "../models/budget-policy.model.js";
import { BudgetAlert } from "../models/budget-alert.model.js";
import { getTenantBudgetUsage } from "./budget-usage.js";
import { budgetState } from "./budget-governance.js";

export async function evaluateBudgetAlerts(tenantId: string, now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [policies, usage] = await Promise.all([
    BudgetPolicy.find({ tenantId, enabled: true }).lean(),
    getTenantBudgetUsage(tenantId, periodStart)
  ]);

  // A saturated sample can understate spend. Do not create potentially false alerts.
  if (usage.sampled) return { created: 0, sampled: true };

  let created = 0;
  for (const policy of policies) {
    const spend = usage.totals.get(policy.scopeType + ":" + policy.scopeValue) ?? 0;
    const state = budgetState(spend, policy);
    const eventType = state.exceeded ? "exceeded" : state.warning ? "warning" : null;
    if (!eventType) continue;

    const dedupeKey = [String(policy._id), periodStart.toISOString(), eventType].join(":");
    const result = await BudgetAlert.updateOne(
      { tenantId, dedupeKey },
      { $setOnInsert: {
        tenantId, policyId: policy._id, scopeType: policy.scopeType,
        scopeValue: policy.scopeValue, periodStart, eventType, dedupeKey,
        thresholdPercent: eventType === "warning" ? policy.warningThresholdPercent : 100,
        observedSpendUsd: state.spentUsd, monthlyLimitUsd: policy.monthlyLimitUsd,
        utilizationPercent: state.utilizationPercent
      } },
      { upsert: true }
    );
    if (result.upsertedCount === 1) created += 1;
  }
  return { created, sampled: false };
}
