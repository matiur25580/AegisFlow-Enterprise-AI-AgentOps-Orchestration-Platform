export type BudgetPolicyInput = {
  scopeType: "tenant" | "agent" | "model";
  scopeValue: string;
  monthlyLimitUsd: number;
  warningThresholdPercent: number;
  enforcement: "soft" | "hard";
  enabled: boolean;
};

export function budgetState(spentUsd: number, policy: Pick<BudgetPolicyInput, "monthlyLimitUsd" | "warningThresholdPercent" | "enabled">) {
  const spent = Math.max(0, Number.isFinite(spentUsd) ? spentUsd : 0);
  const percent = policy.monthlyLimitUsd > 0 ? spent / policy.monthlyLimitUsd * 100 : 0;
  return {
    spentUsd: Number(spent.toFixed(8)),
    remainingUsd: Number(Math.max(0, policy.monthlyLimitUsd - spent).toFixed(8)),
    utilizationPercent: Number(percent.toFixed(2)),
    warning: policy.enabled && percent >= policy.warningThresholdPercent,
    exceeded: policy.enabled && spent >= policy.monthlyLimitUsd
  };
}
