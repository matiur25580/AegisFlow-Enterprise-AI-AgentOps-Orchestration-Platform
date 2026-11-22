import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkflowGraph, type WorkflowNodeInput, type WorkflowEdgeInput } from "./graph-validation.js";

const nodes: WorkflowNodeInput[] = [
  { id: "start", type: "start", label: "Start", position: { x: 0, y: 0 }, config: {} },
  { id: "end", type: "end", label: "End", position: { x: 200, y: 0 }, config: {} }
];
const edges: WorkflowEdgeInput[] = [{ id: "edge-1", source: "start", target: "end" }];

test("accepts a valid minimal directed workflow", () => {
  assert.deepEqual(validateWorkflowGraph(nodes, edges), []);
});

test("rejects missing edge references and unreachable nodes", () => {
  const issues = validateWorkflowGraph(
    [...nodes, { id: "orphan", type: "end", label: "Orphan", position: { x: 0, y: 100 }, config: {} }],
    [{ id: "bad", source: "start", target: "missing" }]
  );
  assert.ok(issues.some(issue => issue.code === "INVALID_EDGE_REFERENCE"));
  assert.ok(issues.some(issue => issue.code === "UNREACHABLE_NODE"));
});

test("rejects cycles", () => {
  const issues = validateWorkflowGraph(
    [...nodes, { id: "agent", type: "agent", label: "Agent", position: { x: 100, y: 0 }, config: { agentId: "0123456789abcdef01234567" } }],
    [
      { id: "a", source: "start", target: "agent" },
      { id: "b", source: "agent", target: "end" },
      { id: "c", source: "end", target: "agent" }
    ]
  );
  assert.ok(issues.some(issue => issue.code === "CYCLE_DETECTED"));
});

test("requires node-specific configuration and rejects inline credentials", () => {
  const issues = validateWorkflowGraph(
    [
      nodes[0]!,
      { id: "agent", type: "agent", label: "Agent", position: { x: 100, y: 0 }, config: { apiKey: "do-not-store" } },
      nodes[1]!
    ],
    [{ id: "a", source: "start", target: "agent" }, { id: "b", source: "agent", target: "end" }]
  );
  assert.ok(issues.some(issue => issue.code === "AGENT_CONFIG_REQUIRED"));
  assert.ok(issues.some(issue => issue.code === "RAW_CREDENTIAL_FIELD"));
});

test("requires exactly one start node and at least one end node", () => {
  const issues = validateWorkflowGraph(
    [
      { id: "start-a", type: "start", label: "Start A", position: { x: 0, y: 0 }, config: {} },
      { id: "start-b", type: "start", label: "Start B", position: { x: 0, y: 100 }, config: {} }
    ],
    []
  );
  assert.ok(issues.some(issue => issue.code === "START_NODE_COUNT"));
  assert.ok(issues.some(issue => issue.code === "END_NODE_REQUIRED"));
});

test("validates approval reviewer assignment and bounded deadline", () => {
  const approval: WorkflowNodeInput = {
    id: "review", type: "approval", label: "Finance review", position: { x: 100, y: 0 },
    config: { assigneeRole: "operator", assigneeUserId: "0123456789abcdef01234567", timeoutMinutes: 120 }
  };
  const valid = validateWorkflowGraph(
    [nodes[0]!, approval, nodes[1]!],
    [{ id: "a", source: "start", target: "review" }, { id: "b", source: "review", target: "end" }]
  );
  assert.deepEqual(valid, []);

  const invalid = validateWorkflowGraph(
    [nodes[0]!, { ...approval, config: { assigneeRole: "guest", assigneeUserId: "not-an-id", timeoutMinutes: 0 } }, nodes[1]!],
    [{ id: "a", source: "start", target: "review" }, { id: "b", source: "review", target: "end" }]
  );
  assert.ok(invalid.some(issue => issue.code === "APPROVAL_CONFIG_REQUIRED"));
  assert.ok(invalid.some(issue => issue.code === "APPROVAL_ASSIGNEE_INVALID"));
  assert.ok(invalid.some(issue => issue.code === "APPROVAL_TIMEOUT_INVALID"));
});
