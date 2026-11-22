import { ExecutionRun } from "../models/execution-run.model.js";
import { ModelPrice } from "../models/model-price.model.js";
import { estimateUsageCost } from "./cost-intelligence.js";

export async function getTenantBudgetUsage(tenantId: string, from: Date) {
  const [runs, rates] = await Promise.all([
    ExecutionRun.find({ tenantId, createdAt: { $gte: from } }).sort({ createdAt: -1 }).limit(5000)
      .select("steps.nodeId steps.providerUsage agentSnapshots").lean(),
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
      const modelKey = usage.provider + "/" + usage.model.toLowerCase();
      totals.set("model:" + modelKey, (totals.get("model:" + modelKey) ?? 0) + estimate.estimatedCostUsd);
      const snapshot = (run.agentSnapshots ?? []).find(item => (item as { nodeId?: string }).nodeId === step.nodeId) as { agentId?: string } | undefined;
      if (snapshot?.agentId) totals.set("agent:" + snapshot.agentId, (totals.get("agent:" + snapshot.agentId) ?? 0) + estimate.estimatedCostUsd);
    }
  }
  return { totals, sampled: runs.length === 5000 };
}
