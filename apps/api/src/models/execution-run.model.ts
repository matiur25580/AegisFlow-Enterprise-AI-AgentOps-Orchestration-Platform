import { Schema, model } from "mongoose";

const stepSchema = new Schema({
  nodeId: { type: String, required: true }, nodeType: { type: String, required: true },
  label: { type: String, required: true }, status: { type: String, enum: ["running", "waiting_approval", "succeeded", "failed"], required: true },
  attempt: { type: Number, min: 1, required: true }, startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null }, output: { type: Schema.Types.Mixed, default: null },
  error: { type: String, default: null }
}, { _id: false });

const runSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true, immutable: true },
  workflowVersion: { type: Number, required: true, immutable: true },
  graphHash: { type: String, required: true, immutable: true },
  nodes: { type: [Schema.Types.Mixed], required: true, immutable: true },
  edges: { type: [Schema.Types.Mixed], required: true, immutable: true },
  agentSnapshots: { type: [Schema.Types.Mixed], default: [], immutable: true },
  status: { type: String, enum: ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"], default: "queued", required: true },
  idempotencyKey: { type: String, required: true, immutable: true, maxlength: 128 },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  currentNodeId: { type: String, default: null }, steps: { type: [stepSchema], default: [] },
  attempt: { type: Number, default: 0, min: 0 }, maxAttempts: { type: Number, default: 3, min: 1, max: 10 },
  nextAttemptAt: { type: Date, default: Date.now }, leaseToken: { type: String, default: null },
  leaseExpiresAt: { type: Date, default: null }, cancelRequestedAt: { type: Date, default: null },
  lastError: { type: String, default: null }, retryOf: { type: Schema.Types.ObjectId, ref: "ExecutionRun", default: null },
  startedAt: { type: Date, default: null }, completedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

runSchema.index({ tenantId: 1, workflowId: 1, idempotencyKey: 1 }, { unique: true });
runSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
runSchema.index({ status: 1, leaseExpiresAt: 1 });
runSchema.index({ tenantId: 1, createdAt: -1 });

export const ExecutionRun = model("ExecutionRun", runSchema);
