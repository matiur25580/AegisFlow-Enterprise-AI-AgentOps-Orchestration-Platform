import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["active", "suspended"], default: "active", required: true }
}, { timestamps: true, versionKey: false });

export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);
