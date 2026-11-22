import test from "node:test";
import assert from "node:assert/strict";
import { budgetAlertDedupeKey, classifyBudgetAlert, tenantBudgetAlertFilter } from "./budget-alert-policy.js";

test("classifies exceeded ahead of warning when both states are true", () => {
  assert.equal(classifyBudgetAlert({ warning: true, exceeded: true }), "exceeded");
  assert.equal(classifyBudgetAlert({ warning: true, exceeded: false }), "warning");
  assert.equal(classifyBudgetAlert({ warning: false, exceeded: false }), null);
});

test("dedupe identity is stable for a policy, UTC month and event type", () => {
  const month = new Date("2026-11-01T00:00:00.000Z");
  assert.equal(budgetAlertDedupeKey("policy-1", month, "warning"), "policy-1:2026-11-01T00:00:00.000Z:warning");
  assert.notEqual(budgetAlertDedupeKey("policy-1", month, "warning"), budgetAlertDedupeKey("policy-1", month, "exceeded"));
  assert.notEqual(budgetAlertDedupeKey("policy-1", month, "warning"), budgetAlertDedupeKey("policy-1", new Date("2026-12-01T00:00:00.000Z"), "warning"));
  assert.notEqual(budgetAlertDedupeKey("policy-1", month, "warning"), budgetAlertDedupeKey("policy-2", month, "warning"));
});

test("tenant query filter always scopes alert history and read mutations", () => {
  assert.deepEqual(tenantBudgetAlertFilter("tenant-a"), { tenantId: "tenant-a" });
  assert.deepEqual(tenantBudgetAlertFilter("tenant-a", "alert-1"), { tenantId: "tenant-a", _id: "alert-1" });
  assert.notDeepEqual(tenantBudgetAlertFilter("tenant-a", "alert-1"), tenantBudgetAlertFilter("tenant-b", "alert-1"));
});
