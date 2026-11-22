import { Schema, model } from "mongoose";

const budgetPolicySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  scopeType: { type: String, enum: ["tenant", "agent", "model"], required: true, immutable: true },
  scopeValue: { type: String, required: true, trim: true, maxlength: 160, immutable: true },
  monthlyLimitUsd: { type: Number, required: true, min: 0.01, max: 100_000_000 },
  warningThresholdPercent: { type: Number, required: true, min: 1, max: 99, default: 80 },
  enforcement: { type: String, enum: ["soft", "hard"], required: true, default: "soft" },
  enabled: { type: Boolean, default: true, required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true, versionKey: false });

budgetPolicySchema.index({ tenantId: 1, scopeType: 1, scopeValue: 1 }, { unique: true });
budgetPolicySchema.index({ tenantId: 1, enabled: 1 });

export const BudgetPolicy = model("BudgetPolicy", budgetPolicySchema);
