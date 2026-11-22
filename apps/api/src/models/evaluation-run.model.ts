import { Schema, model } from "mongoose";

const evaluationResultSchema = new Schema({
  caseId: { type: String, required: true },
  passed: { type: Boolean, required: true },
  weight: { type: Number, required: true },
  actualOutput: { type: Schema.Types.Mixed, default: null },
  expectedOutput: { type: Schema.Types.Mixed, default: null },
  score: { type: Number, min: 0, max: 1, required: true }
}, { _id: false });

const evaluationGateSchema = new Schema({
  status: { type: String, enum: ["passed", "blocked"], required: true },
  minScore: { type: Number, min: 0, max: 100, required: true },
  maxRegressionPoints: { type: Number, min: 0, max: 100, required: true },
  previousScore: { type: Number, min: 0, max: 100, default: null },
  regressionPoints: { type: Number, min: 0, max: 100, default: null },
  reasons: { type: [{ type: String, maxlength: 300 }], default: [] }
}, { _id: false });

const evaluationRunSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  suiteId: { type: Schema.Types.ObjectId, ref: "EvaluationSuite", required: true, immutable: true },
  suiteName: { type: String, required: true, immutable: true },
  metric: { type: String, enum: ["exact_match", "contains"], required: true, immutable: true },
  agentId: { type: Schema.Types.ObjectId, ref: "Agent", default: null, immutable: true },
  agentVersion: { type: Number, default: null, immutable: true },
  submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  totalCases: { type: Number, required: true },
  passedCases: { type: Number, required: true },
  score: { type: Number, min: 0, max: 100, required: true },
  gate: { type: evaluationGateSchema, required: true },
  results: { type: [evaluationResultSchema], default: [] }
}, { timestamps: true, versionKey: false });

evaluationRunSchema.index({ tenantId: 1, suiteId: 1, createdAt: -1 });
evaluationRunSchema.index({ tenantId: 1, createdAt: -1 });

export const EvaluationRun = model("EvaluationRun", evaluationRunSchema);
