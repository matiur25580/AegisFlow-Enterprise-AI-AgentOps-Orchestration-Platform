import { randomUUID } from "node:crypto";
import { ExecutionRun } from "../models/execution-run.model.js";
import { Approval } from "../models/approval.model.js";
import { writeAuditEvent } from "../auth/audit.js";
import { logger } from "../config/logger.js";
import { ExecutionError, nextNodeId, retryDelayMs, type RuntimeEdge, type RuntimeNode } from "./engine.js";

const LEASE_MS = 30_000;
const POLL_MS = 1_000;
let poller: ReturnType<typeof setInterval> | null = null;
let polling = false;
type Step = { nodeId: string; nodeType: string; label: string; status: "running" | "waiting_approval" | "succeeded" | "failed"; attempt: number; startedAt: Date; completedAt?: Date | null; output?: unknown; error?: string | null };

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
  let stepsState = run.steps as unknown as Step[];

  while (current) {
    const fresh = await ExecutionRun.findOne({ _id: runId, leaseToken: token, status: "running" }).select("cancelRequestedAt").lean();
    if (!fresh) return;
    if (fresh.cancelRequestedAt) {
      await checkpoint(runId, token, { status: "cancelled", completedAt: new Date(), leaseToken: null, leaseExpiresAt: null });
      return;
    }
    const node = byId.get(current);
    if (!node) throw new ExecutionError(`Node "${current}" is missing from the execution snapshot.`, "EXECUTION_NODE_MISSING");
    const previous = stepsState.find(step => step.nodeId === node.id && step.status === "failed");
    const attempt = (previous?.attempt ?? 0) + 1;
    const startedAt = new Date();
    const steps = stepsState.filter(step => step.nodeId !== node.id);
    steps.push({ nodeId: node.id, nodeType: node.type, label: node.label, status: "running", attempt, startedAt });
    await checkpoint(runId, token, { currentNodeId: current, steps, attempt: run.attempt + 1, startedAt: run.startedAt ?? startedAt });
    if (node.type === "approval") {
      const next = nextNodeId(node, edges);
      if (!next) throw new ExecutionError(`Approval node "${node.id}" has no outgoing route.`, "APPROVAL_ROUTE_MISSING");
      const configuredRole = node.config.assigneeRole;
      const allowedRoles = ["owner", "admin", "operator", "viewer"];
      const assigneeRole = typeof configuredRole === "string" && allowedRoles.includes(configuredRole) ? configuredRole : "operator";
      const configuredUser = node.config.assigneeUserId;
      const assigneeUserId = typeof configuredUser === "string" && /^[a-f\d]{24}$/i.test(configuredUser) ? configuredUser : null;
      const timeoutValue = Number(node.config.timeoutMinutes);
      const timeoutMinutes = Number.isFinite(timeoutValue) ? Math.min(10080, Math.max(1, Math.floor(timeoutValue))) : 1440;
      const dueAt = new Date(Date.now() + timeoutMinutes * 60_000);
      const approval = await Approval.findOneAndUpdate(
        { tenantId: run.tenantId, runId: run._id, nodeId: node.id },
        { $setOnInsert: {
          tenantId: run.tenantId, runId: run._id, workflowId: run.workflowId,
          workflowVersion: run.workflowVersion, graphHash: run.graphHash, nodeId: node.id,
          nodeLabel: node.label, nextNodeId: next,
          title: typeof node.config.title === "string" && node.config.title.trim() ? node.config.title.trim().slice(0, 160) : node.label,
          description: typeof node.config.description === "string" ? node.config.description.slice(0, 2000) : "",
          assigneeRole, assigneeUserId, requestedBy: run.requestedBy, dueAt, status: "pending"
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (approval.status === "pending") {
        const waiting = steps.map(step => step.nodeId === node.id ? { ...step, status: "waiting_approval" as const, completedAt: null, output: { approvalId: String(approval._id), dueAt: approval.dueAt } } : step);
        await checkpoint(runId, token, { steps: waiting, currentNodeId: node.id, status: "waiting_approval", leaseToken: null, leaseExpiresAt: null });
        return;
      }
      throw new ExecutionError("Approval has already reached a terminal state while the run is still at its approval node.", "APPROVAL_STATE_CONFLICT");
    }
    try {
      const output = await executeNode(node);
      const completedAt = new Date();
      const done = steps.map(step => step.nodeId === node.id ? { ...step, status: "succeeded" as const, completedAt, output } : step);
      const next = nextNodeId(node, edges);
      if (node.type === "end") {
        await checkpoint(runId, token, { steps: done, currentNodeId: null, status: "succeeded", completedAt, leaseToken: null, leaseExpiresAt: null, lastError: null });
        return;
      }
      if (next === null) throw new ExecutionError(`Node "${node.id}" has no outgoing route before the end node.`, "WORKFLOW_PATH_TERMINATED");
      await checkpoint(runId, token, { steps: done, currentNodeId: next });
      stepsState = done;
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

async function expirePendingApprovals(): Promise<void> {
  const now = new Date();
  const expired = await Approval.find({ status: "pending", dueAt: { $lte: now } }).sort({ dueAt: 1 }).limit(100).lean();
  for (const approval of expired) {
    const changed = await Approval.updateOne(
      { _id: approval._id, tenantId: approval.tenantId, status: "pending", dueAt: { $lte: now } },
      { $set: { status: "expired", decidedAt: now, decisionComment: "Approval deadline elapsed." } }
    );
    if (changed.modifiedCount !== 1) continue;
    const run = await ExecutionRun.findOne({ _id: approval.runId, tenantId: approval.tenantId, status: "waiting_approval", currentNodeId: approval.nodeId });
    if (run) {
      run.status = "failed";
      run.lastError = "APPROVAL_EXPIRED: Human approval deadline elapsed.";
      run.completedAt = now;
      run.steps = run.steps.map(step => step.nodeId === approval.nodeId ? { ...step.toObject(), status: "failed", completedAt: now, error: "Human approval deadline elapsed." } as typeof step : step);
      await run.save();
    }
    await writeAuditEvent({ tenantId: String(approval.tenantId), action: "approval.expired", resourceType: "approval", resourceId: String(approval._id), metadata: { runId: String(approval.runId), nodeId: approval.nodeId } });
  }
}

export async function processNextExecution(): Promise<boolean> {
  await expirePendingApprovals();
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
