import { Router, type Request } from "express";
import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../config/env.js";
import { User } from "../models/user.model.js";
import { Tenant } from "../models/tenant.model.js";
import { Membership } from "../models/membership.model.js";
import { RefreshSession } from "../models/refresh-session.model.js";
import { Invitation } from "../models/invitation.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "../auth/cookies.js";
import { createRefreshToken, hashToken, issueAccessToken } from "../auth/tokens.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";

export const authRouter = Router();

const signupSchema = z.object({
  organizationName: z.string().trim().min(2).max(100),
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128).regex(/[a-z]/, "Password must contain a lowercase letter").regex(/[A-Z]/, "Password must contain an uppercase letter").regex(/[0-9]/, "Password must contain a number")
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(1).max(128)
});

function createSlug(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createSession(userId: string, tenantId: string, req: Request) {
  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  const session = await RefreshSession.create({
    userId, tenantId, tokenHash: hashToken(refreshToken), expiresAt,
    userAgent: req.get("user-agent")?.slice(0, 500),
    ipAddress: req.ip?.slice(0, 64)
  });
  return { refreshToken, session };
}

authRouter.post("/signup", asyncHandler(async (req, res) => {
  const input = signupSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({ email: input.email, displayName: input.displayName, passwordHash });
  let tenantId: string | undefined;
  try {
    const tenant = await Tenant.create({ name: input.organizationName, slug: createSlug(input.organizationName) });
    tenantId = String(tenant._id);
    const membership = await Membership.create({ tenantId, userId: user._id, role: "owner", status: "active" });
    const { refreshToken, session } = await createSession(String(user._id), tenantId, req);
    const accessToken = issueAccessToken({ sub: String(user._id), tenantId, membershipId: String(membership._id), sid: String(session._id) });
    await writeAuditEvent({ tenantId, actorUserId: String(user._id), action: "identity.organization.created", resourceType: "tenant", resourceId: tenantId, requestId: res.locals.requestId, ipAddress: req.ip });
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ data: { accessToken, tokenType: "Bearer", expiresIn: env.JWT_ACCESS_TTL, user: { id: String(user._id), email: user.email, displayName: user.displayName }, tenant: { id: tenantId, name: tenant.name, slug: tenant.slug }, role: membership.role } });
  } catch (error) {
    if (tenantId) {
      await Promise.all([
        Membership.deleteMany({ tenantId, userId: user._id }),
        RefreshSession.deleteMany({ tenantId, userId: user._id }),
        Tenant.deleteOne({ _id: tenantId })
      ]);
    }
    await User.deleteOne({ _id: user._id });
    throw error;
  }
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  if (!user || user.status !== "active" || !(await bcrypt.compare(input.password, user.passwordHash))) {
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }, requestId: res.locals.requestId });
    return;
  }
  const membership = await Membership.findOne({ userId: user._id, status: "active" }).sort({ createdAt: 1 });
  if (!membership) {
    res.status(403).json({ error: { code: "NO_ACTIVE_WORKSPACE", message: "No active workspace membership was found." }, requestId: res.locals.requestId });
    return;
  }
  const tenant = await Tenant.findOne({ _id: membership.tenantId, status: "active" });
  if (!tenant) {
    res.status(403).json({ error: { code: "WORKSPACE_UNAVAILABLE", message: "Your workspace is unavailable." }, requestId: res.locals.requestId });
    return;
  }
  const { refreshToken, session } = await createSession(String(user._id), String(tenant._id), req);
  const accessToken = issueAccessToken({ sub: String(user._id), tenantId: String(tenant._id), membershipId: String(membership._id), sid: String(session._id) });
  await writeAuditEvent({ tenantId: String(tenant._id), actorUserId: String(user._id), action: "identity.session.created", resourceType: "session", resourceId: String(session._id), requestId: res.locals.requestId, ipAddress: req.ip });
  setRefreshCookie(res, refreshToken);
  res.json({ data: { accessToken, tokenType: "Bearer", expiresIn: env.JWT_ACCESS_TTL, user: { id: String(user._id), email: user.email, displayName: user.displayName }, tenant: { id: String(tenant._id), name: tenant.name, slug: tenant.slug }, role: membership.role } });
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const rawToken = readRefreshCookie(req.cookies);
  if (!rawToken) {
    res.status(401).json({ error: { code: "REFRESH_REQUIRED", message: "A refresh session is required." }, requestId: res.locals.requestId });
    return;
  }
  const tokenHash = hashToken(rawToken);
  const session = await RefreshSession.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!session) {
    clearRefreshCookie(res);
    res.status(401).json({ error: { code: "REFRESH_INVALID", message: "The refresh session is invalid or expired." }, requestId: res.locals.requestId });
    return;
  }

  const [user, membership, tenant] = await Promise.all([
    User.findOne({ _id: session.userId, status: "active" }),
    Membership.findOne({ userId: session.userId, tenantId: session.tenantId, status: "active" }),
    Tenant.findOne({ _id: session.tenantId, status: "active" })
  ]);
  if (!user || !membership || !tenant) {
    clearRefreshCookie(res);
    res.status(401).json({ error: { code: "SESSION_INVALID", message: "The account or workspace is no longer active." }, requestId: res.locals.requestId });
    return;
  }

  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  const replacement = await RefreshSession.create({
    userId: user._id, tenantId: tenant._id, tokenHash: hashToken(refreshToken), expiresAt,
    userAgent: req.get("user-agent")?.slice(0, 500), ipAddress: req.ip?.slice(0, 64)
  });
  session.replacedByHash = hashToken(refreshToken);
  await session.save();
  const accessToken = issueAccessToken({ sub: String(user._id), tenantId: String(tenant._id), membershipId: String(membership._id), sid: String(replacement._id) });
  setRefreshCookie(res, refreshToken);
  res.json({ data: { accessToken, tokenType: "Bearer", expiresIn: env.JWT_ACCESS_TTL } });
}));

authRouter.post("/logout", authenticate, asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  await RefreshSession.updateOne({ _id: auth.sessionId, tenantId: auth.tenantId, userId: auth.userId }, { $set: { revokedAt: new Date() } });
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "identity.session.revoked", resourceType: "session", resourceId: auth.sessionId, requestId: res.locals.requestId });
  clearRefreshCookie(res);
  res.status(204).end();
}));


const workspaceSwitchSchema = z.object({ tenantId: z.string().regex(/^[a-f0-9]{24}$/i) }).strict();
const sessionIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);

authRouter.post("/switch-workspace", authenticate, asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = workspaceSwitchSchema.parse(req.body);
  const [membership, tenant] = await Promise.all([
    Membership.findOne({ userId: auth.userId, tenantId: new Types.ObjectId(input.tenantId), status: "active" }),
    Tenant.findOne({ _id: new Types.ObjectId(input.tenantId), status: "active" })
  ]);
  if (!membership || !tenant) {
    res.status(403).json({ error: { code: "WORKSPACE_ACCESS_DENIED", message: "You do not have an active membership in this workspace." }, requestId: res.locals.requestId });
    return;
  }
  const { refreshToken, session: replacement } = await createSession(auth.userId, input.tenantId, req);
  const revoked = await RefreshSession.findOneAndUpdate(
    { _id: auth.sessionId, userId: auth.userId, tenantId: auth.tenantId, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date(), replacedByHash: hashToken(refreshToken) } },
    { new: true }
  );
  if (!revoked) {
    await RefreshSession.deleteOne({ _id: replacement._id, userId: auth.userId });
    res.status(401).json({ error: { code: "SESSION_INVALID", message: "Your current session is no longer valid." }, requestId: res.locals.requestId });
    return;
  }
  const accessToken = issueAccessToken({ sub: auth.userId, tenantId: input.tenantId, membershipId: String(membership._id), sid: String(replacement._id) });
  await writeAuditEvent({
    tenantId: input.tenantId, actorUserId: auth.userId, action: "identity.workspace.switched",
    resourceType: "tenant", resourceId: input.tenantId,
    metadata: { previousTenantId: auth.tenantId }, requestId: res.locals.requestId, ipAddress: req.ip
  });
  setRefreshCookie(res, refreshToken);
  res.json({ data: { accessToken, tokenType: "Bearer", expiresIn: env.JWT_ACCESS_TTL, tenant: { id: String(tenant._id), name: tenant.name, slug: tenant.slug }, role: membership.role } });
}));

authRouter.get("/sessions", authenticate, asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const sessions = await RefreshSession.find({ userId: auth.userId, tenantId: auth.tenantId })
    .sort({ createdAt: -1 }).limit(50)
    .select("createdAt expiresAt revokedAt userAgent")
    .lean();
  res.json({ data: sessions.map(session => ({ id: String(session._id), createdAt: session.createdAt, expiresAt: session.expiresAt, revokedAt: session.revokedAt, current: String(session._id) === auth.sessionId, userAgent: session.userAgent ?? null })) });
}));

authRouter.delete("/sessions/:sessionId", authenticate, asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const sessionId = sessionIdSchema.parse(req.params.sessionId);
  const session = await RefreshSession.findOneAndUpdate(
    { _id: sessionId, userId: auth.userId, tenantId: auth.tenantId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true }
  ).select("_id");
  if (!session) {
    res.status(404).json({ error: { code: "SESSION_NOT_FOUND", message: "Active session not found." }, requestId: res.locals.requestId });
    return;
  }
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "identity.session.revoked", resourceType: "session", resourceId: sessionId, requestId: res.locals.requestId, ipAddress: req.ip });
  if (sessionId === auth.sessionId) clearRefreshCookie(res);
  res.status(204).end();
}));

authRouter.post("/sessions/revoke-others", authenticate, asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const result = await RefreshSession.updateMany(
    { userId: auth.userId, tenantId: auth.tenantId, _id: { $ne: auth.sessionId }, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "identity.sessions.revoked_others", resourceType: "session", metadata: { revokedCount: result.modifiedCount }, requestId: res.locals.requestId });
  res.json({ data: { revokedCount: result.modifiedCount } });
}));


authRouter.get("/workspaces", authenticate, asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const memberships = await Membership.find({ userId: auth.userId, status: "active" }).sort({ createdAt: 1 }).lean();
  const tenantIds = memberships.map(membership => membership.tenantId);
  const tenants = await Tenant.find({ _id: { $in: tenantIds }, status: "active" }).select("name slug plan").lean();
  const tenantById = new Map(tenants.map(item => [String(item._id), item]));
  const data = memberships.flatMap(membership => {
    const workspace = tenantById.get(String(membership.tenantId));
    return workspace ? [{ id: String(membership._id), role: membership.role, tenant: { id: String(workspace._id), name: workspace.name, slug: workspace.slug, plan: workspace.plan } }] : [];
  });
  res.json({ data });
}));

authRouter.get("/me", authenticate, asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const tenant = await Tenant.findById(auth.tenantId).select("name slug plan").lean();
  res.json({ data: { user: { id: auth.userId, email: auth.email, displayName: auth.displayName }, tenant, membership: { id: auth.membershipId, role: auth.role } } });
}));


type AcceptedMembership = { _id: Types.ObjectId; role: "owner" | "admin" | "operator" | "viewer" };

const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(128),
  displayName: z.string().trim().min(2).max(80),
  password: z.string().min(12).max(128)
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a number")
}).strict();

authRouter.post("/accept-invitation", asyncHandler(async (req, res) => {
  const input = acceptInvitationSchema.parse(req.body);
  const now = new Date();
  const invitation = await Invitation.findOne({
    tokenHash: hashToken(input.token), acceptedAt: null, revokedAt: null, expiresAt: { $gt: now }
  });
  if (!invitation) {
    res.status(410).json({ error: { code: "INVITATION_INVALID", message: "This invitation is invalid, expired, or has already been used." }, requestId: res.locals.requestId });
    return;
  }

  let user = await User.findOne({ email: invitation.email }).select("+passwordHash");
  let createdUser = false;
  let membership: AcceptedMembership | undefined;
  let claimed = false;
  let refreshSessionId: string | undefined;
  try {
    if (user) {
      if (user.status !== "active" || !(await bcrypt.compare(input.password, user.passwordHash))) {
        res.status(401).json({ error: { code: "INVITATION_ACCOUNT_AUTH_FAILED", message: "Sign in with the password for the invited email address to accept this invitation." }, requestId: res.locals.requestId });
        return;
      }
    } else {
      const passwordHash = await bcrypt.hash(input.password, 12);
      user = await User.create({ email: invitation.email, displayName: input.displayName, passwordHash });
      createdUser = true;
    }

    membership = await Membership.create({
      tenantId: invitation.tenantId, userId: user._id, role: invitation.role, status: "active"
    });
    const accepted = await Invitation.findOneAndUpdate(
      { _id: invitation._id, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { acceptedAt: new Date(), acceptedByUserId: user._id } },
      { new: true }
    );
    if (!accepted) {
      await Membership.deleteOne({ _id: membership._id, tenantId: invitation.tenantId });
      membership = undefined;
      if (createdUser) await User.deleteOne({ _id: user._id });
      res.status(410).json({ error: { code: "INVITATION_ALREADY_USED", message: "This invitation is no longer available." }, requestId: res.locals.requestId });
      return;
    }
    claimed = true;

    const tenant = await Tenant.findOne({ _id: invitation.tenantId, status: "active" });
    if (!tenant) throw Object.assign(new Error("The invited workspace is unavailable."), { statusCode: 410, code: "WORKSPACE_UNAVAILABLE" });
    const { refreshToken, session } = await createSession(String(user._id), String(tenant._id), req);
    refreshSessionId = String(session._id);
    const accessToken = issueAccessToken({ sub: String(user._id), tenantId: String(tenant._id), membershipId: String(membership._id), sid: String(session._id) });
    await writeAuditEvent({
      tenantId: String(tenant._id), actorUserId: String(user._id), action: "identity.invitation.accepted",
      resourceType: "invitation", resourceId: String(invitation._id),
      metadata: { role: membership.role }, requestId: res.locals.requestId, ipAddress: req.ip
    });
    setRefreshCookie(res, refreshToken);
    res.status(201).json({
      data: {
        accessToken, tokenType: "Bearer", expiresIn: env.JWT_ACCESS_TTL,
        user: { id: String(user._id), email: user.email, displayName: user.displayName },
        tenant: { id: String(tenant._id), name: tenant.name, slug: tenant.slug },
        role: membership.role
      }
    });
  } catch (error) {
    if (claimed) {
      await Invitation.updateOne({ _id: invitation._id, acceptedByUserId: user?._id }, { $set: { acceptedAt: null, acceptedByUserId: null } });
    }
    if (membership) await Membership.deleteOne({ _id: membership._id, tenantId: invitation.tenantId });
    if (refreshSessionId) await RefreshSession.deleteOne({ _id: refreshSessionId, userId: user?._id });
    if (createdUser && user) await User.deleteOne({ _id: user._id });
    throw error;
  }
}));
