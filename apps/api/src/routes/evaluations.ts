import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate.js";
import { requirePermission } from "../middleware/authorize.js";
import { asyncHandler } from "../utils/async-handler.js";
import { Agent } from "../models/agent.model.js";
import { EvaluationSuite } from "../models/evaluation-suite.model.js";
import { EvaluationRun } from "../models/evaluation-run.model.js";
import { assessEvaluationGate, evaluateCases } from "../evaluation/evaluator.js";
import { writeAuditEvent } from "../auth/audit.js";
import type { AuthContext } from "../auth/types.js";

export const evaluationsRouter = Router();
evaluationsRouter.use(authenticate);

const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const caseSchema = z.object({
  caseId: z.string().trim().min(1).max(80).regex(/^[\w.-]+$/),
  name: z.string().trim().min(1).max(160),
  input: z.unknown().refine(value => value !== undefined, "Input is required."),
  expectedOutput: z.unknown().refine(value => value !== undefined, "Expected output is required."),
  weight: z.number().min(0.01).max(100).default(1)
});
const createSuiteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(1000).default(""),
  agentId: idSchema.nullable().optional(),
  metric: z.enum(["exact_match", "contains"]).default("exact_match"),
  releaseGate: z.object({
    minScore: z.number().min(0).max(100).default(80),
    maxRegressionPoints: z.number().min(0).max(100).default(10)
  }).strict().default({ minScore: 80, maxRegressionPoints: 10 }),
  cases: z.array(caseSchema).min(1).max(200)
}).superRefine((value, ctx) => {
  const ids = value.cases.map(item => item.caseId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cases"], message: "Case IDs must be unique within a suite." });
});
const submissionSchema = z.object({
  results: z.array(z.object({ caseId: z.string().min(1).max(80), actualOutput: z.unknown().refine(value => value !== undefined, "Actual output is required.") })).max(200)
}).superRefine((value, ctx) => {
  const ids = value.results.map(item => item.caseId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["results"], message: "Each case may be submitted only once." });
});

async function audit(auth: AuthContext, action: string, resourceId: string, metadata: Record<string, unknown> = {}) {
  await writeAuditEvent({ tenantId: auth.tenantId, actorUserId: auth.userId, action, resourceType: "evaluation", resourceId, metadata });
}

evaluationsRouter.get("/suites", requirePermission("evaluations:read"), asyncHandler(async (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const suites = await EvaluationSuite.find({ tenantId: auth.tenantId }).select("-cases").sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ data: suites });
}));

evaluationsRouter.post("/suites", requirePermission("evaluations:write"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const input = createSuiteSchema.parse(req.body);
  let agent: { _id: unknown; activeVersion?: number | null } | null = null;
  if (input.agentId) {
    agent = await Agent.findOne({ _id: input.agentId, tenantId: auth.tenantId, status: "active", activeVersion: { $ne: null } }).select("_id activeVersion").lean();
    if (!agent) { res.status(409).json({ error: { code: "AGENT_NOT_EVALUABLE", message: "Select an active agent with an active version from this workspace." } }); return; }
  }
  const suite = await EvaluationSuite.create({
    tenantId: auth.tenantId, name: input.name, description: input.description,
    agentId: agent?._id ?? null, agentVersion: agent?.activeVersion ?? null,
    metric: input.metric, releaseGate: input.releaseGate, cases: input.cases, createdBy: auth.userId
  });
  await audit(auth, "evaluation.suite.created", String(suite._id), { caseCount: suite.cases.length, agentVersion: suite.agentVersion });
  res.status(201).json({ data: suite });
}));

evaluationsRouter.get("/suites/:suiteId", requirePermission("evaluations:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const suiteId = idSchema.parse(req.params.suiteId);
  const suite = await EvaluationSuite.findOne({ _id: suiteId, tenantId: auth.tenantId }).lean();
  if (!suite) { res.status(404).json({ error: { code: "EVALUATION_SUITE_NOT_FOUND", message: "Evaluation suite not found." } }); return; }
  const runs = await EvaluationRun.find({ tenantId: auth.tenantId, suiteId }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ data: { suite, runs } });
}));

evaluationsRouter.post("/suites/:suiteId/runs", requirePermission("evaluations:run"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const suiteId = idSchema.parse(req.params.suiteId);
  const input = submissionSchema.parse(req.body);
  const suite = await EvaluationSuite.findOne({ _id: suiteId, tenantId: auth.tenantId }).lean();
  if (!suite) { res.status(404).json({ error: { code: "EVALUATION_SUITE_NOT_FOUND", message: "Evaluation suite not found." } }); return; }
  const knownIds = new Set(suite.cases.map(item => item.caseId));
  const unknown = input.results.find(item => !knownIds.has(item.caseId));
  if (unknown) { res.status(400).json({ error: { code: "UNKNOWN_EVALUATION_CASE", message: "A submitted case ID does not belong to this suite." } }); return; }
  const scored = evaluateCases(suite.cases, input.results, suite.metric);
  const previousRun = await EvaluationRun.findOne({ tenantId: auth.tenantId, suiteId })
    .sort({ createdAt: -1, _id: -1 }).select("score").lean();
  const gatePolicy = suite.releaseGate ?? { minScore: 80, maxRegressionPoints: 10 };
  const gate = assessEvaluationGate(scored.score, previousRun?.score ?? null, gatePolicy);
  const run = await EvaluationRun.create({
    tenantId: auth.tenantId, suiteId, suiteName: suite.name, metric: suite.metric,
    agentId: suite.agentId, agentVersion: suite.agentVersion, submittedBy: auth.userId,
    ...scored, gate
  });
  await audit(auth, "evaluation.run.completed", String(run._id), {
    suiteId, score: run.score, passedCases: run.passedCases, totalCases: run.totalCases,
    agentVersion: run.agentVersion, releaseGateStatus: gate.status,
    regressionPoints: gate.regressionPoints
  });
  res.status(201).json({ data: run });
}));

evaluationsRouter.get("/runs", requirePermission("evaluations:read"), asyncHandler(async (req, res) => {
  const auth = res.locals.auth as AuthContext;
  const filter: Record<string, unknown> = { tenantId: auth.tenantId };
  if (typeof req.query.suiteId === "string") filter.suiteId = idSchema.parse(req.query.suiteId);
  const runs = await EvaluationRun.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ data: runs });
}));
