import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { AuditEvent } from "../models/audit-event.model.js";
import { permissions, hasPermission } from "../auth/permissions.js";
import type { AuthContext } from "../auth/types.js";
import { asyncHandler } from "../utils/async-handler.js";
import { auditQuerySchema, buildAuditFilter } from "../audit/audit-query.js";

export const workspaceRouter = Router();
workspaceRouter.use(authenticate);

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
