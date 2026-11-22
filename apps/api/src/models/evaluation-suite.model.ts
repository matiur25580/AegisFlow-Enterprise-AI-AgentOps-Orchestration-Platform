import { Schema, model } from "mongoose";

const evaluationCaseSchema = new Schema({
  caseId: { type: String, required: true, maxlength: 80 },
  name: { type: String, required: true, maxlength: 160 },
  input: { type: Schema.Types.Mixed, required: true },
  expectedOutput: { type: Schema.Types.Mixed, required: true },
  weight: { type: Number, min: 0.01, max: 100, default: 1 }
}, { _id: false });

const releaseGateSchema = new Schema({
  minScore: { type: Number, min: 0, max: 100, default: 80, required: true },
  maxRegressionPoints: { type: Number, min: 0, max: 100, default: 10, required: true }
}, { _id: false });

const evaluationSuiteSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 1000 },
  agentId: { type: Schema.Types.ObjectId, ref: "Agent", default: null, immutable: true },
  agentVersion: { type: Number, default: null, immutable: true },
  metric: { type: String, enum: ["exact_match", "contains"], default: "exact_match", required: true, immutable: true },
  releaseGate: { type: releaseGateSchema, default: () => ({ minScore: 80, maxRegressionPoints: 10 }) },
  cases: { type: [evaluationCaseSchema], default: [] },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true }
}, { timestamps: true, versionKey: false });

evaluationSuiteSchema.index({ tenantId: 1, updatedAt: -1 });
evaluationSuiteSchema.index({ tenantId: 1, agentId: 1, createdAt: -1 });

export const EvaluationSuite = model("EvaluationSuite", evaluationSuiteSchema);
