export const permissions = [
  "workspace:read",
  "workspace:manage",
  "members:read",
  "members:manage",
  "agents:read",
  "agents:write",
  "workflows:read",
  "workflows:write",
  "runs:read",
  "runs:operate",
  "approvals:read",
  "approvals:decide",
  "policies:read",
  "policies:manage",
  "audit:read",
  "billing:read",
  "evaluations:read",
  "evaluations:write",
  "evaluations:run"
] as const;

export type Permission = typeof permissions[number];
export type Role = "owner" | "admin" | "operator" | "viewer";

const rolePermissions: Record<Role, readonly Permission[]> = {
  owner: permissions,
  admin: permissions.filter(permission => permission !== "billing:read"),
  operator: ["workspace:read", "agents:read", "agents:write", "workflows:read", "workflows:write", "runs:read", "runs:operate", "approvals:read", "approvals:decide", "evaluations:read", "evaluations:write", "evaluations:run"],
  viewer: ["workspace:read", "members:read", "agents:read", "workflows:read", "runs:read", "approvals:read", "policies:read", "audit:read", "billing:read", "evaluations:read"]
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}
