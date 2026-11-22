import { Schema, model } from "mongoose";

const agentEvidenceSchema = new Schema({
  agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true, immutable: true },
  agentVersion: { type: Number, required: true, immutable: true },
  suiteId: { type: Schema.Types.ObjectId, ref: "EvaluationSuite", required: true, immutable: true },
  runId: { type: Schema.Types.ObjectId, ref: "EvaluationRun", required: true, immutable: true },
  score: { type: Number, min: 0, max: 100, required: true, immutable: true },
  gateStatus: { type: String, enum: ["passed"], required: true, immutable: true },
  evaluatedAt: { type: Date, required: true, immutable: true }
}, { _id: false });

const workflowPromotionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true, immutable: true },
  workflowVersion: { type: Number, required: true, immutable: true },
  graphHash: { type: String, required: true, immutable: true },
  promotedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  promotedAt: { type: Date, required: true, immutable: true },
  agentEvidence: { type: [agentEvidenceSchema], default: [], immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

workflowPromotionSchema.index({ tenantId: 1, workflowId: 1, promotedAt: -1 });
workflowPromotionSchema.index({ tenantId: 1, graphHash: 1 });

export const WorkflowPromotion = model("WorkflowPromotion", workflowPromotionSchema);
