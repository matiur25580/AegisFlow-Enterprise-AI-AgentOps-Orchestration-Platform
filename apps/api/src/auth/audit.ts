import { AuditEvent } from "../models/audit-event.model.js";

interface AuditInput {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string;
  ipAddress?: string;
}

export async function writeAuditEvent(input: AuditInput): Promise<void> {
  await AuditEvent.create({
    ...input,
    actorUserId: input.actorUserId ?? null,
    resourceId: input.resourceId ?? null,
    metadata: input.metadata ?? {},
    requestId: input.requestId ?? null,
    ipAddress: input.ipAddress ?? null
  });
}
