import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedValue = { ciphertext: string; iv: string; authTag: string };
export function encryptWithKey(plaintext: string, key: Buffer, associatedData = ""): EncryptedValue {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}
export function decryptWithKey(value: EncryptedValue, key: Buffer, associatedData = ""): string {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
