import { Schema, model } from "mongoose";

const refreshSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null },
  replacedByHash: { type: String, default: null, select: false },
  reuseDetectedAt: { type: Date, default: null, select: false },
  userAgent: { type: String, maxlength: 500 },
  ipAddress: { type: String, maxlength: 64 }
}, { timestamps: true, versionKey: false });

export const RefreshSession = model("RefreshSession", refreshSessionSchema);
