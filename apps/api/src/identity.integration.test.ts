import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { AuditEvent } from "./models/audit-event.model.js";
import { Invitation } from "./models/invitation.model.js";
import { Membership } from "./models/membership.model.js";
import { RefreshSession } from "./models/refresh-session.model.js";
import { Tenant } from "./models/tenant.model.js";
import { User } from "./models/user.model.js";

const integrationEnabled = Boolean(
  process.env.MONGODB_URI &&
  process.env.JWT_ACCESS_SECRET &&
  process.env.JWT_ACCESS_SECRET.length >= 32
);

type ApiPayload = {
  data?: any;
  error?: { code?: string; message?: string };
};

type RequestOptions = {
  method?: string;
  token?: string;
  cookie?: string;
  body?: unknown;
};

let server: Server;
let baseUrl = "";

function refreshCookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  const token = header?.match(/aegisflow_refresh=([^;]+)/)?.[1];
  assert.ok(token, "response should set the HttpOnly refresh cookie");
  return "aegisflow_refresh=" + token;
}

function tokenFromCookie(cookie: string): string {
  return cookie.slice("aegisflow_refresh=".length);
}

async function request(path: string, options: RequestOptions = {}): Promise<{ response: Response; payload: ApiPayload }> {
  const headers = new Headers();
  if (options.token) headers.set("authorization", "Bearer " + options.token);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(baseUrl + "/api/v1" + path, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = response.status === 204 ? {} : await response.json() as ApiPayload;
  return { response, payload };
}

async function signUp(label: string) {
  const email = "identity-" + randomUUID() + "@example.test";
  const { response, payload } = await request("/auth/signup", {
    method: "POST",
    body: {
      organizationName: label + " Workspace",
      displayName: label + " Owner",
      email,
      password: "IntegrationTestPassword123"
    }
  });
  assert.equal(response.status, 201, JSON.stringify(payload.error));
  assert.ok(payload.data?.accessToken);
  return { data: payload.data, cookie: refreshCookie(response), email };
}

describe("MongoDB-backed identity integration", { skip: !integrationEnabled }, () => {
  before(async () => {
    const { env } = await import("./config/env.js");
    await mongoose.connect(env.MONGODB_URI);
    await Promise.all([
      User.init(), Tenant.init(), Membership.init(), RefreshSession.init(), Invitation.init(), AuditEvent.init()
    ]);
    const { app } = await import("./app.js");
    server = app.listen(0);
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
    baseUrl = "http://127.0.0.1:" + address.port;
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Tenant.deleteMany({}),
      Membership.deleteMany({}),
      RefreshSession.deleteMany({}),
      Invitation.deleteMany({}),
      AuditEvent.deleteMany({})
    ]);
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  it("persists signup identity and stores only a hash of the refresh token", async () => {
    const account = await signUp("Persistence");
    const { response, payload } = await request("/auth/me", { token: account.data.accessToken });
    assert.equal(response.status, 200);
    assert.equal(payload.data.user.email, account.email);
    assert.equal(payload.data.tenant.id, account.data.tenant.id);
    assert.equal(payload.data.membership.role, "owner");

    const membershipCount = await Membership.countDocuments({ tenantId: account.data.tenant.id, userId: account.data.user.id });
    assert.equal(membershipCount, 1);
    const session = await RefreshSession.findOne({ userId: account.data.user.id, tenantId: account.data.tenant.id }).select("+tokenHash");
    assert.ok(session);
    assert.notEqual(session.tokenHash, tokenFromCookie(account.cookie));
    const user = await User.findById(account.data.user.id);
    assert.ok(user);
    assert.equal((user as unknown as { passwordHash?: string }).passwordHash, undefined);
    assert.equal(await AuditEvent.countDocuments({ tenantId: account.data.tenant.id, action: "identity.organization.created" }), 1);
  });

  it("rotates refresh tokens once and revokes active workspace sessions when a rotated token is replayed", async () => {
    const account = await signUp("Refresh");
    const first = await request("/auth/refresh", { method: "POST", cookie: account.cookie });
    assert.equal(first.response.status, 200);
    const replacementCookie = refreshCookie(first.response);
    assert.notEqual(replacementCookie, account.cookie);

    const replay = await request("/auth/refresh", { method: "POST", cookie: account.cookie });
    assert.equal(replay.response.status, 401);
    assert.equal(replay.payload.error?.code, "REFRESH_INVALID");

    const replacementAttempt = await request("/auth/refresh", { method: "POST", cookie: replacementCookie });
    assert.equal(replacementAttempt.response.status, 401);

    const sessions = await RefreshSession.find({ userId: account.data.user.id, tenantId: account.data.tenant.id });
    assert.ok(sessions.length >= 2);
    assert.ok(sessions.every(session => Boolean(session.revokedAt)), "refresh-token reuse must revoke every active session in the affected workspace");
    assert.equal(await AuditEvent.countDocuments({ tenantId: account.data.tenant.id, action: "identity.refresh_token.reuse_detected" }), 1);
  });

  it("rejects cross-tenant workspace switching and member access", async () => {
    const first = await signUp("Tenant Alpha");
    const second = await signUp("Tenant Beta");
    const foreignMembership = await Membership.findOne({ tenantId: second.data.tenant.id, userId: second.data.user.id });
    assert.ok(foreignMembership);

    const switchAttempt = await request("/auth/switch-workspace", {
      method: "POST",
      token: first.data.accessToken,
      body: { tenantId: second.data.tenant.id }
    });
    assert.equal(switchAttempt.response.status, 403);
    assert.equal(switchAttempt.payload.error?.code, "WORKSPACE_ACCESS_DENIED");

    const foreignMemberUpdate = await request("/workspace/members/" + String(foreignMembership._id) + "/role", {
      method: "PATCH",
      token: first.data.accessToken,
      body: { role: "viewer" }
    });
    assert.equal(foreignMemberUpdate.response.status, 404);
    assert.equal(foreignMemberUpdate.payload.error?.code, "MEMBERSHIP_NOT_FOUND");

    const ownMembers = await request("/workspace/members", { token: first.data.accessToken });
    assert.equal(ownMembers.response.status, 200);
    assert.equal(ownMembers.payload.data.length, 1);
    assert.equal(String(ownMembers.payload.data[0].tenantId), first.data.tenant.id);
  });

  it("accepts a one-time invitation, enforces viewer RBAC, and invalidates a suspended membership", async () => {
    const owner = await signUp("Invitation");
    const invitedEmail = "invitee-" + randomUUID() + "@example.test";
    const invitationResult = await request("/workspace/invitations", {
      method: "POST",
      token: owner.data.accessToken,
      body: { email: invitedEmail, role: "viewer" }
    });
    assert.equal(invitationResult.response.status, 201);
    const invitationToken = invitationResult.payload.data.invitationToken as string;

    const accepted = await request("/auth/accept-invitation", {
      method: "POST",
      body: { token: invitationToken, displayName: "Invited Viewer", password: "IntegrationTestPassword123" }
    });
    assert.equal(accepted.response.status, 201);
    assert.equal(accepted.payload.data.role, "viewer");
    const viewerToken = accepted.payload.data.accessToken as string;
    const viewerMembership = await Membership.findOne({ tenantId: owner.data.tenant.id, userId: accepted.payload.data.user.id });
    assert.ok(viewerMembership);
    assert.equal(viewerMembership.role, "viewer");

    const viewerCanReadMembers = await request("/workspace/members", { token: viewerToken });
    assert.equal(viewerCanReadMembers.response.status, 200);
    assert.equal(viewerCanReadMembers.payload.data.length, 2);

    const viewerCannotInvite = await request("/workspace/invitations", {
      method: "POST",
      token: viewerToken,
      body: { email: "blocked-" + randomUUID() + "@example.test", role: "viewer" }
    });
    assert.equal(viewerCannotInvite.response.status, 403);

    const suspended = await request("/workspace/members/" + String(viewerMembership._id) + "/status", {
      method: "PATCH",
      token: owner.data.accessToken,
      body: { status: "suspended" }
    });
    assert.equal(suspended.response.status, 200);
    const suspendedAccess = await request("/auth/me", { token: viewerToken });
    assert.equal(suspendedAccess.response.status, 401);
    assert.equal(suspendedAccess.payload.error?.code, "SESSION_INVALID");

    const replayedInvitation = await request("/auth/accept-invitation", {
      method: "POST",
      body: { token: invitationToken, displayName: "Invited Viewer", password: "IntegrationTestPassword123" }
    });
    assert.equal(replayedInvitation.response.status, 410);
  });
});
