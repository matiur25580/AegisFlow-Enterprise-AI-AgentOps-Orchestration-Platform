import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { AuditEvent } from "../models/audit-event.model.js";
import { permissions, hasPermission } from "../auth/permissions.js";
import type { AuthContext } from "../auth/types.js";
import { asyncHandler } from "../utils/async-handler.js";

export const workspaceRouter = Router();
workspaceRouter.use(authenticate);

workspaceRouter.get("/summary", requirePermission("workspace:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  res.json({ data: { tenantId: auth.tenantId, role: auth.role, permissions: permissions.filter(permission => hasPermission(auth.role, permission)) } });
}));

workspaceRouter.get("/audit-events", requirePermission("audit:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const events = await AuditEvent.find({ tenantId: auth.tenantId }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ data: events });
}));
