import { performance } from "node:perf_hooks";
import { ProviderExecutionError, type AgentProviderConfig, type ProviderResult, type SecretResolver, type SupportedProvider } from "./types.js";

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;
const endpoints: Record<SupportedProvider, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  google: "https://generativelanguage.googleapis.com/v1beta/models"
};
function record(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function usageNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function parseJson(value: string): JsonRecord { try { return record(JSON.parse(value)); } catch { return {}; } }

export class AgentProviderExecutor {
  constructor(private readonly secrets: SecretResolver, private readonly fetcher: FetchLike = fetch) {}

  async execute(config: AgentProviderConfig, input: unknown): Promise<ProviderResult> {
    if (!config.secretRef) throw new ProviderExecutionError("Agent has no configured secret reference.", "PROVIDER_SECRET_REF_MISSING");
    if (config.provider !== "openai" && config.provider !== "anthropic" && config.provider !== "google") {
      throw new ProviderExecutionError("This provider is not supported by the current HTTP adapter.", "PROVIDER_UNSUPPORTED");
    }
    const provider = config.provider as SupportedProvider;
    let apiKey: string;
    try {
      apiKey = await this.secrets.resolve({ tenantId: config.tenantId, secretRef: config.secretRef, provider });
    } catch {
      throw new ProviderExecutionError("Provider credentials could not be resolved.", "PROVIDER_SECRET_UNAVAILABLE");
    }
    if (!apiKey || apiKey.trim().length < 8) throw new ProviderExecutionError("Provider credentials could not be resolved.", "PROVIDER_SECRET_UNAVAILABLE");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(300_000, Math.max(1_000, config.timeoutMs)));
    const started = performance.now();
    try {
      const body = JSON.stringify(input) ?? "null";
      const request = this.buildRequest(provider, config, apiKey, body);
      const response = await this.fetcher(request.url, { method: "POST", headers: request.headers, body: request.body, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new ProviderExecutionError(
          response.status === 401 || response.status === 403 ? "Provider rejected the configured credentials." : "Provider request failed.",
          response.status === 429 ? "PROVIDER_RATE_LIMITED" : response.status >= 500 ? "PROVIDER_UPSTREAM_ERROR" : "PROVIDER_REQUEST_REJECTED",
          retryable
        );
      }
      const parsed = record(payload);
      const result = this.parseResponse(provider, parsed);
      if (!result.output) throw new ProviderExecutionError("Provider returned no text output.", "PROVIDER_EMPTY_RESPONSE", true);
      return { text: result.output, provider, model: config.model, usage: result.usage, durationMs: Math.max(0, Math.round(performance.now() - started)) };
    } catch (error) {
      if (error instanceof ProviderExecutionError) throw error;
      if (controller.signal.aborted) throw new ProviderExecutionError("Provider request timed out.", "PROVIDER_TIMEOUT", true);
      throw new ProviderExecutionError("Provider request could not be completed.", "PROVIDER_NETWORK_ERROR", true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequest(provider: SupportedProvider, config: AgentProviderConfig, apiKey: string, input: string) {
    if (provider === "openai") return {
      url: endpoints.openai,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: config.systemPrompt }, { role: "user", content: input }], temperature: config.temperature, max_tokens: config.maxOutputTokens, ...(config.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}) })
    };
    if (provider === "anthropic") return {
      url: endpoints.anthropic,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, system: config.systemPrompt, messages: [{ role: "user", content: input }], temperature: config.temperature, max_tokens: config.maxOutputTokens })
    };
    const url = new URL(`${endpoints.google}/${encodeURIComponent(config.model)}:generateContent`);
    url.searchParams.set("key", apiKey);
    return {
      url: url.toString(),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: config.systemPrompt }] }, contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { temperature: config.temperature, maxOutputTokens: config.maxOutputTokens, ...(config.responseFormat === "json" ? { responseMimeType: "application/json" } : {}) } })
    };
  }

  private parseResponse(provider: SupportedProvider, payload: JsonRecord): { output: string; usage: ProviderResult["usage"] } {
    if (provider === "openai") {
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const message = record(record(choices[0]).message);
      const usage = record(payload.usage);
      return { output: text(message.content), usage: { inputTokens: usageNumber(usage.prompt_tokens), outputTokens: usageNumber(usage.completion_tokens) } };
    }
    if (provider === "anthropic") {
      const blocks = Array.isArray(payload.content) ? payload.content : [];
      const output = blocks.map(block => text(record(block).text)).filter(Boolean).join("\n");
      const usage = record(payload.usage);
      return { output, usage: { inputTokens: usageNumber(usage.input_tokens), outputTokens: usageNumber(usage.output_tokens) } };
    }
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const content = record(record(candidates[0]).content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const output = parts.map(part => text(record(part).text)).filter(Boolean).join("\n");
    const usage = record(payload.usageMetadata);
    return { output, usage: { inputTokens: usageNumber(usage.promptTokenCount), outputTokens: usageNumber(usage.candidatesTokenCount) } };
  }
}
