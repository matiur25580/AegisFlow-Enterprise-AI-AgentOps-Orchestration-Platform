import test from "node:test";
import assert from "node:assert/strict";
import { auditQuerySchema, buildAuditFilter } from "./audit-query.js";

test("audit query applies bounded pagination defaults", () => {
  const parsed = auditQuerySchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 25);
});

test("audit query rejects oversized pages and malformed actor IDs", () => {
  assert.equal(auditQuerySchema.safeParse({ limit: "1000" }).success, false);
  assert.equal(auditQuerySchema.safeParse({ actorUserId: "not-an-object-id" }).success, false);
});

test("audit query rejects an inverted time range", () => {
  const result = auditQuerySchema.safeParse({
    from: "2026-02-02T00:00:00.000Z",
    to: "2026-02-01T00:00:00.000Z"
  });
  assert.equal(result.success, false);
});

test("audit filter always scopes to the active tenant and adds requested dimensions", () => {
  const query = auditQuerySchema.parse({
    page: "2", limit: "10", action: "run.queued", resourceType: "execution_run",
    actorUserId: "0123456789abcdef01234567", from: "2026-01-01T00:00:00.000Z"
  });
  const filter = buildAuditFilter("aaaaaaaaaaaaaaaaaaaaaaaa", query);
  assert.equal(filter.tenantId, "aaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(filter.action, "run.queued");
  assert.equal(filter.resourceType, "execution_run");
  assert.deepEqual(filter.createdAt, { $gte: new Date("2026-01-01T00:00:00.000Z") });
});
