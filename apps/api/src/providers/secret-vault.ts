import { env } from "../config/env.js";
import { Secret } from "../models/secret.model.js";
import { ProviderExecutionError, type SecretResolver, type SupportedProvider } from "./types.js";
import { decryptWithKey, encryptWithKey, type EncryptedValue } from "./secret-crypto.js";

function encryptionKey(): Buffer {
  const value = env.SECRETS_ENCRYPTION_KEY;
  if (!value || !/^[a-f\d]{64}$/i.test(value)) {
    throw new ProviderExecutionError("The application secrets vault is not configured.", "SECRET_VAULT_NOT_CONFIGURED");
  }
  return Buffer.from(value, "hex");
}
export function encryptSecret(plaintext: string, context: { tenantId: string; ref: string; provider: SupportedProvider }): EncryptedValue {
  try { return encryptWithKey(plaintext, encryptionKey(), `${context.tenantId}:${context.ref}:${context.provider}`); }
  catch (error) {
    if (error instanceof ProviderExecutionError) throw error;
    throw new ProviderExecutionError("Provider credentials could not be encrypted.", "SECRET_ENCRYPTION_FAILED");
  }
}
function decryptSecret(value: EncryptedValue, context: { tenantId: string; ref: string; provider: SupportedProvider }): string {
  try { return decryptWithKey(value, encryptionKey(), `${context.tenantId}:${context.ref}:${context.provider}`); }
  catch {
    throw new ProviderExecutionError("Stored provider credentials could not be decrypted.", "SECRET_DECRYPTION_FAILED");
  }
}
export class MongoSecretResolver implements SecretResolver {
  async resolve(input: { tenantId: string; secretRef: string; provider: SupportedProvider }): Promise<string> {
    const secret = await Secret.findOne({ tenantId: input.tenantId, ref: input.secretRef, provider: input.provider })
      .select("+ciphertext +iv +authTag").lean();
    if (!secret) throw new ProviderExecutionError("Provider credentials were not found for this tenant.", "PROVIDER_SECRET_UNAVAILABLE");
    return decryptSecret(secret, { tenantId: input.tenantId, ref: input.secretRef, provider: input.provider });
  }
}
