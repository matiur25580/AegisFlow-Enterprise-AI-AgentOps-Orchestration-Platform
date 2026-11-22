export type UsageRecord = {
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type ModelRate = {
  provider: string;
  model: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export function estimateUsageCost(usage: UsageRecord, rates: ModelRate[]) {
  const inputTokens = Number.isSafeInteger(usage.inputTokens) && (usage.inputTokens ?? -1) >= 0 ? usage.inputTokens ?? 0 : 0;
  const outputTokens = Number.isSafeInteger(usage.outputTokens) && (usage.outputTokens ?? -1) >= 0 ? usage.outputTokens ?? 0 : 0;
  const rate = rates.find(item =>
    item.provider === usage.provider && item.model.toLowerCase() === (usage.model ?? "").toLowerCase()
  );
  if (!rate) return { estimatedCostUsd: null, inputTokens, outputTokens, pricingConfigured: false };
  const cost = (inputTokens * rate.inputUsdPerMillionTokens + outputTokens * rate.outputUsdPerMillionTokens) / 1_000_000;
  return { estimatedCostUsd: Number(cost.toFixed(10)), inputTokens, outputTokens, pricingConfigured: true };
}

export function buildCostOverview(
  runs: Array<{ _id: unknown; status: string; createdAt: Date | string; steps?: Array<{ providerUsage?: UsageRecord | null }> }>,
  rates: ModelRate[],
  from: Date,
  to: Date
) {
  let estimatedCostUsd = 0;
  let pricedSteps = 0;
  let unpricedSteps = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const byModel = new Map<string, { provider: string; model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; unpricedSteps: number }>();
  for (const run of runs) {
    const createdAt = new Date(run.createdAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt < from || createdAt > to) continue;
    for (const step of run.steps ?? []) {
      const usage = step.providerUsage;
      if (!usage || !usage.provider || !usage.model) continue;
      const result = estimateUsageCost(usage, rates);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      const key = `${usage.provider}/${usage.model}`;
      const item = byModel.get(key) ?? { provider: usage.provider, model: usage.model, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unpricedSteps: 0 };
      item.inputTokens += result.inputTokens;
      item.outputTokens += result.outputTokens;
      if (result.estimatedCostUsd === null) { unpricedSteps += 1; item.unpricedSteps += 1; }
      else { pricedSteps += 1; estimatedCostUsd += result.estimatedCostUsd; item.estimatedCostUsd += result.estimatedCostUsd; }
      byModel.set(key, item);
    }
  }
  return {
    from: from.toISOString(), to: to.toISOString(), currency: "USD",
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)), inputTokens, outputTokens,
    pricedSteps, unpricedSteps, pricingCoveragePercent: pricedSteps + unpricedSteps
      ? Number((pricedSteps / (pricedSteps + unpricedSteps) * 100).toFixed(2)) : 100,
    byModel: [...byModel.values()].map(item => ({ ...item, estimatedCostUsd: Number(item.estimatedCostUsd.toFixed(8)) }))
  };
}
