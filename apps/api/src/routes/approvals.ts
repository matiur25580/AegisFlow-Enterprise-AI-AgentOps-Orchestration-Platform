import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { Approval } from "../models/approval.model.js";
import { ExecutionRun } from "../models/execution-run.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";

export const approvalsRouter = Router();
approvalsRouter.use(authenticate);

const idSchema = z.string().regex(/^[a-f\\d]{24}$/i);
const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(2000).optional().default("")
}).strict();

function assignmentFilter(auth: AuthContext) {
  return {
    $or: [
      { assigneeUserId: auth.userId },
      { assigneeUserId: null, assigneeRole: auth.role }
    ]
  };
}

function canReview(approval: { assigneeUserId?: unknown; assigneeRole: string }, auth: AuthContext): boolean {
  if (approval.assigneeUserId) return String(approval.assigneeUserId) === auth.userId;
  return approval.assigneeRole === auth.role;
}

approvalsRouter.get("/", requirePermission("approvals:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter: Record<string, unknown> = { tenantId: auth.tenantId, ...assignmentFilter(auth) };
  if (typeof req.query.status === "string" && ["pending", "approved", "rejected", "expired", "cancelled"].includes(req.query.status)) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    Approval.find(filter).sort({ status: 1, dueAt: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .select("-__v").lean(),
    Approval.countDocuments(filter)
  ]);
  res.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

approvalsRouter.get("/:approvalId", requirePermission("approvals:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const approvalId = idSchema.parse(req.params.approvalId);
  const approval = await Approval.findOne({ _id: approvalId, tenantId: auth.tenantId, ...assignmentFilter(auth) }).lean();
  if (!approval) { res.status(404).json({ error: { code: "APPROVAL_NOT_FOUND", message: "Approval was not found in this workspace or is not assigned to you." } }); return; }
  const run = await ExecutionRun.findOne({ _id: approval.runId, tenantId: auth.tenantId }).select("-nodes -edges").lean();
  res.json({ data: { approval, run } });
}));

approvalsRouter.post("/:approvalId/decision", requirePermission("approvals:decide"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const approvalId = idSchema.parse(req.params.approvalId);
  const input = decisionSchema.parse(req.body);
  const now = new Date();
  const session = await mongoose.startSession();
  let decided: Record<string, unknown> | null = null;

  try {
    await session.withTransaction(async () => {
      const existing = await Approval.findOne({ _id: approvalId, tenantId: auth.tenantId }).session(session);
      if (!existing || !canReview(existing, auth)) {
        throw Object.assign(new Error("Approval was not found or is not assigned to your identity/role."), { statusCode: 404, code: "APPROVAL_NOT_FOUND" });
      }
      if (existing.status !== "pending" || existing.dueAt <= now) {
        throw Object.assign(new Error("This approval is no longer pending or its deadline has passed."), { statusCode: 409, code: "APPROVAL_NOT_PENDING" });
      }

      const run = await ExecutionRun.findOne({
        _id: existing.runId, tenantId: auth.tenantId, status: "waiting_approval", currentNodeId: existing.nodeId
      }).session(session);
      if (!run) throw Object.assign(new Error("The workflow run is no longer waiting for this approval."), { statusCode: 409, code: "APPROVAL_RUN_STATE_CONFLICT" });

      const updated = await Approval.findOneAndUpdate(
        { _id: approvalId, tenantId: auth.tenantId, status: "pending", dueAt: { $gt: now } },
        { $set: { status: input.decision === "approve" ? "approved" : "rejected", decidedAt: now, decidedBy: auth.userId, decisionComment: input.comment } },
        { new: true, session, runValidators: true }
      );
      if (!updated) throw Object.assign(new Error("Another reviewer already decided this approval."), { statusCode: 409, code: "APPROVAL_ALREADY_DECIDED" });

      const steps = run.steps.map(step => {
        if (step.nodeId !== existing.nodeId) return step;
        return {
          ...step.toObject(),
          status: input.decision === "approve" ? "succeeded" : "failed",
          completedAt: now,
          output: { approvalId: String(updated._id), decision: input.decision, decidedBy: auth.userId, comment: input.comment },
          error: input.decision === "reject" ? "Human reviewer rejected this workflow step." : null
        };
      });
      run.steps = steps as typeof run.steps;
      if (input.decision === "approve") {
        run.status = "queued";
        run.currentNodeId = existing.nextNodeId;
        run.nextAttemptAt = now;
        run.lastError = null;
        run.completedAt = null;
      } else {
        run.status = "failed";
        run.lastError = "APPROVAL_REJECTED: Human reviewer rejected this workflow step.";
        run.completedAt = now;
      }
      run.leaseToken = null;
      run.leaseExpiresAt = null;
      await run.save({ session });
      decided = updated.toObject();
    });
  } finally {
    await session.endSession();
  }

  await writeAuditEvent({
    tenantId: auth.tenantId, actorUserId: auth.userId,
    action: input.decision === "approve" ? "approval.approved" : "approval.rejected",
    resourceType: "approval", resourceId: approvalId,
    metadata: { runId: String((decided as Record<string, unknown> | null)?.runId ?? ""), commentLength: input.comment.length },
    ipAddress: req.ip
  });
  res.json({ data: decided });
}));
