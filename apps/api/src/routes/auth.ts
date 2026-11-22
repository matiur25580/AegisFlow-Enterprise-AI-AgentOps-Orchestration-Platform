import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../config/env.js";
import { User } from "../models/user.model.js";
import { Tenant } from "../models/tenant.model.js";
import { Membership } from "../models/membership.model.js";
import { RefreshSession } from "../models/refresh-session.model.js";
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

authRouter.get("/me", authenticate, asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const tenant = await Tenant.findById(auth.tenantId).select("name slug plan").lean();
  res.json({ data: { user: { id: auth.userId, email: auth.email, displayName: auth.displayName }, tenant, membership: { id: auth.membershipId, role: auth.role } } });
}));
