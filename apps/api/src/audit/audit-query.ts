import { z } from "zod";

const objectId = /^[a-f\d]{24}$/i;
export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().min(1).max(120).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  actorUserId: z.string().regex(objectId).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((value, ctx) => {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["from"], message: "The from timestamp must be earlier than or equal to the to timestamp." });
  }
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function buildAuditFilter(tenantId: string, query: AuditQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = { tenantId };
  if (query.action) filter.action = query.action;
  if (query.resourceType) filter.resourceType = query.resourceType;
  if (query.actorUserId) filter.actorUserId = query.actorUserId;
  if (query.from || query.to) {
    const createdAt: Record<string, Date> = {};
    if (query.from) createdAt.$gte = new Date(query.from);
    if (query.to) createdAt.$lte = new Date(query.to);
    filter.createdAt = createdAt;
  }
  return filter;
}
