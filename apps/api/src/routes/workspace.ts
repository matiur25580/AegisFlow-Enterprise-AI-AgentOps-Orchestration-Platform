import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { AuditEvent } from "../models/audit-event.model.js";
import { Invitation } from "../models/invitation.model.js";
import { Membership } from "../models/membership.model.js";
import { User } from "../models/user.model.js";
import { permissions, hasPermission, type Role } from "../auth/permissions.js";
import { hashToken } from "../auth/tokens.js";
import type { AuthContext } from "../auth/types.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import { auditQuerySchema, buildAuditFilter } from "../audit/audit-query.js";

export const workspaceRouter = Router();
workspaceRouter.use(authenticate);

const objectIdSchema = z.string().regex(/^[a-f\\d]{24}$/i, "A valid id is required.");
const invitationSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  role: z.enum(["admin", "operator", "viewer"])
}).strict();
const roleSchema = z.object({ role: z.enum(["admin", "operator", "viewer"]) }).strict();
const membershipStatusSchema = z.object({ status: z.enum(["active", "suspended"]) }).strict();

workspaceRouter.get("/summary", requirePermission("workspace:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  res.json({ data: { tenantId: auth.tenantId, role: auth.role, permissions: permissions.filter(permission => hasPermission(auth.role, permission)) } });
}));

workspaceRouter.get("/audit-events", requirePermission("audit:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: "INVALID_AUDIT_QUERY", message: "The audit event filters are invalid.", fields: parsed.error.flatten().fieldErrors },
      requestId: res.locals.requestId
    });
    return;
  }
  const { page, limit } = parsed.data;
  const filter = buildAuditFilter(auth.tenantId, parsed.data);
  const [events, total] = await Promise.all([
    AuditEvent.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .select("-ipAddress").lean(),
    AuditEvent.countDocuments(filter)
  ]);
  res.json({
    data: events,
    pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNextPage: page * limit < total }
  });
}));

workspaceRouter.get("/members", requirePermission("members:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const members = await Membership.find({ tenantId: auth.tenantId })
    .sort({ createdAt: 1 })
    .populate({ path: "userId", select: "email displayName status" })
    .lean();
  res.json({ data: members });
}));

workspaceRouter.patch("/members/:membershipId/role", requirePermission("members:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const membershipId = objectIdSchema.parse(req.params.membershipId);
  const input = roleSchema.parse(req.body);
  const target = await Membership.findOne({ _id: membershipId, tenantId: auth.tenantId });
  if (!target) {
    res.status(404).json({ error: { code: "MEMBERSHIP_NOT_FOUND", message: "Workspace membership not found." } });
    return;
  }
  if (target.role === "owner" || String(target.userId) === auth.userId) {
    res.status(409).json({ error: { code: "MEMBERSHIP_ROLE_PROTECTED", message: "The owner role and your own membership cannot be changed here." } });
    return;
  }
  if (auth.role !== "owner" && (target.role === "admin" || input.role === "admin")) {
    res.status(403).json({ error: { code: "ROLE_CHANGE_FORBIDDEN", message: "Only the workspace owner can assign or change administrator roles." } });
    return;
  }
  const previousRole = target.role;
  target.role = input.role;
  await target.save();
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "identity.membership.role_changed", resourceType: "membership", resourceId: membershipId, metadata: { previousRole, role: input.role }, requestId: res.locals.requestId, ipAddress: req.ip });
  res.json({ data: { id: String(target._id), role: target.role, status: target.status } });
}));

workspaceRouter.patch("/members/:membershipId/status", requirePermission("members:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const membershipId = objectIdSchema.parse(req.params.membershipId);
  const input = membershipStatusSchema.parse(req.body);
  const target = await Membership.findOne({ _id: membershipId, tenantId: auth.tenantId });
  if (!target) {
    res.status(404).json({ error: { code: "MEMBERSHIP_NOT_FOUND", message: "Workspace membership not found." } });
    return;
  }
  if (target.role === "owner" || String(target.userId) === auth.userId) {
    res.status(409).json({ error: { code: "MEMBERSHIP_STATUS_PROTECTED", message: "The owner role and your own membership cannot be suspended or reactivated here." } });
    return;
  }
  if (auth.role !== "owner" && target.role === "admin") {
    res.status(403).json({ error: { code: "MEMBERSHIP_STATUS_FORBIDDEN", message: "Only the workspace owner can change an administrator's membership status." } });
    return;
  }
  const previousStatus = target.status;
  target.status = input.status;
  await target.save();
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "identity.membership.status_changed", resourceType: "membership", resourceId: membershipId, metadata: { previousStatus, status: input.status }, requestId: res.locals.requestId, ipAddress: req.ip });
  res.json({ data: { id: String(target._id), role: target.role, status: target.status } });
}));

workspaceRouter.get("/invitations", requirePermission("members:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const invitations = await Invitation.find({ tenantId: auth.tenantId })
    .sort({ createdAt: -1 }).limit(100)
    .select("-tokenHash")
    .lean();
  res.json({ data: invitations });
}));

workspaceRouter.post("/invitations", requirePermission("members:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = invitationSchema.parse(req.body);
  if (input.role === "admin" && auth.role !== "owner") {
    res.status(403).json({ error: { code: "ADMIN_INVITE_FORBIDDEN", message: "Only the workspace owner can invite an administrator." } });
    return;
  }
  const user = await User.findOne({ email: input.email }).select("_id").lean();
  if (user) {
    const existingMembership = await Membership.findOne({ tenantId: auth.tenantId, userId: user._id }).select("_id").lean();
    if (existingMembership) {
      res.status(409).json({ error: { code: "MEMBER_ALREADY_EXISTS", message: "This user already has a membership in the workspace." } });
      return;
    }
  }
  const now = new Date();
  const pending = await Invitation.findOne({ tenantId: auth.tenantId, email: input.email, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } }).select("_id").lean();
  if (pending) {
    res.status(409).json({ error: { code: "INVITATION_ALREADY_PENDING", message: "An unexpired invitation already exists for this email address." } });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const invitation = await Invitation.create({
    tenantId: auth.tenantId, email: input.email, role: input.role, tokenHash: hashToken(token),
    invitedByUserId: auth.userId, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  });
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "identity.invitation.created", resourceType: "invitation", resourceId: String(invitation._id), metadata: { email: input.email, role: input.role, expiresAt: invitation.expiresAt.toISOString() }, requestId: res.locals.requestId, ipAddress: req.ip });
  res.status(201).json({
    data: {
      id: String(invitation._id), email: invitation.email, role: invitation.role,
      expiresAt: invitation.expiresAt, invitationToken: token,
      acceptanceEndpoint: "/api/v1/auth/accept-invitation"
    },
    delivery: { status: "manual", message: "Share this one-time token with the invitee using an approved channel. Email delivery is not configured." }
  });
}));

workspaceRouter.post("/invitations/:invitationId/revoke", requirePermission("members:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const invitationId = objectIdSchema.parse(req.params.invitationId);
  const invitation = await Invitation.findOneAndUpdate(
    { _id: invitationId, tenantId: auth.tenantId, acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true }
  ).select("-tokenHash");
  if (!invitation) {
    res.status(404).json({ error: { code: "INVITATION_NOT_PENDING", message: "Pending invitation not found." } });
    return;
  }
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "identity.invitation.revoked", resourceType: "invitation", resourceId: invitationId, metadata: { email: invitation.email }, requestId: res.locals.requestId, ipAddress: req.ip });
  res.json({ data: invitation });
}));
