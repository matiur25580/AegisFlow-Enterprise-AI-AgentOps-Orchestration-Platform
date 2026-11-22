export type SupportedProvider = "openai" | "anthropic" | "google";
export type AgentProviderConfig = {
  tenantId: string;
  provider: string;
  model: string;
  secretRef: string | null;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  responseFormat: "text" | "json";
};
export type ProviderUsage = { inputTokens: number | null; outputTokens: number | null };
export type ProviderResult = { text: string; provider: SupportedProvider; model: string; usage: ProviderUsage; durationMs: number };
export interface SecretResolver {
  resolve(input: { tenantId: string; secretRef: string; provider: SupportedProvider }): Promise<string>;
}
export class ProviderExecutionError extends Error {
  constructor(message: string, readonly code: string, readonly retryable = false) {
    super(message); this.name = "ProviderExecutionError";
  }
}
