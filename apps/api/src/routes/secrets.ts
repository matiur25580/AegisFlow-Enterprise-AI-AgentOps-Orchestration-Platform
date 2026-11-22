import { Router } from "express";
import { z } from "zod";
import { Secret } from "../models/secret.model.js";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";
import { encryptSecret } from "../providers/secret-vault.js";

export const secretsRouter = Router();
secretsRouter.use(authenticate);
const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  provider: z.enum(["openai", "anthropic", "google"]),
  apiKey: z.string().trim().min(8).max(4096)
});

secretsRouter.get("/", requirePermission("secrets:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const items = await Secret.find({ tenantId: auth.tenantId }).select("ref name provider createdAt updatedAt").sort({ updatedAt: -1 }).lean();
  res.json({ data: items });
}));

secretsRouter.post("/", requirePermission("secrets:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = createSchema.parse(req.body);
  const ref = `aegisflow:${input.slug}`;
  const encrypted = encryptSecret(input.apiKey);
  const secret = await Secret.findOneAndUpdate(
    { tenantId: auth.tenantId, ref },
    { $set: { name: input.name, provider: input.provider, ...encrypted, updatedBy: auth.userId },
      $setOnInsert: { tenantId: auth.tenantId, ref, createdBy: auth.userId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).select("ref name provider createdAt updatedAt").lean();
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "secret.upserted", resourceType: "secret", resourceId: ref, metadata: { provider: input.provider } });
  res.status(201).json({ data: secret });
}));

secretsRouter.delete("/:slug", requirePermission("secrets:manage"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).parse(req.params.slug);
  const ref = `aegisflow:${slug}`;
  const deleted = await Secret.findOneAndDelete({ tenantId: auth.tenantId, ref }).select("ref provider").lean();
  if (!deleted) { res.status(404).json({ error: { code: "SECRET_NOT_FOUND", message: "Secret reference not found." } }); return; }
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action: "secret.deleted", resourceType: "secret", resourceId: ref, metadata: { provider: deleted.provider } });
  res.status(204).send();
}));
