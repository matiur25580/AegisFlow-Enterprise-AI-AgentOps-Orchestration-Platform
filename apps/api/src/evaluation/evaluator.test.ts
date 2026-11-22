import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCases } from "./evaluator.js";

test("exact-match evaluation compares JSON objects independent of key order and weights cases", () => {
  const result = evaluateCases([
    { caseId: "a", expectedOutput: { answer: 42, ok: true }, weight: 3 },
    { caseId: "b", expectedOutput: "approved", weight: 1 }
  ], [
    { caseId: "a", actualOutput: { ok: true, answer: 42 } },
    { caseId: "b", actualOutput: "rejected" }
  ], "exact_match");
  assert.equal(result.totalCases, 2);
  assert.equal(result.passedCases, 1);
  assert.equal(result.score, 75);
});

test("missing submissions fail and contains metric only accepts strings", () => {
  const result = evaluateCases([
    { caseId: "a", expectedOutput: "invoice", weight: 1 },
    { caseId: "b", expectedOutput: "ok", weight: 1 }
  ], [{ caseId: "a", actualOutput: "invoice #123" }, { caseId: "b", actualOutput: { ok: true } }], "contains");
  assert.equal(result.passedCases, 1);
  assert.equal(result.score, 50);
});

test("empty evaluation suites produce a safe zero score", () => {
  assert.equal(evaluateCases([], [], "exact_match").score, 0);
});


import { assessEvaluationGate } from "./evaluator.js";

test("release gate passes an initial run that meets the configured minimum", () => {
  const result = assessEvaluationGate(88, null, { minScore: 80, maxRegressionPoints: 8 });
  assert.equal(result.status, "passed");
  assert.equal(result.previousScore, null);
  assert.equal(result.regressionPoints, null);
  assert.deepEqual(result.reasons, []);
});

test("release gate blocks a score below the configured quality threshold", () => {
  const result = assessEvaluationGate(74, 76, { minScore: 80, maxRegressionPoints: 8 });
  assert.equal(result.status, "blocked");
  assert.ok(result.reasons.some(reason => reason.includes("below the required minimum")));
});

test("release gate blocks material regression even when the minimum score is met", () => {
  const result = assessEvaluationGate(90, 99, { minScore: 85, maxRegressionPoints: 5 });
  assert.equal(result.status, "blocked");
  assert.equal(result.regressionPoints, 9);
  assert.ok(result.reasons.some(reason => reason.includes("regressed")));
});

test("release gate allows regression within the configured tolerance", () => {
  const result = assessEvaluationGate(92, 96, { minScore: 85, maxRegressionPoints: 5 });
  assert.equal(result.status, "passed");
  assert.equal(result.regressionPoints, 4);
});
