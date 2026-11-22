import assert from "node:assert/strict";
import test from "node:test";
import { assessWorkflowPromotion, type AgentPromotionEvidence } from "./promotion-governance.js";

const agent = { agentId: "agent-a", activeVersion: 3, status: "active" };
const passed: AgentPromotionEvidence = {
  agentId: "agent-a", agentVersion: 3, suiteId: "suite-1", runId: "run-1",
  score: 96, gateStatus: "passed", evaluatedAt: new Date("2026-11-22T10:00:00Z")
};

test("allows promotion when every referenced active agent version has a passing evaluation", () => {
  const result = assessWorkflowPromotion([agent], [passed]);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.evidence[0].runId, "run-1");
});

test("blocks promotion when an agent has no evaluation for its active version", () => {
  const result = assessWorkflowPromotion([agent], []);
  assert.equal(result.eligible, false);
  assert.match(result.reasons[0], /no evaluation for active version 3/);
});

test("blocks promotion when the latest evaluation gate is blocked", () => {
  const result = assessWorkflowPromotion([agent], [{ ...passed, gateStatus: "blocked" }]);
  assert.equal(result.eligible, false);
  assert.match(result.reasons[0], /gate is blocked/);
});

test("blocks inactive agents and supports workflows without agent nodes", () => {
  assert.equal(assessWorkflowPromotion([{ ...agent, status: "deprecated" }], [passed]).eligible, false);
  assert.equal(assessWorkflowPromotion([], []).eligible, true);
});
