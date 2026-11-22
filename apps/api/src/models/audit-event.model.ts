import { Schema, model } from "mongoose";

const auditEventSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  action: { type: String, required: true, maxlength: 120 },
  resourceType: { type: String, required: true, maxlength: 80 },
  resourceId: { type: String, default: null, maxlength: 120 },
  metadata: { type: Schema.Types.Mixed, default: {} },
  requestId: { type: String, default: null, maxlength: 80 },
  ipAddress: { type: String, default: null, maxlength: 64 }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

auditEventSchema.index({ tenantId: 1, createdAt: -1 });
export const AuditEvent = model("AuditEvent", auditEventSchema);
