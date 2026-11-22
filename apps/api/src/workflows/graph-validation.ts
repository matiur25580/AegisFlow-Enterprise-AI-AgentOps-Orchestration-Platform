export type WorkflowNodeType = "start" | "agent" | "condition" | "approval" | "end";

export interface WorkflowNodeInput {
  id: string;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdgeInput {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface GraphIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const secretReference = /^(vault|aws-sm|azure-kv|gcp-sm):[a-zA-Z0-9/_-]+$/;
const forbiddenSecretKey = /^(password|secret|apiKey|accessToken|refreshToken|credential)$/i;

export function validateWorkflowGraph(nodes: WorkflowNodeInput[], edges: WorkflowEdgeInput[]): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodeById = new Map<string, WorkflowNodeInput>();

  for (const node of nodes) {
    if (nodeById.has(node.id)) issues.push({ code: "DUPLICATE_NODE_ID", message: `Node id "${node.id}" is duplicated.`, nodeId: node.id });
    nodeById.set(node.id, node);

    const config = node.config ?? {};
    const inspectConfig = (value: unknown, path = ""): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach((entry, index) => inspectConfig(entry, `${path}[${index}]`)); return; }
      for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        const fieldPath = path ? `${path}.${key}` : key;
        if (forbiddenSecretKey.test(key)) issues.push({ code: "RAW_CREDENTIAL_FIELD", message: `Node "${node.id}" contains a prohibited credential field "${fieldPath}". Use secretRef.`, nodeId: node.id });
        if (key === "secretRef" && nestedValue !== null && nestedValue !== undefined && (typeof nestedValue !== "string" || !secretReference.test(nestedValue))) {
          issues.push({ code: "INVALID_SECRET_REFERENCE", message: `Node "${node.id}" has an invalid secret reference.`, nodeId: node.id });
        }
        inspectConfig(nestedValue, fieldPath);
      }
    };
    inspectConfig(config);

    if (node.type === "agent" && (typeof config.agentId !== "string" || !/^[a-f\d]{24}$/i.test(config.agentId))) {
      issues.push({ code: "AGENT_CONFIG_REQUIRED", message: `Agent node "${node.id}" requires a valid agentId.`, nodeId: node.id });
    }
    if (node.type === "condition" && (typeof config.expression !== "string" || !config.expression.trim())) {
      issues.push({ code: "CONDITION_CONFIG_REQUIRED", message: `Condition node "${node.id}" requires an expression.`, nodeId: node.id });
    }
    if (node.type === "approval") {
      if (typeof config.assigneeRole !== "string" || !["owner", "admin", "operator"].includes(config.assigneeRole)) {
        issues.push({ code: "APPROVAL_CONFIG_REQUIRED", message: `Approval node "${node.id}" requires an assigneeRole of owner, admin or operator.`, nodeId: node.id });
      }
      if (config.assigneeUserId !== undefined && (typeof config.assigneeUserId !== "string" || !/^[a-f\\d]{24}$/i.test(config.assigneeUserId))) {
        issues.push({ code: "APPROVAL_ASSIGNEE_INVALID", message: `Approval node "${node.id}" has an invalid assigneeUserId.`, nodeId: node.id });
      }
      if (config.timeoutMinutes !== undefined && (!Number.isInteger(config.timeoutMinutes) || Number(config.timeoutMinutes) < 1 || Number(config.timeoutMinutes) > 10080)) {
        issues.push({ code: "APPROVAL_TIMEOUT_INVALID", message: `Approval node "${node.id}" timeoutMinutes must be an integer from 1 to 10080.`, nodeId: node.id });
      }
    }
  }

  const starts = nodes.filter(node => node.type === "start");
  const ends = nodes.filter(node => node.type === "end");
  if (starts.length !== 1) issues.push({ code: "START_NODE_COUNT", message: "A workflow must contain exactly one start node." });
  if (ends.length < 1) issues.push({ code: "END_NODE_REQUIRED", message: "A workflow must contain at least one end node." });

  const edgeIds = new Set<string>();
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) { adjacency.set(node.id, []); indegree.set(node.id, 0); }
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) issues.push({ code: "DUPLICATE_EDGE_ID", message: `Edge id "${edge.id}" is duplicated.`, edgeId: edge.id });
    edgeIds.add(edge.id);
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      issues.push({ code: "INVALID_EDGE_REFERENCE", message: `Edge "${edge.id}" references a node that does not exist.`, edgeId: edge.id });
      continue;
    }
    if (edge.source === edge.target) issues.push({ code: "SELF_LOOP", message: `Edge "${edge.id}" cannot point to itself.`, edgeId: edge.id });
    if (nodeById.get(edge.source)?.type === "end") issues.push({ code: "END_NODE_OUTGOING_EDGE", message: `End node "${edge.source}" cannot have outgoing edges.`, edgeId: edge.id });
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const startNode = starts.length === 1 ? starts[0] : undefined;
  if (startNode) {
    const visited = new Set<string>();
    const stack = [startNode.id];
    while (stack.length) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adjacency.get(current) ?? []) stack.push(next);
    }
    for (const node of nodes) if (!visited.has(node.id)) issues.push({ code: "UNREACHABLE_NODE", message: `Node "${node.id}" is unreachable from the start node.`, nodeId: node.id });
  }

  // Kahn's algorithm rejects all directed cycles; execution graphs must be acyclic in this milestone.
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visitedCount = 0;
  while (queue.length) {
    const current = queue.shift()!;
    visitedCount++;
    for (const next of adjacency.get(current) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (visitedCount !== nodes.length) issues.push({ code: "CYCLE_DETECTED", message: "Workflow graphs must be acyclic; a directed cycle was detected." });

  return issues;
}
