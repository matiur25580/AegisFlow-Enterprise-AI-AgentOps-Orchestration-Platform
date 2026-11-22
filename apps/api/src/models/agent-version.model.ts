import { Schema, model } from "mongoose";

const agentVersionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true, immutable: true },
  agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true, index: true, immutable: true },
  version: { type: Number, required: true, min: 1, immutable: true },
  changelog: { type: String, default: "", maxlength: 1000, immutable: true },
  systemPrompt: { type: String, required: true, maxlength: 30000, immutable: true },
  temperature: { type: Number, min: 0, max: 2, default: 0.2, immutable: true },
  maxOutputTokens: { type: Number, min: 1, max: 100000, default: 2048, immutable: true },
  timeoutMs: { type: Number, min: 1000, max: 300000, default: 30000, immutable: true },
  tools: { type: [String], default: [], immutable: true },
  responseFormat: { type: String, enum: ["text", "json"], default: "text", immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

agentVersionSchema.index({ tenantId: 1, agentId: 1, version: 1 }, { unique: true });
export const AgentVersion = model("AgentVersion", agentVersionSchema);
