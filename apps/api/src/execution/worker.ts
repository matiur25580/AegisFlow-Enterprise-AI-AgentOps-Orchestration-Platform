import { randomUUID } from "node:crypto";
import { ExecutionRun } from "../models/execution-run.model.js";
import { logger } from "../config/logger.js";
import { ExecutionError, nextNodeId, retryDelayMs, type RuntimeEdge, type RuntimeNode } from "./engine.js";

const LEASE_MS = 30_000;
const POLL_MS = 1_000;
let poller: ReturnType<typeof setInterval> | null = null;
let polling = false;
type Step = { nodeId: string; nodeType: string; label: string; status: "running" | "succeeded" | "failed"; attempt: number; startedAt: Date; completedAt?: Date | null; output?: unknown; error?: string | null };

async function checkpoint(runId: string, token: string, values: Record<string, unknown>): Promise<void> {
  const result = await ExecutionRun.updateOne({ _id: runId, leaseToken: token, status: "running" }, { $set: values });
  if (result.modifiedCount !== 1) throw new ExecutionError("Execution lease was lost.", "EXECUTION_LEASE_LOST", true);
}

async function executeNode(node: RuntimeNode): Promise<unknown> {
  if (node.type === "start" || node.type === "end") return null;
  if (node.type === "condition") return { evaluated: String(node.config.expression).toLowerCase() };
  if (node.type === "approval") throw new ExecutionError("Approval nodes require the human approval runtime, which is not enabled yet.", "APPROVAL_RUNTIME_NOT_CONFIGURED");
  if (node.type === "agent") throw new ExecutionError("No provider executor is configured. Connect a secrets manager and provider adapter before running agent nodes.", "AGENT_EXECUTOR_NOT_CONFIGURED");
  throw new ExecutionError("Unsupported workflow node type.", "UNSUPPORTED_NODE_TYPE");
}

async function processClaim(runId: string, token: string): Promise<void> {
  const run = await ExecutionRun.findOne({ _id: runId, leaseToken: token, status: "running" });
  if (!run) return;
  const nodes = run.nodes as unknown as RuntimeNode[];
  const edges = run.edges as unknown as RuntimeEdge[];
  const byId = new Map(nodes.map(node => [node.id, node]));
  let current = run.currentNodeId ?? nodes.find(node => node.type === "start")?.id ?? null;

  while (current) {
    const fresh = await ExecutionRun.findOne({ _id: runId, leaseToken: token, status: "running" }).select("cancelRequestedAt").lean();
    if (!fresh) return;
    if (fresh.cancelRequestedAt) {
      await checkpoint(runId, token, { status: "cancelled", completedAt: new Date(), leaseToken: null, leaseExpiresAt: null });
      return;
    }
    const node = byId.get(current);
    if (!node) throw new ExecutionError(`Node "${current}" is missing from the execution snapshot.`, "EXECUTION_NODE_MISSING");
    const previous = (run.steps as unknown as Step[]).find(step => step.nodeId === node.id && step.status === "failed");
    const attempt = (previous?.attempt ?? 0) + 1;
    const startedAt = new Date();
    const steps = (run.steps as unknown as Step[]).filter(step => step.nodeId !== node.id);
    steps.push({ nodeId: node.id, nodeType: node.type, label: node.label, status: "running", attempt, startedAt });
    await checkpoint(runId, token, { currentNodeId: current, steps, attempt: run.attempt + 1, startedAt: run.startedAt ?? startedAt });
    try {
      const output = await executeNode(node);
      const completedAt = new Date();
      const done = steps.map(step => step.nodeId === node.id ? { ...step, status: "succeeded" as const, completedAt, output } : step);
      const next = nextNodeId(node, edges);
      if (node.type === "end" || next === null) {
        await checkpoint(runId, token, { steps: done, currentNodeId: null, status: "succeeded", completedAt, leaseToken: null, leaseExpiresAt: null, lastError: null });
        return;
      }
      await checkpoint(runId, token, { steps: done, currentNodeId: next });
      (run.steps as unknown as Step[]) = done;
      current = next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown node execution error.";
      const code = error instanceof ExecutionError ? error.code : "NODE_EXECUTION_FAILED";
      const retryable = error instanceof ExecutionError && error.retryable;
      const failedAt = new Date();
      const failed = steps.map(step => step.nodeId === node.id ? { ...step, status: "failed" as const, completedAt: failedAt, error: message } : step);
      const shouldRetry = retryable && attempt < run.maxAttempts;
      await checkpoint(runId, token, {
        steps: failed, currentNodeId: node.id, lastError: `${code}: ${message}`,
        status: shouldRetry ? "queued" : "failed",
        nextAttemptAt: shouldRetry ? new Date(Date.now() + retryDelayMs(attempt)) : null,
        completedAt: shouldRetry ? null : failedAt, leaseToken: null, leaseExpiresAt: null
      });
      return;
    }
  }
  await checkpoint(runId, token, { status: "failed", lastError: "Execution ended without reaching a terminal node.", completedAt: new Date(), leaseToken: null, leaseExpiresAt: null });
}

export async function processNextExecution(): Promise<boolean> {
  const now = new Date();
  const token = randomUUID();
  const claimed = await ExecutionRun.findOneAndUpdate(
    { $or: [{ status: "queued", nextAttemptAt: { $lte: now } }, { status: "running", leaseExpiresAt: { $lte: now } }] },
    { $set: { status: "running", leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) } },
    { sort: { createdAt: 1 }, new: true }
  ).select("_id").lean();
  if (!claimed) return false;
  try { await processClaim(String(claimed._id), token); }
  catch (error) {
    logger.error({ err: error, runId: String(claimed._id) }, "Workflow execution worker failed");
    await ExecutionRun.updateOne({ _id: claimed._id, leaseToken: token, status: "running" }, {
      $set: { status: "failed", lastError: error instanceof Error ? error.message : "Worker failure", completedAt: new Date(), leaseToken: null, leaseExpiresAt: null }
    });
  }
  return true;
}

export function startExecutionWorker(): void {
  if (poller) return;
  poller = setInterval(() => {
    if (polling) return;
    polling = true;
    void processNextExecution().catch(error => logger.error({ err: error }, "Execution queue poll failed")).finally(() => { polling = false; });
  }, POLL_MS);
  poller.unref();
  logger.info({ pollIntervalMs: POLL_MS }, "Workflow execution worker started");
}
export function stopExecutionWorker(): void { if (poller) clearInterval(poller); poller = null; }
