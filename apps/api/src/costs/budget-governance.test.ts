import test from "node:test";
import assert from "node:assert/strict";
import { budgetState } from "./budget-governance.js";

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
