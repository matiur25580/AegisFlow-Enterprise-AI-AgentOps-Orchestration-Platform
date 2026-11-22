import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionError, isTerminalStatus, nextNodeId, retryDelayMs, type RuntimeNode, type RuntimeEdge } from "./engine.js";

const node = (type: RuntimeNode["type"], config: Record<string, unknown> = {}): RuntimeNode => ({ id: "node", type, label: "Node", config });
const routes: RuntimeEdge[] = [
  { id: "yes", source: "node", target: "yes-node", label: "true" },
  { id: "no", source: "node", target: "no-node", label: "false" }
];

test("uses bounded exponential retry delays", () => {
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(2), 2_000);
  assert.equal(retryDelayMs(9), 60_000);
});
test("routes literal boolean conditions without evaluating arbitrary code", () => {
  assert.equal(nextNodeId(node("condition", { expression: "true" }), routes), "yes-node");
  assert.equal(nextNodeId(node("condition", { expression: "false" }), routes), "no-node");
  assert.throws(() => nextNodeId(node("condition", { expression: "process.exit()" }), routes), (error: unknown) =>
    error instanceof ExecutionError && error.code === "UNSUPPORTED_CONDITION_EXPRESSION");
});
test("rejects ambiguous paths and missing condition routes", () => {
  assert.throws(() => nextNodeId(node("start"), routes), /multiple outgoing routes/);
  assert.throws(() => nextNodeId(node("condition", { expression: "true" }), []), /no "true" route/);
});
test("recognizes terminal execution states", () => {
  assert.equal(isTerminalStatus("succeeded"), true);
  assert.equal(isTerminalStatus("failed"), true);
  assert.equal(isTerminalStatus("cancelled"), true);
  assert.equal(isTerminalStatus("running"), false);
});
