import test from "node:test";
import assert from "node:assert/strict";
import { buildCostOverview, estimateUsageCost } from "./cost-intelligence.js";

const rates = [{ provider: "openai", model: "gpt-4.1", inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8 }];

test("estimates token costs from tenant-configured per-million rates", () => {
  const result = estimateUsageCost({ provider: "openai", model: "gpt-4.1", inputTokens: 1000, outputTokens: 500 }, rates);
  assert.equal(result.pricingConfigured, true);
  assert.equal(result.estimatedCostUsd, 0.006);
});

test("does not invent a cost when a model has no configured rate", () => {
  const result = estimateUsageCost({ provider: "google", model: "unknown", inputTokens: 100, outputTokens: 50 }, rates);
  assert.equal(result.estimatedCostUsd, null);
  assert.equal(result.pricingConfigured, false);
});

test("builds tenant usage totals and reports pricing coverage", () => {
  const from = new Date("2026-11-01T00:00:00.000Z");
  const to = new Date("2026-12-01T00:00:00.000Z");
  const result = buildCostOverview([
    { _id: "a", status: "succeeded", createdAt: "2026-11-10T00:00:00.000Z", steps: [
      { providerUsage: { provider: "openai", model: "gpt-4.1", inputTokens: 1000, outputTokens: 500 } },
      { providerUsage: { provider: "anthropic", model: "claude-x", inputTokens: 10, outputTokens: 20 } }
    ] }
  ], rates, from, to);
  assert.equal(result.inputTokens, 1010);
  assert.equal(result.outputTokens, 520);
  assert.equal(result.pricedSteps, 1);
  assert.equal(result.unpricedSteps, 1);
  assert.equal(result.pricingCoveragePercent, 50);
  assert.equal(result.estimatedCostUsd, 0.006);
});
