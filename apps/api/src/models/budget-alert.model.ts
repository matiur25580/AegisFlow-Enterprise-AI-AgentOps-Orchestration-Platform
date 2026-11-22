import { Schema, model } from "mongoose";

const budgetAlertSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  policyId: { type: Schema.Types.ObjectId, ref: "BudgetPolicy", required: true, immutable: true },
  scopeType: { type: String, enum: ["tenant", "agent", "model"], required: true, immutable: true },
  scopeValue: { type: String, required: true, immutable: true },
  periodStart: { type: Date, required: true, immutable: true },
  eventType: { type: String, enum: ["warning", "exceeded"], required: true, immutable: true },
  dedupeKey: { type: String, required: true, immutable: true },
  thresholdPercent: { type: Number, required: true },
  observedSpendUsd: { type: Number, required: true },
  monthlyLimitUsd: { type: Number, required: true },
  utilizationPercent: { type: Number, required: true },
  readAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

budgetAlertSchema.index({ tenantId:  1, dedupeKey: 1 }, { unique: true });
budgetAlertSchema.index({ tenantId: 1, createdAt: -1 });
budgetAlertSchema.index({ tenantId: 1, readAt: 1, createdAt: -1 });

export const BudgetAlert = model("BudgetAlert", budgetAlertSchema);
