import type { Role } from "./permissions.js";

export interface AuthContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  sessionId: string;
  role: Role;
  email: string;
  displayName: string;
}
