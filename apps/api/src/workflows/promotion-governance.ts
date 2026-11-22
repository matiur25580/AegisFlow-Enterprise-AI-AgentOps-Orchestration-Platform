export interface AgentPromotionEvidence {
  agentId: string;
  agentVersion: number | null;
  suiteId: string | null;
  runId: string | null;
  score: number | null;
  gateStatus: "passed" | "blocked" | "missing";
  evaluatedAt: Date | null;
}
export interface WorkflowPromotionAssessment {
  eligible: boolean;
  evidence: AgentPromotionEvidence[];
  reasons: string[];
}

/** Every agent referenced by a workflow version needs a passing evaluation of its active version. */
export function assessWorkflowPromotion(
  requiredAgents: Array<{ agentId: string; activeVersion: number | null; status: string }>,
  evidence: AgentPromotionEvidence[]
): WorkflowPromotionAssessment {
  const byAgent = new Map(evidence.map(item => [item.agentId, item]));
  const reasons: string[] = [];
  const snapshot = requiredAgents.map(agent => {
    const item = byAgent.get(agent.agentId);
    if (agent.status !== "active" || agent.activeVersion === null) {
      reasons.push(`Agent ${agent.agentId} has no active version to promote.`);
      return { agentId: agent.agentId, agentVersion: agent.activeVersion, suiteId: null, runId: null, score: null, gateStatus: "missing" as const, evaluatedAt: null };
    }
    if (!item || item.agentVersion !== agent.activeVersion) {
      reasons.push(`Agent ${agent.agentId} has no evaluation for active version ${agent.activeVersion}.`);
      return { agentId: agent.agentId, agentVersion: agent.activeVersion, suiteId: null, runId: null, score: null, gateStatus: "missing" as const, evaluatedAt: null };
    }
    if (item.gateStatus !== "passed") reasons.push(`Agent ${agent.agentId} latest evaluation gate is blocked.`);
    return item;
  });
  return { eligible: reasons.length === 0, evidence: snapshot, reasons };
}
