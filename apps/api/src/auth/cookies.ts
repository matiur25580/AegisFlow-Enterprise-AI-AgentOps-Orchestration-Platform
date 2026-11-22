import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

const cookieName = "aegisflow_refresh";
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: `${env.API_PREFIX}/auth`
};

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(cookieName, token, { ...cookieOptions, maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000 });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(cookieName, cookieOptions);
}

export function readRefreshCookie(cookies: Record<string, string> | undefined): string | undefined {
  return cookies?.[cookieName];
}
