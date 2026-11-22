import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { Secret } from "../models/secret.model.js";
import { ProviderExecutionError, type SecretResolver, type SupportedProvider } from "./types.js";

function encryptionKey(): Buffer {
  const value = env.SECRETS_ENCRYPTION_KEY;
  if (!value || !/^[a-f\d]{64}$/i.test(value)) {
    throw new ProviderExecutionError("The application secrets vault is not configured.", "SECRET_VAULT_NOT_CONFIGURED");
  }
  return Buffer.from(value, "hex");
}
export function encryptSecret(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}
function decryptSecret(value: { ciphertext: string; iv: string; authTag: string }): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new ProviderExecutionError("Stored provider credentials could not be decrypted.", "SECRET_DECRYPTION_FAILED");
  }
}
export class MongoSecretResolver implements SecretResolver {
  async resolve(input: { tenantId: string; secretRef: string; provider: SupportedProvider }): Promise<string> {
    const secret = await Secret.findOne({ tenantId: input.tenantId, ref: input.secretRef, provider: input.provider })
      .select("+ciphertext +iv +authTag").lean();
    if (!secret) throw new ProviderExecutionError("Provider credentials were not found for this tenant.", "PROVIDER_SECRET_UNAVAILABLE");
    return decryptSecret(secret);
  }
}
