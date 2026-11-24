import type { RequestHandler } from "express";
import { User } from "../models/user.model.js";
import { Membership } from "../models/membership.model.js";
import { RefreshSession } from "../models/refresh-session.model.js";
import { Tenant } from "../models/tenant.model.js";
import { verifyAccessToken } from "../auth/tokens.js";
import type { AuthContext } from "../auth/types.js";

// Revalidate user, tenant membership, and refresh-session status after verifying the access token.
export const authenticate: RequestHandler = async (req, res, next) => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Authentication is required." }, requestId: res.locals.requestId });
    return;
  }

  let claims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "A valid access token is required." }, requestId: res.locals.requestId });
    return;
  }

  try {
    const [user, membership, session, tenant] = await Promise.all([
      User.findById(claims.sub).select("email displayName status").lean(),
      Membership.findOne({ _id: claims.membershipId, userId: claims.sub, tenantId: claims.tenantId, status: "active" }).lean(),
      RefreshSession.findOne({ _id: claims.sid, userId: claims.sub, tenantId: claims.tenantId, revokedAt: null, expiresAt: { $gt: new Date() } }).lean(),
      Tenant.findOne({ _id: claims.tenantId, status: "active" }).select("_id").lean()
    ]);

    if (!user || user.status !== "active" || !membership || !session || !tenant) {
      res.status(401).json({ error: { code: "SESSION_INVALID", message: "Your session is no longer valid." }, requestId: res.locals.requestId });
      return;
    }

    res.locals.auth = {
      userId: String(user._id),
      tenantId: String(membership.tenantId),
      membershipId: String(membership._id),
      sessionId: String(session._id),
      role: membership.role,
      email: user.email,
      displayName: user.displayName
    } satisfies AuthContext;
    next();
  } catch (error) {
    next(error);
  }
};
