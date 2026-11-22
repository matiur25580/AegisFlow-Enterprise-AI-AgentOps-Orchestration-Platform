import { Schema, model } from "mongoose";

const workflowSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 140 },
  description: { type: String, default: "", maxlength: 1000 },
  tags: { type: [String], default: [] },
  ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  status: { type: String, enum: ["draft", "published", "archived"], default: "draft", required: true },
  latestVersion: { type: Number, default: 1, min: 1 },
  activeVersion: { type: Number, default: null, min: 1 }
}, { timestamps: true, versionKey: false });

workflowSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
workflowSchema.index({ tenantId: 1, status: 1, updatedAt: -1 });
workflowSchema.index({ tenantId: 1, ownerUserId: 1 });

export const Workflow = model("Workflow", workflowSchema);
