import test from "node:test";
import assert from "node:assert/strict";
import { budgetState, findBlockingBudgets } from "./budget-governance.js";

test("budget state reports remaining amount and warning threshold", () => {
  const result = budgetState(80, { monthlyLimitUsd: 100, warningThresholdPercent: 80, enabled: true });
  assert.equal(result.remainingUsd, 20);
  assert.equal(result.warning, true);
  assert.equal(result.exceeded, false);
  assert.equal(result.utilizationPercent, 80);
});

test("hard-cap state becomes exceeded at the limit and clamps remaining spend", () => {
  const result = budgetState(125, { monthlyLimitUsd: 100, warningThresholdPercent: 75, enabled: true });
  assert.equal(result.remainingUsd, 0);
  assert.equal(result.warning, true);
  assert.equal(result.exceeded, true);
});

test("disabled policies never emit warning or exceeded state", () => {
  const result = budgetState(200, { monthlyLimitUsd: 100, warningThresholdPercent: 80, enabled: false });
  assert.equal(result.warning, false);
  assert.equal(result.exceeded, false);
});

test("hard budget admission blocks only applicable enabled hard scopes at their limit", () => {
  const policies = [
    { scopeType: "tenant" as const, scopeValue: "*", monthlyLimitUsd: 100, enforcement: "hard" as const, enabled: true },
    { scopeType: "agent" as const, scopeValue: "agent-a", monthlyLimitUsd: 25, enforcement: "hard" as const, enabled: true },
    { scopeType: "model" as const, scopeValue: "openai/gpt-4.1", monthlyLimitUsd: 20, enforcement: "soft" as const, enabled: true },
    { scopeType: "tenant" as const, scopeValue: "disabled", monthlyLimitUsd: 1, enforcement: "hard" as const, enabled: false }
  ];
  const spent = new Map([["tenant:*", 100], ["agent:agent-a", 30], ["model:openai/gpt-4.1", 50]]);
  const blocked = findBlockingBudgets(policies, spent, [{ agentId: "agent-a", provider: "openai", model: "gpt-4.1" }]);
  assert.deepEqual(blocked.map(item => item.scopeType), ["tenant", "agent"]);
});
