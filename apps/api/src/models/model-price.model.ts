import { Schema, model } from "mongoose";

const modelPriceSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  provider: { type: String, enum: ["openai", "anthropic", "google"], required: true, immutable: true },
  model: { type: String, required: true, trim: true, lowercase: true, maxlength: 120, immutable: true },
  inputUsdPerMillionTokens: { type: Number, required: true, min: 0 },
  outputUsdPerMillionTokens: { type: Number, required: true, min: 0 },
  effectiveFrom: { type: Date, required: true },
  source: { type: String, trim: true, maxlength: 300, default: "tenant-configured" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true, versionKey: false });

modelPriceSchema.index({ tenantId: 1, provider: 1, model: 1 }, { unique: true });
modelPriceSchema.index({ tenantId: 1, effectiveFrom: -1 });

export const ModelPrice = model("ModelPrice", modelPriceSchema);
