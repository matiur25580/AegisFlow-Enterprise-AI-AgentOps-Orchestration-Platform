import { Schema, model } from "mongoose";

const membershipSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  role: { type: String, enum: ["owner", "admin", "operator", "viewer"], required: true },
  status: { type: String, enum: ["active", "suspended", "invited"], default: "active", required: true }
}, { timestamps: true, versionKey: false });

membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
export const Membership = model("Membership", membershipSchema);
