export type EvaluationMetric = "exact_match" | "contains";
export type EvaluationCaseInput = { caseId: string; expectedOutput: unknown; weight: number };
export type EvaluationSubmission = { caseId: string; actualOutput: unknown };

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function evaluateCases(
  cases: EvaluationCaseInput[],
  submissions: EvaluationSubmission[],
  metric: EvaluationMetric
) {
  const submitted = new Map(submissions.map(item => [item.caseId, item.actualOutput]));
  const results = cases.map(item => {
    const actualOutput = submitted.get(item.caseId);
    const present = submitted.has(item.caseId);
    const passed = present && (metric === "exact_match"
      ? stable(actualOutput) === stable(item.expectedOutput)
      : typeof actualOutput === "string" && typeof item.expectedOutput === "string" && actualOutput.includes(item.expectedOutput));
    return { caseId: item.caseId, passed, weight: item.weight, actualOutput: present ? actualOutput : null, expectedOutput: item.expectedOutput, score: passed ? 1 : 0 };
  });
  const totalWeight = cases.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = totalWeight ? results.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight : 0;
  return {
    totalCases: cases.length,
    passedCases: results.filter(item => item.passed).length,
    score: Number((weightedScore * 100).toFixed(2)),
    results
  };
}

export interface EvaluationGatePolicy {
  minScore: number;
  maxRegressionPoints: number;
}
export interface EvaluationGateResult {
  status: "passed" | "blocked";
  minScore: number;
  maxRegressionPoints: number;
  previousScore: number | null;
  regressionPoints: number | null;
  reasons: string[];
}

/** A failed gate blocks promotion, not evaluation execution. */
export function assessEvaluationGate(
  score: number,
  previousScore: number | null,
  policy: EvaluationGatePolicy
): EvaluationGateResult {
  const regressionPoints = previousScore === null ? null : Number(Math.max(0, previousScore - score).toFixed(2));
  const reasons: string[] = [];
  if (score < policy.minScore) reasons.push(`Score ${score.toFixed(2)} is below the required minimum of ${policy.minScore.toFixed(2)}.`);
  if (regressionPoints !== null && regressionPoints > policy.maxRegressionPoints) {
    reasons.push(`Score regressed by ${regressionPoints.toFixed(2)} points, exceeding the allowed ${policy.maxRegressionPoints.toFixed(2)}.`);
  }
  return {
    status: reasons.length ? "blocked" : "passed",
    minScore: policy.minScore,
    maxRegressionPoints: policy.maxRegressionPoints,
    previousScore,
    regressionPoints,
    reasons
  };
}
