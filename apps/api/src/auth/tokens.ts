import { createHash, randomBytes } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AccessClaims {
  sub: string;
  tenantId: string;
  membershipId: string;
  sid: string;
}

export function issueAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"],
    issuer: "aegisflow-api",
    audience: "aegisflow-web"
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
    issuer: "aegisflow-api",
    audience: "aegisflow-web"
  });
  if (typeof payload === "string" || !payload.sub || !payload.tenantId || !payload.membershipId || !payload.sid) {
    throw new Error("Invalid access token claims");
  }
  return payload as AccessClaims;
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
