import { Schema, model } from "mongoose";

const approvalSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  runId: { type: Schema.Types.ObjectId, ref: "ExecutionRun", required: true, immutable: true },
  workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true, immutable: true },
  workflowVersion: { type: Number, required: true, immutable: true },
  graphHash: { type: String, required: true, immutable: true },
  nodeId: { type: String, required: true, immutable: true, maxlength: 80 },
  nodeLabel: { type: String, required: true, immutable: true, maxlength: 120 },
  nextNodeId: { type: String, required: true, immutable: true, maxlength: 80 },
  title: { type: String, required: true, maxlength: 160 },
  description: { type: String, default: "", maxlength: 2000 },
  assigneeRole: { type: String, enum: ["owner", "admin", "operator", "viewer"], default: "operator", required: true, immutable: true },
  assigneeUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  status: { type: String, enum: ["pending", "approved", "rejected", "expired", "cancelled"], default: "pending", required: true },
  dueAt: { type: Date, required: true, immutable: true },
  decidedAt: { type: Date, default: null },
  decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  decisionComment: { type: String, default: "", maxlength: 2000 }
}, { timestamps: true, versionKey: false });

approvalSchema.index({ tenantId: 1, runId: 1, nodeId: 1 }, { unique: true });
approvalSchema.index({ tenantId: 1, status: 1, dueAt: 1, createdAt: -1 });
approvalSchema.index({ tenantId: 1, assigneeRole: 1, status: 1, createdAt: -1 });
approvalSchema.index({ tenantId: 1, assigneeUserId: 1, status: 1, createdAt: -1 });

export const Approval = model("Approval", approvalSchema);
