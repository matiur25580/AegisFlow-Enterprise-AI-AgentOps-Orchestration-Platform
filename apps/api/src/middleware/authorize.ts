import type { RequestHandler } from "express";
import { hasPermission, type Permission } from "../auth/permissions.js";
import type { AuthContext } from "../auth/types.js";

// Gate the route using the permission map associated with the authenticated tenant role.
export function requirePermission(permission: Permission): RequestHandler {
  return (_req, res, next) => {
    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth || !hasPermission(auth.role, permission)) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." }, requestId: res.locals.requestId });
      return;
    }
    next();
  };
}
