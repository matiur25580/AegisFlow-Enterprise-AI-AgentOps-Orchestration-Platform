import { Schema, model } from "mongoose";

const agentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 140 },
  description: { type: String, default: "", maxlength: 1000 },
  ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  team: { type: String, default: "platform", trim: true, maxlength: 80 },
  tags: { type: [String], default: [] },
  provider: { type: String, required: true, enum: ["openai", "anthropic", "google", "azure-openai", "bedrock", "custom"] },
  model: { type: String, required: true, trim: true, maxlength: 120 },
  secretRef: { type: String, default: null, maxlength: 200 },
  status: { type: String, enum: ["draft", "active", "deprecated", "archived"], default: "draft", required: true },
  latestVersion: { type: Number, default: 1, min: 1 },
  activeVersion: { type: Number, default: null, min: 1 }
}, { timestamps: true, versionKey: false });

agentSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
agentSchema.index({ tenantId: 1, status: 1, updatedAt: -1 });
agentSchema.index({ tenantId: 1, ownerUserId: 1 });

export const Agent = model("Agent", agentSchema);
