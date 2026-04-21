import type {
  AgentRuntimeReviewDecisionTemplate,
  AgentRuntimeSaveReviewDecisionRequest,
} from "@/lib/api/agentRuntime";

export type SceneAppQuickReviewActionTone =
  | "positive"
  | "neutral"
  | "warning"
  | "risk";

export interface SceneAppQuickReviewAction {
  key: "accepted" | "deferred" | "rejected" | "needs_more_evidence";
  label: string;
  helperText: string;
  tone: SceneAppQuickReviewActionTone;
}

export const SCENEAPP_QUICK_REVIEW_ACTIONS: SceneAppQuickReviewAction[] = [
  {
    key: "accepted",
    label: "可继续复用",
    helperText: "这轮结果可以继续沿当前基线放量。",
    tone: "positive",
  },
  {
    key: "deferred",
    label: "继续观察",
    helperText: "先保留这轮结果，再补一轮样本判断。",
    tone: "neutral",
  },
  {
    key: "needs_more_evidence",
    label: "补证据",
    helperText: "先补齐会话证据、校验材料或复核记录。",
    tone: "warning",
  },
  {
    key: "rejected",
    label: "先别继续",
    helperText: "当前结果不建议继续复用，先修主卡点。",
    tone: "risk",
  },
] as const;

export function buildSceneAppQuickReviewDecisionRequest(params: {
  template: AgentRuntimeReviewDecisionTemplate;
  action: SceneAppQuickReviewAction;
  sceneTitle?: string | null;
  failureSignal?: string | null;
  sourceLabel?: string;
}): AgentRuntimeSaveReviewDecisionRequest {
  const sceneLabel = params.sceneTitle?.trim()
    ? `做法「${params.sceneTitle.trim()}」`
    : "当前做法";
  const riskTags = params.failureSignal?.trim()
    ? [params.failureSignal.trim()]
    : [];
  const sourceLabel = params.sourceLabel?.trim() || "整套做法";

  switch (params.action.key) {
    case "accepted":
      return {
        session_id: params.template.session_id,
        decision_status: "accepted",
        decision_summary: `${sceneLabel} 这轮结果可继续复用。`,
        chosen_fix_strategy: "沿当前参考、风格与这轮结果基线继续放量。",
        risk_level: "low",
        risk_tags: riskTags,
        human_reviewer: params.template.decision.human_reviewer,
        reviewed_at: undefined,
        followup_actions: ["继续复用当前结果链，补下一轮发布样本。"],
        regression_requirements:
          params.template.decision.regression_requirements,
        notes: `来自${sourceLabel}轻量反馈入口。`,
      };
    case "deferred":
      return {
        session_id: params.template.session_id,
        decision_status: "deferred",
        decision_summary: `${sceneLabel} 先保留这轮结果，继续观察下一轮样本。`,
        chosen_fix_strategy: "补一轮样本后，再决定是否继续放量。",
        risk_level: "medium",
        risk_tags: riskTags,
        human_reviewer: params.template.decision.human_reviewer,
        reviewed_at: undefined,
        followup_actions: ["补下一轮样本，再回到做法复盘继续判断。"],
        regression_requirements:
          params.template.decision.regression_requirements,
        notes: `来自${sourceLabel}轻量反馈入口。`,
      };
    case "needs_more_evidence":
      return {
        session_id: params.template.session_id,
        decision_status: "needs_more_evidence",
        decision_summary: `${sceneLabel} 当前证据不足，先补齐关键材料再判断。`,
        chosen_fix_strategy: "先补齐会话证据、结果校验与人工复核材料。",
        risk_level: "medium",
        risk_tags: riskTags,
        human_reviewer: params.template.decision.human_reviewer,
        reviewed_at: undefined,
        followup_actions: ["补会话证据", "补结果校验材料", "补人工复核记录"],
        regression_requirements:
          params.template.decision.regression_requirements,
        notes: `来自${sourceLabel}轻量反馈入口。`,
      };
    case "rejected":
      return {
        session_id: params.template.session_id,
        decision_status: "rejected",
        decision_summary: `${sceneLabel} 当前结果暂不建议继续复用。`,
        chosen_fix_strategy: "先修主卡点，再重新启动这套做法。",
        risk_level: "high",
        risk_tags: riskTags,
        human_reviewer: params.template.decision.human_reviewer,
        reviewed_at: undefined,
        followup_actions: ["先修主要阻塞，再重新启动这套做法。"],
        regression_requirements:
          params.template.decision.regression_requirements,
        notes: `来自${sourceLabel}轻量反馈入口。`,
      };
    default:
      return {
        session_id: params.template.session_id,
        decision_status: "pending_review",
        decision_summary: "",
        chosen_fix_strategy: "",
        risk_level: "unknown",
        risk_tags: riskTags,
        human_reviewer: params.template.decision.human_reviewer,
        reviewed_at: undefined,
        followup_actions: [],
        regression_requirements:
          params.template.decision.regression_requirements,
        notes: `来自${sourceLabel}轻量反馈入口。`,
      };
  }
}
