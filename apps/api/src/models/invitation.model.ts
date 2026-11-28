import { Schema, model } from "mongoose";

const invitationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  role: { type: String, enum: ["admin", "operator", "viewer"], required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  invitedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true, index: true },
  acceptedAt: { type: Date, default: null },
  acceptedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  revokedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

invitationSchema.index({ tenantId: 1, email: 1, createdAt: -1 });
invitationSchema.index({ tenantId: 1, acceptedAt: 1, revokedAt: 1, expiresAt: 1 });

export const Invitation = model("Invitation", invitationSchema);
