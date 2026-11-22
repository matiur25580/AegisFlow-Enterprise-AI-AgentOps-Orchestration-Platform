import { Schema, model } from "mongoose";

const tenantSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: ["active", "suspended"], default: "active", required: true },
  plan: { type: String, enum: ["free", "growth", "enterprise"], default: "free", required: true }
}, { timestamps: true, versionKey: false });

export const Tenant = model("Tenant", tenantSchema);
