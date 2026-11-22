import { Schema, model } from "mongoose";

const workflowNodeSchema = new Schema({
  id: { type: String, required: true, maxlength: 80, immutable: true },
  type: { type: String, required: true, enum: ["start", "agent", "condition", "approval", "end"], immutable: true },
  label: { type: String, required: true, maxlength: 120, immutable: true },
  position: {
    x: { type: Number, required: true, immutable: true },
    y: { type: Number, required: true, immutable: true }
  },
  config: { type: Schema.Types.Mixed, default: {}, immutable: true }
}, { _id: false });

const workflowEdgeSchema = new Schema({
  id: { type: String, required: true, maxlength: 80, immutable: true },
  source: { type: String, required: true, maxlength: 80, immutable: true },
  target: { type: String, required: true, maxlength: 80, immutable: true },
  label: { type: String, default: "", maxlength: 120, immutable: true }
}, { _id: false });

const workflowVersionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true, immutable: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  changelog: { type: String, default: "", maxlength: 1000, immutable: true },
  nodes: { type: [workflowNodeSchema], required: true, immutable: true },
  edges: { type: [workflowEdgeSchema], required: true, immutable: true },
  graphHash: { type: String, required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

workflowVersionSchema.index({ tenantId: 1, workflowId: 1, version: 1 }, { unique: true });
workflowVersionSchema.index({ tenantId: 1, workflowId: 1, createdAt: -1 });

export const WorkflowVersion = model("WorkflowVersion", workflowVersionSchema);
