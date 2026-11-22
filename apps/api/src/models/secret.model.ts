import { Schema, model } from "mongoose";

const secretSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  ref: { type: String, required: true, immutable: true, maxlength: 120 },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  provider: { type: String, enum: ["openai", "anthropic", "google"], required: true, immutable: true },
  ciphertext: { type: String, required: true, select: false },
  iv: { type: String, required: true, select: false },
  authTag: { type: String, required: true, select: false },
  keyVersion: { type: Number, required: true, default: 1, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true, versionKey: false });

secretSchema.index({ tenantId: 1, ref: 1 }, { unique: true });
secretSchema.index({ tenantId: 1, provider: 1, updatedAt: -1 });
export const Secret = model("Secret", secretSchema);
