export type BudgetAlertEventType = "warning" | "exceeded";

export function classifyBudgetAlert(state: { warning: boolean; exceeded: boolean }): BudgetAlertEventType | null {
  if (state.exceeded) return "exceeded";
  if (state.warning) return "warning";
  return null;
}

export function budgetAlertDedupeKey(policyId: string, periodStart: Date, eventType: BudgetAlertEventType): string {
  return [policyId, periodStart.toISOString(), eventType].join(":");
}

export function tenantBudgetAlertFilter(tenantId: string, alertId?: string) {
  return alertId ? { tenantId, _id: alertId } : { tenantId };
}
