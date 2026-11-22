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
