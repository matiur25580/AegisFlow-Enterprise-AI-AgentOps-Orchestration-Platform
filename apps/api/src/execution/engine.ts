export interface RuntimeNode {
  id: string;
  type: "start" | "agent" | "condition" | "approval" | "end";
  label: string;
  config: Record<string, unknown>;
}
export interface RuntimeEdge { id: string; source: string; target: string; label?: string }

export class ExecutionError extends Error {
  constructor(message: string, readonly code: string, readonly retryable = false) {
    super(message); this.name = "ExecutionError";
  }
}

export function retryDelayMs(attempt: number, baseMs = 1_000, maxMs = 60_000): number {
  return Math.min(maxMs, baseMs * (2 ** (Math.max(1, Math.floor(attempt)) - 1)));
}

// Resolve the next workflow node deterministically and reject ambiguous or unsupported branching.
export function nextNodeId(node: RuntimeNode, edges: RuntimeEdge[]): string | null {
  const outgoing = edges.filter(edge => edge.source === node.id);
  if (node.type === "end") return null;
  if (node.type === "condition") {
    const value = typeof node.config.expression === "string" ? node.config.expression.trim().toLowerCase() : "";
    if (value !== "true" && value !== "false") throw new ExecutionError("Condition expressions must be literal true or false until a policy evaluator is configured.", "UNSUPPORTED_CONDITION_EXPRESSION");
    const selected = outgoing.find(edge => (edge.label ?? "").trim().toLowerCase() === value) ?? outgoing[value === "true" ? 0 : 1];
    if (!selected) throw new ExecutionError(`Condition node "${node.id}" has no "${value}" route.`, "CONDITION_ROUTE_MISSING");
    return selected.target;
  }
  if (outgoing.length > 1) throw new ExecutionError(`Node "${node.id}" has multiple outgoing routes without a branch evaluator.`, "AMBIGUOUS_WORKFLOW_ROUTE");
  return outgoing[0]?.target ?? null;
}
export function isTerminalStatus(status: string): boolean {
  return ["succeeded", "failed", "cancelled"].includes(status);
}
