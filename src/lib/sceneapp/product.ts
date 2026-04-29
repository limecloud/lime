import type {
  SceneAppDeliveryArtifactRef,
  SceneAppBrowserRuntimeRef,
  SceneAppServiceSceneRuntimeRef,
  SceneAppDescriptor,
  SceneAppPlanResult,
  SceneAppDeliveryContract,
  SceneAppGovernanceArtifactKind,
  SceneAppGovernanceArtifactRef,
  SceneAppNativeSkillRuntimeRef,
  SceneAppRunSummary,
  SceneAppScorecard,
} from "./types";
import type { SceneAppEntryCardItem, SceneAppSeed } from "./presentation";
import {
  collectSceneAppInfraPresentationLabels,
  getSceneAppDeliveryContractLabel,
  getSceneAppInfraSummary,
  getSceneAppPatternLabel,
  getSceneAppPatternSummary,
  getSceneAppPresentationCopy,
  getSceneAppRunInsight,
  getSceneAppRunSourceLabel,
  getSceneAppRunStatusLabel,
  getSceneAppScorecardActionLabel,
  getSceneAppTypeLabel,
  resolveSceneAppTypePresentation,
  getSceneAppViewerKindLabel,
} from "./presentation";

// compat binding family 应在 API / 目录归一化层收口；产品层只展示 current 名称。
const BINDING_FAMILY_LABELS: Record<string, string> = {
  agent_turn: "Agent 工作区",
  native_skill: "本机技能",
  browser_assist: "浏览器上下文",
  automation_job: "自动化调度",
};

const DELIVERY_PART_LABELS: Record<string, string> = {
  brief: "任务简报",
  storyboard: "分镜 / 线框图",
  script: "剧本",
  music_refs: "配乐建议",
  video_draft: "短视频草稿",
  review_note: "复核意见",
  "index.md": "说明文档",
  "meta.json": "元信息",
  "storyboard.json": "分镜数据",
  "timeline.json": "时间线记录",
  "audio.mp3": "音频结果",
  "media.json": "媒体结果",
  "form.json": "表单结果",
};

const GOVERNANCE_ARTIFACT_LABELS: Record<string, string> = {
  evidence_summary: "证据摘要",
  review_decision_markdown: "人工复核记录",
  review_decision_json: "复核 JSON",
};

const SCORECARD_SIGNAL_LABELS: Record<string, string> = {
  success_rate: "执行成功率",
  run_success_rate: "执行成功率",
  reuse_rate: "复用率",
  repeat_use_rate: "复用率",
  complete_pack_rate: "整包交付率",
  review_pass_rate: "复核通过率",
  publish_conversion_rate: "发布转化率",
  cost_per_accepted_pack: "单位接受成本",
  delivery_readiness: "交付就绪度",
  reuse_potential: "复用潜力",
  artifact_output_rate: "结果产出率",
  sample_coverage: "运行样本充足度",
  pack_incomplete: "整包不完整",
  review_blocked: "复核阻塞",
  publish_stalled: "发布卡点",
  automation_timeout: "自动化超时",
  dependency_failure: "外部依赖与会话稳定性",
  adoption_failure: "补参与人工中断",
  runtime_failure: "运行链稳定性",
  artifact_validation_issue: "结果结构校验问题",
  telemetry_missing: "请求遥测缺失",
  runtime_evidence_gap: "会话证据缺口",
  verification_failure: "结果校验失败",
  publish_ready: "可继续发布",
  review_decision_accepted: "人工接受",
  review_decision_deferred: "人工延后",
  review_decision_rejected: "人工否决",
  review_decision_needs_more_evidence: "人工补证据",
  review_decision_pending_review: "待人工审核",
  review_risk_low: "人工低风险",
  review_risk_medium: "人工中风险",
  review_risk_high: "人工高风险",
};

const CONTEXT_LAYER_LABELS: Record<string, string> = {
  skill: "Skill",
  memory: "Memory",
  taste: "Taste",
  tool: "Tool",
  reference: "Reference",
};

const CONTEXT_SOURCE_KIND_LABELS: Record<string, string> = {
  user_input: "用户输入",
  slot: "启动参数",
  project: "项目上下文",
  workspace: "工作区上下文",
  memory_profile: "记忆画像",
  reference_library: "参考库",
  tool_readiness: "工具就绪",
};

const CONTEXT_CONTENT_TYPE_LABELS: Record<string, string> = {
  text: "文本",
  url: "链接",
  slot: "参数",
  image: "图片",
  video: "视频",
  audio: "音频",
  markdown: "Markdown",
  json: "JSON",
};

const PROJECT_PACK_COMPLETION_LABELS: Record<string, string> = {
  required_parts_complete: "按必含部件判断整包完成度",
  workspace_artifact_writeback: "按工作区结果回写判断交付",
  artifact_writeback: "按结果文件回流判断交付",
};

export interface SceneAppWorkbenchStatItem {
  key: string;
  label: string;
  value: number;
  description: string;
}

export interface SceneAppCatalogCardViewModel {
  id: string;
  title: string;
  businessLabel: string;
  typeLabel: string;
  deliveryContractLabel: string;
  valueStatement: string;
  summary: string;
  outputHint: string;
  patternSummary: string;
  infraSummary: string;
  status: SceneAppOperatingSummaryViewModel["status"];
  statusLabel: string;
  operatingSummary: string;
  latestRunLabel?: string;
  scorecardActionLabel?: string;
  topFailureSignalLabel?: string;
  scorecardAggregate?: SceneAppScorecardAggregateViewModel | null;
  actionLabel: string;
}

export interface SceneAppDeliveryPartViewModel {
  key: string;
  label: string;
}

export interface SceneAppCompositionStepViewModel {
  id: string;
  title: string;
  bindingLabel?: string;
}

export interface SceneAppPlanningViewModel {
  statusLabel: string;
  summary: string;
  warnings: string[];
  unmetRequirements: string[];
}

export interface SceneAppContextReferenceItemViewModel {
  key: string;
  label: string;
  sourceLabel: string;
  contentTypeLabel: string;
  summary?: string;
  uri?: string;
  selected: boolean;
  usageLabel?: string;
  feedbackLabel?: string;
}

export interface SceneAppContextBaselineViewModel {
  scopeLabel?: string;
  referenceCount: number;
  referenceItems: SceneAppContextReferenceItemViewModel[];
  tasteSummary?: string;
  tasteKeywords: SceneAppDeliveryPartViewModel[];
  avoidKeywords: SceneAppDeliveryPartViewModel[];
  feedbackSummary?: string;
  feedbackSignals: SceneAppDeliveryPartViewModel[];
  feedbackUpdatedAtLabel?: string;
}

export interface SceneAppContextPlanViewModel extends SceneAppContextBaselineViewModel {
  activeLayers: SceneAppDeliveryPartViewModel[];
  skillRefs: SceneAppDeliveryPartViewModel[];
  memoryRefs: SceneAppDeliveryPartViewModel[];
  toolRefs: SceneAppDeliveryPartViewModel[];
  notes: string[];
}

export interface SceneAppProjectPackPlanViewModel {
  packKindLabel: string;
  completionStrategyLabel: string;
  viewerLabel?: string;
  primaryPart?: string;
  requiredParts: SceneAppDeliveryPartViewModel[];
  notes: string[];
}

export interface SceneAppExecutionRuntimeBackflowViewModel {
  runId: string;
  statusLabel: string;
  statusTone: "default" | "accent" | "success" | "watch" | "risk";
  summary: string;
  nextAction: string;
  sourceLabel: string;
  deliveryCompletionLabel: string;
  evidenceSourceLabel: string;
  startedAtLabel: string;
  finishedAtLabel: string;
  scorecardActionLabel?: string;
  topFailureSignalLabel?: string;
  deliveryCompletedParts: SceneAppDeliveryPartViewModel[];
  deliveryMissingParts: SceneAppDeliveryPartViewModel[];
  observedFailureSignals: SceneAppDeliveryPartViewModel[];
  governanceArtifacts: SceneAppDeliveryPartViewModel[];
}

export interface SceneAppExecutionSummaryDescriptorSnapshot {
  deliveryContract: SceneAppDeliveryContract;
  deliveryProfile?: SceneAppDescriptor["deliveryProfile"];
  linkedServiceSkillId?: string;
  linkedSceneKey?: string;
}

export interface SceneAppExecutionSummaryViewModel {
  sceneappId: string;
  title: string;
  summary: string;
  businessLabel: string;
  typeLabel: string;
  executionChainLabel: string;
  deliveryContractLabel: string;
  planningStatusLabel: string;
  planningSummary: string;
  activeLayers: SceneAppDeliveryPartViewModel[];
  referenceCount: number;
  referenceItems: SceneAppContextReferenceItemViewModel[];
  tasteSummary?: string;
  feedbackSummary?: string;
  projectPackPlan: SceneAppProjectPackPlanViewModel | null;
  scorecardProfileRef?: string;
  scorecardMetricKeys: SceneAppDeliveryPartViewModel[];
  scorecardFailureSignals: SceneAppDeliveryPartViewModel[];
  scorecardAggregate?: SceneAppScorecardAggregateViewModel | null;
  notes: string[];
  descriptorSnapshot?: SceneAppExecutionSummaryDescriptorSnapshot;
  runtimeBackflow?: SceneAppExecutionRuntimeBackflowViewModel | null;
}

export interface SceneAppDetailViewModel {
  id: string;
  title: string;
  summary: string;
  businessLabel: string;
  typeLabel: string;
  deliveryContractLabel: string;
  valueStatement: string;
  outputHint: string;
  executionChainLabel: string;
  sourcePackageId: string;
  sourcePackageVersion: string;
  patternLabels: string[];
  launchRequirements: string[];
  launchInputPlaceholder: string;
  launchSeedLabel: string;
  launchSeedPreview: string;
  launchActionLabel: string;
  artifactProfileRef?: string;
  deliveryViewerLabel?: string;
  deliveryNarrative: string;
  deliveryPrimaryPart?: string;
  deliveryRequiredParts: SceneAppDeliveryPartViewModel[];
  compositionBlueprintRef?: string;
  compositionStepCount: number;
  compositionSteps: SceneAppCompositionStepViewModel[];
  planning: SceneAppPlanningViewModel;
  contextPlan: SceneAppContextPlanViewModel | null;
  projectPackPlan: SceneAppProjectPackPlanViewModel | null;
  scorecardProfileRef?: string;
  scorecardMetricKeys: SceneAppDeliveryPartViewModel[];
  scorecardFailureSignals: SceneAppDeliveryPartViewModel[];
  scorecardNarrative: string;
}

export interface SceneAppScorecardMetricViewModel {
  key: string;
  label: string;
  value: number;
  status: SceneAppScorecard["metrics"][number]["status"];
}

export interface SceneAppScorecardViewModel {
  hasRuntimeScorecard: boolean;
  aggregate: SceneAppScorecardAggregateViewModel | null;
  profileRef?: string;
  metricKeys: SceneAppDeliveryPartViewModel[];
  failureSignals: SceneAppDeliveryPartViewModel[];
  observedFailureSignals: SceneAppDeliveryPartViewModel[];
  topFailureSignalLabel?: string;
  deliveryContractLabel?: string;
  viewerLabel?: string;
  completionStrategyLabel?: string;
  deliveryRequiredParts: SceneAppDeliveryPartViewModel[];
  packPlanNotes: string[];
  contextBaseline: SceneAppContextBaselineViewModel | null;
  operatingNarrative: string;
  actionLabel?: string;
  summary: string;
  metrics: SceneAppScorecardMetricViewModel[];
}

export interface SceneAppRunListItemViewModel {
  runId: string;
  status: SceneAppRunSummary["status"];
  statusLabel: string;
  summary: string;
  sourceLabel: string;
  artifactCount: number;
  deliveryLabel: string;
  failureSignalLabel?: string;
  startedAtLabel: string;
  finishedAtLabel: string;
}

export interface SceneAppRunDeliveryArtifactEntryViewModel {
  key: string;
  label: string;
  pathLabel: string;
  helperText: string;
  isPrimary: boolean;
  artifactRef: SceneAppDeliveryArtifactRef;
}

export interface SceneAppRunGovernanceArtifactEntryViewModel {
  key: string;
  label: string;
  pathLabel: string;
  helperText: string;
  artifactRef: SceneAppGovernanceArtifactRef;
}

export interface SceneAppRunGovernanceActionViewModel {
  key: string;
  label: string;
  helperText: string;
  primaryArtifactKind: SceneAppGovernanceArtifactKind;
  primaryArtifactLabel: string;
  artifactKinds: SceneAppGovernanceArtifactKind[];
}

export interface SceneAppGovernancePanelStatusItemViewModel {
  key: string;
  label: string;
  value: string;
  description: string;
  tone: "good" | "watch" | "risk" | "idle";
}

export interface SceneAppGovernancePanelDestinationViewModel {
  key: string;
  label: string;
  description: string;
}

export interface SceneAppOperatingSummaryViewModel {
  status: "idle" | "good" | "watch" | "risk";
  statusLabel: string;
  summary: string;
  nextAction: string;
  scorecardActionLabel?: string;
  topFailureSignalLabel?: string;
  destinations: SceneAppGovernancePanelDestinationViewModel[];
}

export interface SceneAppScorecardAggregateViewModel {
  status: SceneAppOperatingSummaryViewModel["status"];
  statusLabel: string;
  summary: string;
  nextAction: string;
  actionLabel?: string;
  topFailureSignalLabel?: string;
  profileRef?: string;
  metricKeys: SceneAppDeliveryPartViewModel[];
  failureSignals: SceneAppDeliveryPartViewModel[];
  observedFailureSignals: SceneAppDeliveryPartViewModel[];
  destinations: SceneAppGovernancePanelDestinationViewModel[];
}

export interface SceneAppRunDetailViewModel {
  runId: string;
  status: SceneAppRunSummary["status"];
  statusLabel: string;
  stageLabel: string;
  summary: string;
  nextAction: string;
  sourceLabel: string;
  artifactCount: number;
  deliveryCompletionLabel: string;
  deliverySummary: string;
  deliveryRequiredParts: SceneAppDeliveryPartViewModel[];
  deliveryCompletedParts: SceneAppDeliveryPartViewModel[];
  deliveryMissingParts: SceneAppDeliveryPartViewModel[];
  deliveryPartCoverageKnown: boolean;
  deliveryViewerLabel?: string;
  packCompletionStrategyLabel?: string;
  packViewerLabel?: string;
  plannedDeliveryRequiredParts: SceneAppDeliveryPartViewModel[];
  packPlanNotes: string[];
  contextBaseline: SceneAppContextBaselineViewModel | null;
  deliveryArtifactEntries: SceneAppRunDeliveryArtifactEntryViewModel[];
  governanceActionEntries: SceneAppRunGovernanceActionViewModel[];
  governanceArtifactEntries: SceneAppRunGovernanceArtifactEntryViewModel[];
  failureSignalLabel?: string;
  evidenceSourceLabel: string;
  requestTelemetryLabel: string;
  artifactValidatorLabel: string;
  evidenceKnownGaps: string[];
  verificationFailureOutcomes: string[];
  startedAtLabel: string;
  finishedAtLabel: string;
  durationLabel: string;
  entryAction:
    | {
        kind: "open_automation_job";
        label: string;
        helperText: string;
        jobId: string;
      }
    | {
        kind: "open_agent_session";
        label: string;
        helperText: string;
        sessionId: string;
      }
    | {
        kind: "open_browser_runtime";
        label: string;
        helperText: string;
        browserRuntimeRef: SceneAppBrowserRuntimeRef;
      }
    | {
        kind: "open_service_scene_session";
        label: string;
        helperText: string;
        sessionId?: string;
        serviceSceneRuntimeRef: SceneAppServiceSceneRuntimeRef;
      }
    | {
        kind: "open_native_skill_session";
        label: string;
        helperText: string;
        sessionId?: string;
        nativeSkillRuntimeRef: SceneAppNativeSkillRuntimeRef;
      }
    | null;
}

export interface SceneAppGovernancePanelViewModel {
  status: "idle" | "good" | "watch" | "risk";
  statusLabel: string;
  summary: string;
  nextAction: string;
  latestRunLabel: string;
  scorecardActionLabel?: string;
  topFailureSignalLabel?: string;
  contextBaseline: SceneAppContextBaselineViewModel | null;
  destinations: SceneAppGovernancePanelDestinationViewModel[];
  statusItems: SceneAppGovernancePanelStatusItemViewModel[];
  governanceActionEntries: SceneAppRunGovernanceActionViewModel[];
  governanceArtifactEntries: SceneAppRunGovernanceArtifactEntryViewModel[];
  entryAction: SceneAppRunDetailViewModel["entryAction"];
}

export interface SceneAppAutomationWorkspaceCardViewModel {
  sceneappId: string;
  title: string;
  businessLabel: string;
  typeLabel: string;
  patternSummary: string;
  status: SceneAppOperatingSummaryViewModel["status"];
  statusLabel: string;
  summary: string;
  nextAction: string;
  scorecardActionLabel?: string;
  topFailureSignalLabel?: string;
  destinations: SceneAppGovernancePanelDestinationViewModel[];
  scorecardAggregate?: SceneAppScorecardAggregateViewModel | null;
  automationSummary: string;
  latestAutomationLabel: string;
}

function humanizeTokenLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return value;
  }

  const withSpaces = normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withSpaces) {
    return normalized;
  }

  return withSpaces.replace(/^\w/, (firstChar) => firstChar.toUpperCase());
}

function buildLabeledItems(
  values: string[] | undefined,
  labelMap: Record<string, string>,
): SceneAppDeliveryPartViewModel[] {
  return Array.from(new Set(values ?? []))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({
      key: value,
      label: labelMap[value] ?? humanizeTokenLabel(value),
    }));
}

function buildContextRefItems(
  values: string[] | undefined,
): SceneAppDeliveryPartViewModel[] {
  return Array.from(new Set(values ?? []))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const separatorIndex = value.indexOf(":");
      if (separatorIndex < 0) {
        return {
          key: value,
          label: humanizeTokenLabel(value),
        };
      }

      const prefix = value.slice(0, separatorIndex);
      const suffix = value.slice(separatorIndex + 1);
      return {
        key: value,
        label: `${humanizeTokenLabel(prefix)} · ${suffix}`,
      };
    });
}

function buildPlainLabelItems(
  values: string[] | undefined,
): SceneAppDeliveryPartViewModel[] {
  return Array.from(new Set(values ?? []))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => ({
      key: value,
      label: value,
    }));
}

function buildContextScopeLabel(
  snapshot?:
    | NonNullable<SceneAppPlanResult["contextOverlay"]>["snapshot"]
    | null,
): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  const parts: string[] = [];
  const projectId = snapshot.projectId?.trim();
  const workspaceId = snapshot.workspaceId?.trim();

  if (projectId) {
    parts.push(`项目 ${projectId}`);
  }
  if (workspaceId && workspaceId !== projectId) {
    parts.push(`工作区 ${workspaceId}`);
  }

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function getContextSourceKindLabel(value: string): string {
  return CONTEXT_SOURCE_KIND_LABELS[value] ?? humanizeTokenLabel(value);
}

function getContextContentTypeLabel(value: string): string {
  return CONTEXT_CONTENT_TYPE_LABELS[value] ?? humanizeTokenLabel(value);
}

function getRuntimeFeedbackSignalLabel(signal: string): string {
  return SCORECARD_SIGNAL_LABELS[signal] ?? humanizeTokenLabel(signal);
}

function buildRuntimeReferenceFeedbackLabel(
  run?: SceneAppRunSummary | null,
  scorecard?: SceneAppScorecard | null,
): string | undefined {
  const signal = run?.failureSignal ?? scorecard?.topFailureSignal;
  if (signal) {
    return getFailureSignalLabel(signal);
  }

  switch (scorecard?.recommendedAction) {
    case "launch":
      return "继续补样本";
    case "keep":
      return "继续保留";
    case "optimize":
      return "优先优化";
    case "retire":
      return "考虑收口";
    default:
      break;
  }

  switch (run?.status) {
    case "success":
      return "可继续复用";
    case "canceled":
      return "人工中断";
    case "timeout":
      return "运行超时";
    case "error":
      return "运行受阻";
    default:
      return undefined;
  }
}

function buildRuntimeFeedbackSignals(
  run?: SceneAppRunSummary | null,
  scorecard?: SceneAppScorecard | null,
): string[] {
  const signals = new Set<string>();
  if (run?.failureSignal) {
    signals.add(run.failureSignal);
  }
  if (scorecard?.topFailureSignal) {
    signals.add(scorecard.topFailureSignal);
  }
  for (const signal of scorecard?.observedFailureSignals ?? []) {
    signals.add(signal);
  }
  if ((run?.artifactValidatorIssueCount ?? 0) > 0) {
    signals.add("artifact_validation_issue");
  }
  if (run?.requestTelemetryAvailable === false) {
    signals.add("telemetry_missing");
  }
  if ((run?.evidenceKnownGaps?.length ?? 0) > 0) {
    signals.add("runtime_evidence_gap");
  }
  if ((run?.verificationFailureOutcomes?.length ?? 0) > 0) {
    signals.add("verification_failure");
  }
  if (!run?.failureSignal && (run?.deliveryMissingParts?.length ?? 0) > 0) {
    signals.add("pack_incomplete");
  }
  return Array.from(signals);
}

function buildRuntimeFeedbackSummary(
  run?: SceneAppRunSummary | null,
  scorecard?: SceneAppScorecard | null,
): string | undefined {
  if (!run && !scorecard) {
    return undefined;
  }

  const deliveryRequiredParts = run?.deliveryRequiredParts ?? [];
  const deliveryCompletedParts = run?.deliveryCompletedParts ?? [];
  const deliveryMissingParts = run?.deliveryMissingParts ?? [];

  const deliverySentence = run
    ? run.deliveryPartCoverageKnown && deliveryRequiredParts.length > 0
      ? deliveryMissingParts.length === 0
        ? `最近一次运行已交齐 ${deliveryCompletedParts.length}/${deliveryRequiredParts.length} 个必含部件。`
        : `最近一次运行已交付 ${deliveryCompletedParts.length}/${deliveryRequiredParts.length} 个必含部件。`
      : run.artifactCount > 0
        ? `最近一次运行已回流 ${run.artifactCount} 份结果。`
        : "最近一次运行还没有回流可继续判断的结果。"
    : undefined;

  const blockerSentence =
    run?.failureSignal || scorecard?.topFailureSignal
      ? `当前主要卡点是${getRuntimeFeedbackSignalLabel(run?.failureSignal ?? scorecard?.topFailureSignal ?? "")}。`
      : (run?.evidenceKnownGaps?.length ?? 0) > 0
        ? "当前仍有会话证据缺口需要补齐。"
        : (run?.verificationFailureOutcomes?.length ?? 0) > 0
          ? "当前仍有结果校验问题需要回头处理。"
          : "当前还没有出现明显阻塞。";

  const actionSentence = scorecard
    ? `经营上建议${
        scorecard.recommendedAction === "launch"
          ? "继续补样本"
          : scorecard.recommendedAction === "keep"
            ? "继续保留"
            : scorecard.recommendedAction === "optimize"
              ? "优先优化"
              : "考虑收口"
      }。`
    : run?.status === "success"
      ? "经营上可以继续复用这轮结果。"
      : run?.status === "canceled"
        ? "经营上更适合先确认人工中断原因。"
        : run?.status === "timeout" || run?.status === "error"
          ? "经营上更适合先修运行链再继续放大。"
          : "经营上先等待这轮运行稳定收口。";

  return [deliverySentence, blockerSentence, actionSentence]
    .filter(Boolean)
    .join("");
}

function buildContextReferenceItems(
  values:
    | NonNullable<
        SceneAppPlanResult["contextOverlay"]
      >["snapshot"]["referenceItems"]
    | undefined,
  feedback?: {
    run?: SceneAppRunSummary | null;
    scorecard?: SceneAppScorecard | null;
  },
): SceneAppContextReferenceItemViewModel[] {
  const runtimeFeedbackLabel = buildRuntimeReferenceFeedbackLabel(
    feedback?.run,
    feedback?.scorecard,
  );
  return (values ?? [])
    .filter((item) => item.id.trim() && item.label.trim())
    .map((item) => ({
      key: item.id,
      label: item.label.trim(),
      sourceLabel: getContextSourceKindLabel(item.sourceKind),
      contentTypeLabel: getContextContentTypeLabel(item.contentType),
      summary: item.summary?.trim() || undefined,
      uri: item.uri?.trim() || undefined,
      selected: item.selected,
      usageLabel:
        typeof item.usageCount === "number" && item.usageCount > 0
          ? `已用 ${item.usageCount} 次`
          : undefined,
      feedbackLabel:
        item.lastFeedbackLabel?.trim() ||
        (item.selected ? runtimeFeedbackLabel : undefined),
    }));
}

function buildContextBaselinePresentation(
  contextOverlay?: SceneAppPlanResult["contextOverlay"] | null,
  feedback?: {
    run?: SceneAppRunSummary | null;
    scorecard?: SceneAppScorecard | null;
  },
): SceneAppContextBaselineViewModel | null {
  if (!contextOverlay) {
    return null;
  }

  const tasteProfile = contextOverlay.snapshot.tasteProfile;
  const runtimeFeedbackSignals = buildRuntimeFeedbackSignals(
    feedback?.run,
    feedback?.scorecard,
  );
  const feedbackTimestamp =
    tasteProfile?.lastFeedbackAt ??
    feedback?.run?.finishedAt ??
    feedback?.run?.startedAt ??
    undefined;

  return {
    scopeLabel: buildContextScopeLabel(contextOverlay.snapshot),
    referenceCount: contextOverlay.compilerPlan.referenceCount,
    referenceItems: buildContextReferenceItems(
      contextOverlay.snapshot.referenceItems,
      feedback,
    ),
    tasteSummary: tasteProfile?.summary?.trim() || undefined,
    tasteKeywords: buildPlainLabelItems(tasteProfile?.keywords),
    avoidKeywords: buildPlainLabelItems(tasteProfile?.avoidKeywords),
    feedbackSummary:
      tasteProfile?.feedbackSummary?.trim() ||
      buildRuntimeFeedbackSummary(feedback?.run, feedback?.scorecard),
    feedbackSignals: buildLabeledItems(
      tasteProfile?.feedbackSignals?.length
        ? tasteProfile.feedbackSignals
        : runtimeFeedbackSignals,
      SCORECARD_SIGNAL_LABELS,
    ),
    feedbackUpdatedAtLabel: feedbackTimestamp
      ? formatSceneAppDateTime(feedbackTimestamp)
      : undefined,
  };
}

function buildProjectPackPlanPresentation(params: {
  descriptor?: Pick<
    SceneAppDescriptor,
    "deliveryContract" | "deliveryProfile"
  > | null;
  projectPackPlan?: SceneAppPlanResult["projectPackPlan"] | null;
}): {
  packKindLabel?: string;
  completionStrategyLabel?: string;
  viewerLabel?: string;
  primaryPart?: string;
  requiredParts: SceneAppDeliveryPartViewModel[];
  notes: string[];
} {
  const { descriptor, projectPackPlan } = params;
  const resolvedContract =
    projectPackPlan?.packKind ?? descriptor?.deliveryContract;
  const primaryPart =
    projectPackPlan?.primaryPart ?? descriptor?.deliveryProfile?.primaryPart;

  return {
    packKindLabel: resolvedContract
      ? getSceneAppDeliveryContractLabel(resolvedContract)
      : undefined,
    completionStrategyLabel: projectPackPlan?.completionStrategy
      ? (PROJECT_PACK_COMPLETION_LABELS[projectPackPlan.completionStrategy] ??
        humanizeTokenLabel(projectPackPlan.completionStrategy))
      : undefined,
    viewerLabel: getSceneAppViewerKindLabel(
      projectPackPlan?.viewerKind ?? descriptor?.deliveryProfile?.viewerKind,
    ),
    primaryPart:
      primaryPart &&
      (DELIVERY_PART_LABELS[primaryPart] ?? humanizeTokenLabel(primaryPart)),
    requiredParts: buildLabeledItems(
      projectPackPlan?.requiredParts?.length
        ? projectPackPlan.requiredParts
        : descriptor?.deliveryProfile?.requiredParts,
      DELIVERY_PART_LABELS,
    ),
    notes: dedupeNonEmptyLines(projectPackPlan?.notes),
  };
}

function getFailureSignalLabel(signal?: string | null): string | undefined {
  if (!signal) {
    return undefined;
  }

  return SCORECARD_SIGNAL_LABELS[signal] ?? humanizeTokenLabel(signal);
}

function buildRunDeliveryPresentation(run: SceneAppRunSummary): {
  deliveryLabel: string;
  completionLabel: string;
  summary: string;
  requiredParts: SceneAppDeliveryPartViewModel[];
  completedParts: SceneAppDeliveryPartViewModel[];
  missingParts: SceneAppDeliveryPartViewModel[];
  partCoverageKnown: boolean;
  failureSignalLabel?: string;
} {
  const requiredParts = buildLabeledItems(
    run.deliveryRequiredParts,
    DELIVERY_PART_LABELS,
  );
  const completedParts = buildLabeledItems(
    run.deliveryCompletedParts,
    DELIVERY_PART_LABELS,
  );
  const missingParts = buildLabeledItems(
    run.deliveryMissingParts,
    DELIVERY_PART_LABELS,
  );
  const partCoverageKnown = Boolean(run.deliveryPartCoverageKnown);
  const failureSignalLabel = getFailureSignalLabel(run.failureSignal);

  if (partCoverageKnown && requiredParts.length > 0) {
    const delivered = completedParts.length;
    const total = requiredParts.length;
    const missingSummary =
      missingParts.length > 0
        ? `，还缺 ${missingParts.map((part) => part.label).join("、")}`
        : "";

    return {
      deliveryLabel:
        missingParts.length === 0
          ? `整包 ${delivered}/${total}`
          : `交付 ${delivered}/${total}`,
      completionLabel:
        missingParts.length === 0
          ? `整包已交齐 ${delivered}/${total} 个部件`
          : `已交付 ${delivered}/${total} 个部件`,
      summary:
        missingParts.length === 0
          ? `这次运行已经交齐 ${total} 个必含部件，可直接继续复核、编辑或发布。`
          : `这次运行已交付 ${delivered}/${total} 个部件${missingSummary}。`,
      requiredParts,
      completedParts,
      missingParts,
      partCoverageKnown,
      failureSignalLabel,
    };
  }

  if (run.artifactCount > 0) {
    return {
      deliveryLabel: `结果 ${run.artifactCount} 份`,
      completionLabel: `已回流 ${run.artifactCount} 份结果`,
      summary: `这次运行已回流 ${run.artifactCount} 份结果，但暂时还拿不到部件级交付明细。`,
      requiredParts,
      completedParts,
      missingParts,
      partCoverageKnown,
      failureSignalLabel,
    };
  }

  return {
    deliveryLabel: "待回流",
    completionLabel: "暂未回流结果",
    summary: "这次运行还没有记录到可继续判断的结果材料。",
    requiredParts,
    completedParts,
    missingParts,
    partCoverageKnown,
    failureSignalLabel,
  };
}

function buildRunSummaryText(params: {
  descriptorTitle: string;
  run: SceneAppRunSummary;
  delivery: ReturnType<typeof buildRunDeliveryPresentation>;
}): string {
  const { descriptorTitle, run, delivery } = params;
  const hasTitle = Boolean(descriptorTitle.trim());
  const subject = hasTitle ? `「${descriptorTitle.trim()}」` : "这次运行";

  switch (run.status) {
    case "queued":
      return `${subject}已进入执行队列，${delivery.summary}`;
    case "running":
      return `${subject}正在推进结果链，${delivery.summary}`;
    case "success":
      return hasTitle
        ? `${subject} 本次运行成功，${delivery.summary}`
        : `${subject}成功，${delivery.summary}`;
    case "canceled":
      return hasTitle
        ? `${subject} 这次运行被主动取消，${delivery.summary}`
        : `${subject}被主动取消，${delivery.summary}`;
    case "timeout":
      return hasTitle
        ? `${subject} 在执行过程中超时，${delivery.summary}`
        : `${subject}超时，${delivery.summary}`;
    case "error":
      return hasTitle
        ? `${subject} 这次运行未成功完成，${delivery.summary}`
        : `${subject}未成功完成，${delivery.summary}`;
  }
}

function buildRunNextAction(
  run: SceneAppRunSummary,
  fallback: string,
  delivery: ReturnType<typeof buildRunDeliveryPresentation>,
): string {
  switch (run.failureSignal) {
    case "review_blocked":
      return "优先补齐复核意见或检查 review 步骤，再决定是否进入发布动作。";
    case "publish_stalled":
      return "优先补齐最终发布件或检查媒体输出写回链路，再继续推进。";
    case "pack_incomplete":
      return delivery.partCoverageKnown && delivery.missingParts.length > 0
        ? `优先补齐 ${delivery.missingParts
            .map((part) => part.label)
            .join("、")}，再判断这份结果包是否达到可复用标准。`
        : "优先补齐缺失部件，再判断这份结果包是否达到了可复用标准。";
    case "automation_timeout":
      return "优先检查调度窗口、超时阈值和外部依赖，再决定是否拆分步骤链。";
    default:
      return fallback;
  }
}

function dedupeNonEmptyLines(values: string[] | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  );
}

function extractFileNameFromPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) {
    return "结果文件";
  }

  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) || normalized;
}

function getSceneAppDeliveryArtifactLabel(
  artifact: SceneAppDeliveryArtifactRef,
): string {
  if (artifact.partKey?.trim()) {
    return (
      DELIVERY_PART_LABELS[artifact.partKey] ??
      humanizeTokenLabel(artifact.partKey)
    );
  }

  const fileName = extractFileNameFromPath(
    artifact.relativePath || artifact.absolutePath || "",
  );
  return DELIVERY_PART_LABELS[fileName] ?? fileName;
}

function getSceneAppGovernanceArtifactLabel(
  artifact: SceneAppGovernanceArtifactRef,
): string {
  const label = artifact.label?.trim();
  if (label) {
    return label;
  }

  return (
    getSceneAppGovernanceArtifactKindLabel(artifact.kind) ??
    extractFileNameFromPath(
      artifact.relativePath || artifact.absolutePath || "",
    )
  );
}

function getSceneAppGovernanceArtifactKindLabel(
  kind: SceneAppGovernanceArtifactKind,
): string {
  return GOVERNANCE_ARTIFACT_LABELS[kind] ?? humanizeTokenLabel(kind);
}

function canOpenSceneAppFileRef(
  artifact: Pick<
    SceneAppDeliveryArtifactRef,
    "relativePath" | "absolutePath" | "projectId"
  >,
): boolean {
  const relativePath = artifact.relativePath?.trim();
  const absolutePath = artifact.absolutePath?.trim();
  const projectId = artifact.projectId?.trim();

  return Boolean(
    (relativePath && projectId) ||
    absolutePath ||
    (relativePath &&
      (relativePath.startsWith("/") ||
        relativePath.startsWith("~/") ||
        /^[A-Za-z]:[\\/]/.test(relativePath) ||
        relativePath.startsWith("\\\\"))),
  );
}

function buildRunDeliveryArtifactEntries(params: {
  descriptor: Pick<SceneAppDescriptor, "deliveryProfile">;
  run: SceneAppRunSummary;
}): SceneAppRunDeliveryArtifactEntryViewModel[] {
  const { descriptor, run } = params;
  const requiredParts = descriptor.deliveryProfile?.requiredParts ?? [];
  const primaryPart = descriptor.deliveryProfile?.primaryPart?.trim() || "";
  const seenKeys = new Set<string>();

  return (run.deliveryArtifactRefs ?? [])
    .filter(canOpenSceneAppFileRef)
    .filter((artifact) => {
      const partKey = artifact.partKey?.trim();
      const dedupeKey =
        partKey ||
        artifact.relativePath?.trim() ||
        artifact.absolutePath?.trim();
      if (!dedupeKey || seenKeys.has(dedupeKey)) {
        return false;
      }
      seenKeys.add(dedupeKey);
      return true;
    })
    .map((artifact, index) => {
      const partKey = artifact.partKey?.trim() || "";
      const isPrimary =
        Boolean(primaryPart) && Boolean(partKey) && partKey === primaryPart;
      const openTarget =
        artifact.relativePath?.trim() || artifact.absolutePath?.trim() || "";

      return {
        key: `${partKey || artifact.relativePath || artifact.absolutePath || "artifact"}-${index}`,
        label: isPrimary
          ? `主稿 · ${getSceneAppDeliveryArtifactLabel(artifact)}`
          : getSceneAppDeliveryArtifactLabel(artifact),
        pathLabel: openTarget,
        helperText:
          artifact.source === "runtime_evidence"
            ? "直接打开这次运行已回流的结果文件。"
            : "当前先按运行摘要里的结果路径打开文件。",
        isPrimary,
        artifactRef: artifact,
      };
    })
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }

      const leftPartKey = left.artifactRef.partKey?.trim() || "";
      const rightPartKey = right.artifactRef.partKey?.trim() || "";
      const leftIndex = leftPartKey ? requiredParts.indexOf(leftPartKey) : -1;
      const rightIndex = rightPartKey
        ? requiredParts.indexOf(rightPartKey)
        : -1;
      if (leftIndex !== rightIndex) {
        if (leftIndex < 0) {
          return 1;
        }
        if (rightIndex < 0) {
          return -1;
        }
        return leftIndex - rightIndex;
      }

      return left.label.localeCompare(right.label, "zh-CN");
    });
}

function buildRunGovernanceArtifactEntries(
  run: SceneAppRunSummary,
): SceneAppRunGovernanceArtifactEntryViewModel[] {
  const seenKeys = new Set<string>();
  const kindOrder: Record<SceneAppGovernanceArtifactRef["kind"], number> = {
    evidence_summary: 0,
    review_decision_markdown: 1,
    review_decision_json: 2,
  };

  return (run.governanceArtifactRefs ?? [])
    .filter(canOpenSceneAppFileRef)
    .filter((artifact) => {
      const dedupeKey =
        artifact.kind ||
        artifact.relativePath?.trim() ||
        artifact.absolutePath?.trim();
      if (!dedupeKey || seenKeys.has(dedupeKey)) {
        return false;
      }
      seenKeys.add(dedupeKey);
      return true;
    })
    .map((artifact, index) => ({
      key: `${artifact.kind}-${index}`,
      label: getSceneAppGovernanceArtifactLabel(artifact),
      pathLabel:
        artifact.relativePath?.trim() || artifact.absolutePath?.trim() || "",
      helperText:
        artifact.kind === "evidence_summary"
          ? "打开这次运行的证据摘要；如果文件还没落地，会先补生成再继续打开。"
          : artifact.kind === "review_decision_markdown"
            ? "打开人工复核记录；如果文件还没落地，会先补生成再继续打开。"
            : "打开结构化复核 JSON；如果文件还没落地，会先补生成再继续打开。",
      artifactRef: artifact,
    }))
    .sort((left, right) => {
      const leftOrder =
        kindOrder[left.artifactRef.kind] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder =
        kindOrder[right.artifactRef.kind] ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.label.localeCompare(right.label, "zh-CN");
    });
}

function buildRunGovernanceActionEntries(
  run: SceneAppRunSummary,
): SceneAppRunGovernanceActionViewModel[] {
  const availableKinds = new Set(
    (run.governanceArtifactRefs ?? []).map((artifact) => artifact.kind),
  );
  const verificationFailureCount = dedupeNonEmptyLines(
    run.verificationFailureOutcomes,
  ).length;
  const evidenceGapCount = dedupeNonEmptyLines(run.evidenceKnownGaps).length;
  const validatorIssueCount = run.artifactValidatorIssueCount ?? 0;
  const actions: SceneAppRunGovernanceActionViewModel[] = [];

  if (
    availableKinds.has("evidence_summary") &&
    availableKinds.has("review_decision_markdown")
  ) {
    actions.push({
      key: "weekly-review-pack",
      label: "补结果材料",
      helperText:
        verificationFailureCount > 0 || run.failureSignal === "review_blocked"
          ? "先补齐证据摘要和人工复核记录，再直接看清当前卡点、结论和下一步。"
          : evidenceGapCount > 0
            ? "先把证据摘要和人工复核记录一起补齐，避免看结果时还在补材料。"
            : "同步更新证据摘要和人工复核记录，适合直接回看这次运行。",
      primaryArtifactKind: "review_decision_markdown",
      primaryArtifactLabel: getSceneAppGovernanceArtifactKindLabel(
        "review_decision_markdown",
      ),
      artifactKinds: ["evidence_summary", "review_decision_markdown"],
    });
  }

  if (
    availableKinds.has("evidence_summary") &&
    availableKinds.has("review_decision_markdown") &&
    availableKinds.has("review_decision_json")
  ) {
    actions.push({
      key: "structured-governance-pack",
      label: "补结果记录",
      helperText:
        validatorIssueCount > 0 ||
        verificationFailureCount > 0 ||
        run.requestTelemetryAvailable === false
          ? "一次补齐证据、复核记录和结构化 JSON，方便生成、统计或后续结果跟进继续消费。"
          : "一次补齐证据、复核记录和结构化 JSON，方便结果统计和后续持续流程消费。",
      primaryArtifactKind: "review_decision_json",
      primaryArtifactLabel: getSceneAppGovernanceArtifactKindLabel(
        "review_decision_json",
      ),
      artifactKinds: [
        "evidence_summary",
        "review_decision_markdown",
        "review_decision_json",
      ],
    });
  }

  return actions;
}

function buildRunEvidencePresentation(params: {
  descriptor: Pick<SceneAppDescriptor, "deliveryProfile">;
  run: SceneAppRunSummary;
}): {
  deliveryViewerLabel?: string;
  evidenceSourceLabel: string;
  requestTelemetryLabel: string;
  artifactValidatorLabel: string;
  knownGaps: string[];
  verificationFailureOutcomes: string[];
} {
  const { descriptor, run } = params;
  const runtimeEvidenceUsed = Boolean(run.runtimeEvidenceUsed);
  const deliveryViewerLabel = getSceneAppViewerKindLabel(
    descriptor.deliveryProfile?.viewerKind,
  );
  const verificationFailureOutcomes = dedupeNonEmptyLines(
    run.verificationFailureOutcomes,
  );
  const knownGaps = runtimeEvidenceUsed
    ? dedupeNonEmptyLines(run.evidenceKnownGaps)
    : [
        "当前还没有拿到关联 session 的会话证据，运行判断暂时回退到 tracker metadata。",
      ];

  const requestTelemetryLabel = !runtimeEvidenceUsed
    ? "当前仍按运行摘要回退，尚未接入会话级请求遥测。"
    : run.requestTelemetryAvailable === false
      ? "当前环境没有可读取的请求遥测目录，暂时无法关联 provider request。"
      : (run.requestTelemetryMatchedCount ?? 0) > 0
        ? `已关联 ${run.requestTelemetryMatchedCount} 条会话级请求遥测，可继续核对成本与模型调用。`
        : "已检查请求遥测，但当前这次运行还没有匹配到 provider request 记录。";

  let artifactValidatorLabel: string;
  if (!runtimeEvidenceUsed) {
    artifactValidatorLabel =
      "当前仍按运行摘要回退，尚未接入 Artifact 校验事实。";
  } else if (run.artifactValidatorApplicable === false) {
    artifactValidatorLabel =
      "这次结果没有命中 Artifact 校验文档，当前不需要额外结构校验。";
  } else {
    const issueCount = run.artifactValidatorIssueCount ?? 0;
    const recoveredCount = run.artifactValidatorRecoveredCount ?? 0;

    if (issueCount > 0 && recoveredCount > 0) {
      artifactValidatorLabel = `Artifact 校验仍有 ${issueCount} 条问题，但已有 ${recoveredCount} 个产物被自动恢复。`;
    } else if (issueCount > 0) {
      artifactValidatorLabel = `Artifact 校验仍有 ${issueCount} 条未恢复问题，当前不建议直接进入发布。`;
    } else if (recoveredCount > 0) {
      artifactValidatorLabel = `Artifact 校验没有留下阻塞问题，且已有 ${recoveredCount} 个产物被自动恢复。`;
    } else {
      artifactValidatorLabel = "Artifact 校验没有发现阻塞问题。";
    }
  }

  return {
    deliveryViewerLabel,
    evidenceSourceLabel: runtimeEvidenceUsed
      ? "当前已接入会话证据"
      : "当前仍使用运行摘要回退",
    requestTelemetryLabel,
    artifactValidatorLabel,
    knownGaps,
    verificationFailureOutcomes,
  };
}

function buildCompositionStepViewModels(
  descriptor: SceneAppDescriptor,
): SceneAppCompositionStepViewModel[] {
  return (descriptor.compositionProfile?.steps ?? []).map((step) => ({
    id: step.id,
    title: `第 ${step.order} 步 · ${DELIVERY_PART_LABELS[step.id] ?? humanizeTokenLabel(step.id)}`,
    bindingLabel: step.bindingFamily
      ? (BINDING_FAMILY_LABELS[step.bindingFamily] ?? step.bindingFamily)
      : undefined,
  }));
}

function buildSceneAppDeliveryNarrative(
  descriptor: SceneAppDescriptor,
): string {
  const parts = buildLabeledItems(
    descriptor.deliveryProfile?.requiredParts,
    DELIVERY_PART_LABELS,
  );
  const partsSummary =
    parts.length > 0
      ? `至少包含 ${parts.map((part) => part.label).join("、")}`
      : "当前还没有显式声明必含交付部件";

  switch (descriptor.deliveryContract) {
    case "project_pack":
      return `这套做法会把结果收口成一份可继续编辑的项目资料包，${partsSummary}。`;
    case "table_report":
      return `这套做法会把结果稳定回流成结构化表格或摘要报告，${partsSummary}。`;
    case "artifact_bundle":
    default:
      return `这套做法会把结果整理成统一结果包，${partsSummary}。`;
  }
}

function buildSceneAppScorecardNarrative(
  descriptor: SceneAppDescriptor,
): string {
  switch (descriptor.deliveryContract) {
    case "project_pack":
      return "经营上优先看整包是否交齐、是否通过复核，以及结果是否继续被打开编辑或发布。";
    case "table_report":
      return "经营上优先看摘要是否准时回流、是否被继续查看，以及异常是否能被快速定位。";
    case "artifact_bundle":
    default:
      return "经营上优先看结果包是否完整、是否被继续复用，以及失败原因是否可追踪。";
  }
}

function formatSceneAppDateTime(value?: string | null): string {
  if (!value) {
    return "未完成";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
  });
}

function formatSceneAppDuration(run: SceneAppRunSummary): string {
  if (!run.finishedAt) {
    return run.status === "running" ? "仍在执行" : "未完成";
  }

  const startedAt = new Date(run.startedAt).getTime();
  const finishedAt = new Date(run.finishedAt).getTime();
  if (
    Number.isNaN(startedAt) ||
    Number.isNaN(finishedAt) ||
    finishedAt < startedAt
  ) {
    return "时间未知";
  }

  const totalSeconds = Math.max(1, Math.round((finishedAt - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }
  return `${seconds} 秒`;
}

function resolveSceneAppRunEntryAction(params: {
  descriptor: Pick<SceneAppDescriptor, "title">;
  run: SceneAppRunSummary;
}): SceneAppRunDetailViewModel["entryAction"] {
  const { descriptor, run } = params;
  const jobId = run.sourceRef?.trim();
  if (run.source === "automation" && jobId) {
    return {
      kind: "open_automation_job",
      label: "打开持续流程",
      helperText: "继续查看这条持续流程的节奏、历史和输出状态。",
      jobId,
    };
  }

  const browserRuntimeRef = normalizeBrowserRuntimeRef(run.browserRuntimeRef);
  if (browserRuntimeRef) {
    return {
      kind: "open_browser_runtime",
      label: browserRuntimeRef.sessionId
        ? "回到浏览器运行时"
        : "打开浏览器运行时",
      helperText:
        "继续查看这次运行关联的浏览器会话、页面目标和站点执行上下文。",
      browserRuntimeRef,
    };
  }

  const serviceSceneRuntimeRef = normalizeServiceSceneRuntimeRef(
    run.serviceSceneRuntimeRef,
  );
  if (serviceSceneRuntimeRef) {
    return {
      kind: "open_service_scene_session",
      label: run.sessionId?.trim() ? "回到生成会话" : "恢复生成上下文",
      helperText: `继续把「${descriptor.title}」最近一次运行保留的启动信息带回生成。`,
      sessionId: run.sessionId?.trim() || undefined,
      serviceSceneRuntimeRef,
    };
  }

  const nativeSkillRuntimeRef = normalizeNativeSkillRuntimeRef(
    run.nativeSkillRuntimeRef,
  );
  if (nativeSkillRuntimeRef) {
    return {
      kind: "open_native_skill_session",
      label: run.sessionId?.trim() ? "回到本机技能会话" : "恢复本机技能",
      helperText: `继续回到「${descriptor.title}」最近一次运行挂起的本机技能入口和补参状态。`,
      sessionId: run.sessionId?.trim() || undefined,
      nativeSkillRuntimeRef,
    };
  }

  const sessionId = run.sessionId?.trim();
  if ((run.source === "chat" || run.source === "skill") && sessionId) {
    return {
      kind: "open_agent_session",
      label: "回到对应会话",
      helperText: "继续查看这次运行所在的 Agent 工作区、消息上下文和沉淀结果。",
      sessionId,
    };
  }

  return null;
}

function normalizeBrowserRuntimeRef(
  ref: SceneAppBrowserRuntimeRef | null | undefined,
): SceneAppBrowserRuntimeRef | null {
  const profileKey = ref?.profileKey?.trim() || null;
  const sessionId = ref?.sessionId?.trim() || null;
  const targetId = ref?.targetId?.trim() || null;

  if (!profileKey && !sessionId && !targetId) {
    return null;
  }

  return {
    profileKey,
    sessionId,
    targetId,
  };
}

function normalizeStringRecord(
  value: Record<string, string> | null | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedEntries = Object.entries(value)
    .map(([key, itemValue]) => {
      const normalizedKey = key.trim();
      const normalizedValue = itemValue.trim();
      if (!normalizedKey || !normalizedValue) {
        return null;
      }

      return [normalizedKey, normalizedValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function normalizeServiceSceneRuntimeRef(
  ref: SceneAppServiceSceneRuntimeRef | null | undefined,
): SceneAppServiceSceneRuntimeRef | null {
  const sceneKey = ref?.sceneKey?.trim() || null;
  const skillId = ref?.skillId?.trim() || null;
  const projectId = ref?.projectId?.trim() || null;
  const contentId = ref?.contentId?.trim() || null;
  const workspaceId = ref?.workspaceId?.trim() || null;
  const entrySource = ref?.entrySource?.trim() || null;
  const userInput = ref?.userInput?.trim() || null;
  const slots = normalizeStringRecord(ref?.slots);

  if (
    !sceneKey &&
    !skillId &&
    !projectId &&
    !contentId &&
    !workspaceId &&
    !entrySource &&
    !userInput &&
    !slots
  ) {
    return null;
  }

  return {
    sceneKey,
    skillId,
    projectId,
    contentId,
    workspaceId,
    entrySource,
    userInput,
    slots,
  };
}

function normalizeNativeSkillRuntimeRef(
  ref: SceneAppNativeSkillRuntimeRef | null | undefined,
): SceneAppNativeSkillRuntimeRef | null {
  const skillId = ref?.skillId?.trim() || null;
  const skillKey = ref?.skillKey?.trim() || null;
  const projectId = ref?.projectId?.trim() || null;
  const workspaceId = ref?.workspaceId?.trim() || null;
  const userInput = ref?.userInput?.trim() || null;
  const slots = normalizeStringRecord(ref?.slots);

  if (!skillId && !skillKey) {
    return null;
  }

  return {
    skillId,
    skillKey,
    projectId,
    workspaceId,
    userInput,
    slots,
  };
}

export function buildSceneAppWorkbenchStatItems(
  descriptors: SceneAppDescriptor[],
): SceneAppWorkbenchStatItem[] {
  const uniqueTypes = new Set(
    descriptors.map(
      (descriptor) =>
        resolveSceneAppTypePresentation(descriptor.sceneappType).label,
    ),
  ).size;
  const uniqueInfraCount = new Set(
    descriptors.flatMap((descriptor) =>
      collectSceneAppInfraPresentationLabels(descriptor.infraProfile),
    ),
  ).size;
  const durableCount = descriptors.filter(
    (descriptor) => descriptor.sceneappType === "local_durable",
  ).length;

  return [
    {
      key: "catalog-count",
      label: "目录场景",
      value: descriptors.length,
      description: "当前基础设置包已经能下发的 SceneApp 数量。",
    },
    {
      key: "type-count",
      label: "运行形态",
      value: uniqueTypes,
      description: "本地即时、浏览器、持续运行与多能力做法都在同一目录里。",
    },
    {
      key: "infra-count",
      label: "基础设施",
      value: uniqueInfraCount,
      description: "组合蓝图、浏览器、自动化、项目沉淀都在复用统一能力面。",
    },
    {
      key: "durable-count",
      label: "持续场景",
      value: durableCount,
      description: "适合每日简报、监控和回流类业务的 durable SceneApp。",
    },
  ];
}

export function buildSceneAppCatalogCardViewModel(params: {
  descriptor: SceneAppDescriptor;
  scorecard?: SceneAppScorecard | null;
  run?: SceneAppRunSummary | null;
}): SceneAppCatalogCardViewModel {
  const { descriptor, scorecard, run } = params;
  const copy = getSceneAppPresentationCopy(descriptor);
  const operatingSummary = buildSceneAppOperatingSummaryViewModel({
    descriptor,
    scorecard: scorecard ?? null,
    run: run ?? null,
  });
  const latestRunLabel = run
    ? `最近结果：${getSceneAppRunSourceLabel(run.source)} · ${formatSceneAppDateTime(
        run.finishedAt ?? run.startedAt,
      )}`
    : undefined;

  return {
    id: descriptor.id,
    title: descriptor.title,
    businessLabel: copy.businessLabel,
    typeLabel: getSceneAppTypeLabel(descriptor.sceneappType),
    deliveryContractLabel: getSceneAppDeliveryContractLabel(
      descriptor.deliveryContract,
    ),
    valueStatement: copy.valueStatement,
    summary: descriptor.summary,
    outputHint: descriptor.outputHint,
    patternSummary: getSceneAppPatternSummary(descriptor),
    infraSummary: getSceneAppInfraSummary(descriptor),
    status: operatingSummary.status,
    statusLabel: operatingSummary.statusLabel,
    operatingSummary: operatingSummary.summary,
    latestRunLabel,
    scorecardActionLabel: operatingSummary.scorecardActionLabel,
    topFailureSignalLabel: operatingSummary.topFailureSignalLabel,
    scorecardAggregate: buildSceneAppScorecardAggregateViewModel({
      descriptor,
      scorecard: scorecard ?? null,
      run: run ?? null,
    }),
    actionLabel: copy.actionLabel,
  };
}

export function buildSceneAppDetailViewModel(params: {
  descriptor: SceneAppDescriptor;
  entryCard: SceneAppEntryCardItem | null;
  launchSeed: SceneAppSeed | null;
  planResult?: SceneAppPlanResult | null;
}): SceneAppDetailViewModel {
  const { descriptor, entryCard, launchSeed, planResult } = params;
  const copy = getSceneAppPresentationCopy(descriptor);
  const executionChainLabel = Array.from(
    new Set(
      descriptor.entryBindings.map(
        (binding) =>
          BINDING_FAMILY_LABELS[binding.bindingFamily] ?? binding.bindingFamily,
      ),
    ),
  ).join(" · ");
  const deliveryRequiredParts = buildLabeledItems(
    descriptor.deliveryProfile?.requiredParts,
    DELIVERY_PART_LABELS,
  );
  const scorecardMetricKeys = buildLabeledItems(
    descriptor.scorecardProfile?.metricKeys,
    SCORECARD_SIGNAL_LABELS,
  );
  const scorecardFailureSignals = buildLabeledItems(
    descriptor.scorecardProfile?.failureSignals,
    SCORECARD_SIGNAL_LABELS,
  );
  const compositionSteps = buildCompositionStepViewModels(descriptor);
  const projectPackPlanPresentation = buildProjectPackPlanPresentation({
    descriptor,
    projectPackPlan: planResult?.projectPackPlan,
  });
  const contextBaseline = buildContextBaselinePresentation(
    planResult?.contextOverlay,
  );
  const planning: SceneAppPlanningViewModel = planResult
    ? {
        statusLabel: planResult.readiness.ready
          ? "已就绪"
          : `待补 ${planResult.readiness.unmetRequirements.length} 项`,
        summary: planResult.readiness.ready
          ? `当前这次输入已经能进入 ${
              BINDING_FAMILY_LABELS[planResult.plan.executorKind] ??
              humanizeTokenLabel(planResult.plan.executorKind)
            }，并沿 ${getSceneAppDeliveryContractLabel(
              planResult.plan.artifactContract,
            )} 主链继续交付。`
          : `当前预规划已生成，但还有 ${planResult.readiness.unmetRequirements.length} 项前置待补齐；补齐后会继续沿 ${
              BINDING_FAMILY_LABELS[planResult.plan.executorKind] ??
              humanizeTokenLabel(planResult.plan.executorKind)
            } 执行。`,
        warnings: dedupeNonEmptyLines(planResult.plan.warnings),
        unmetRequirements: planResult.readiness.unmetRequirements.map(
          (requirement) => requirement.message,
        ),
      }
    : {
        statusLabel: "待生成",
        summary:
          "当前还没有根据项目与启动输入生成执行预规划；补齐输入后会自动刷新。",
        warnings: [],
        unmetRequirements: [],
      };
  const contextPlan =
    planResult?.contextOverlay && contextBaseline
      ? {
          ...contextBaseline,
          activeLayers: buildLabeledItems(
            planResult.contextOverlay.compilerPlan.activeLayers,
            CONTEXT_LAYER_LABELS,
          ),
          skillRefs: buildContextRefItems(
            planResult.contextOverlay.snapshot.skillRefs,
          ),
          referenceCount: planResult.contextOverlay.compilerPlan.referenceCount,
          memoryRefs: buildContextRefItems(
            planResult.contextOverlay.snapshot.memoryRefs.length > 0
              ? planResult.contextOverlay.snapshot.memoryRefs
              : planResult.contextOverlay.compilerPlan.memoryRefs,
          ),
          toolRefs: buildContextRefItems(
            planResult.contextOverlay.snapshot.toolRefs.length > 0
              ? planResult.contextOverlay.snapshot.toolRefs
              : planResult.contextOverlay.compilerPlan.toolRefs,
          ),
          notes: dedupeNonEmptyLines(
            planResult.contextOverlay.compilerPlan.notes,
          ),
        }
      : null;
  const projectPackPlan = planResult?.projectPackPlan
    ? {
        ...projectPackPlanPresentation,
        packKindLabel:
          projectPackPlanPresentation.packKindLabel ??
          getSceneAppDeliveryContractLabel(planResult.projectPackPlan.packKind),
        completionStrategyLabel:
          projectPackPlanPresentation.completionStrategyLabel ??
          PROJECT_PACK_COMPLETION_LABELS[
            planResult.projectPackPlan.completionStrategy
          ] ??
          humanizeTokenLabel(planResult.projectPackPlan.completionStrategy),
      }
    : null;

  return {
    id: descriptor.id,
    title: descriptor.title,
    summary: descriptor.summary,
    businessLabel: copy.businessLabel,
    typeLabel: getSceneAppTypeLabel(descriptor.sceneappType),
    deliveryContractLabel: getSceneAppDeliveryContractLabel(
      descriptor.deliveryContract,
    ),
    valueStatement: copy.valueStatement,
    outputHint: descriptor.outputHint,
    executionChainLabel,
    sourcePackageId: descriptor.sourcePackageId,
    sourcePackageVersion: descriptor.sourcePackageVersion,
    patternLabels: descriptor.patternStack.map((pattern) =>
      getSceneAppPatternLabel(pattern),
    ),
    launchRequirements: descriptor.launchRequirements.map(
      (requirement) => requirement.message,
    ),
    launchInputPlaceholder: copy.fallbackPrompt,
    launchSeedLabel:
      launchSeed?.sourceLabel ?? "当前这套做法还需要更明确的启动信息",
    launchSeedPreview:
      launchSeed?.sourcePreview ?? "例如补一个 URL，或明确要追踪的主题与目标。",
    launchActionLabel: entryCard?.actionLabel ?? copy.actionLabel,
    artifactProfileRef: descriptor.deliveryProfile?.artifactProfileRef,
    deliveryViewerLabel: getSceneAppViewerKindLabel(
      descriptor.deliveryProfile?.viewerKind,
    ),
    deliveryNarrative: buildSceneAppDeliveryNarrative(descriptor),
    deliveryPrimaryPart:
      descriptor.deliveryProfile?.primaryPart &&
      (DELIVERY_PART_LABELS[descriptor.deliveryProfile.primaryPart] ??
        humanizeTokenLabel(descriptor.deliveryProfile.primaryPart)),
    deliveryRequiredParts,
    compositionBlueprintRef: descriptor.compositionProfile?.blueprintRef,
    compositionStepCount: descriptor.compositionProfile?.stepCount ?? 0,
    compositionSteps,
    planning,
    contextPlan,
    projectPackPlan,
    scorecardProfileRef: descriptor.scorecardProfile?.profileRef,
    scorecardMetricKeys,
    scorecardFailureSignals,
    scorecardNarrative: buildSceneAppScorecardNarrative(descriptor),
  };
}

export function buildSceneAppExecutionSummaryViewModel(params: {
  descriptor: SceneAppDescriptor;
  planResult: SceneAppPlanResult;
}): SceneAppExecutionSummaryViewModel {
  const detailView = buildSceneAppDetailViewModel({
    descriptor: params.descriptor,
    entryCard: null,
    launchSeed: null,
    planResult: params.planResult,
  });

  return {
    sceneappId: detailView.id,
    title: detailView.title,
    summary: detailView.summary,
    businessLabel: detailView.businessLabel,
    typeLabel: detailView.typeLabel,
    executionChainLabel: detailView.executionChainLabel,
    deliveryContractLabel: detailView.deliveryContractLabel,
    planningStatusLabel: detailView.planning.statusLabel,
    planningSummary: detailView.planning.summary,
    activeLayers: detailView.contextPlan?.activeLayers ?? [],
    referenceCount: detailView.contextPlan?.referenceCount ?? 0,
    referenceItems: detailView.contextPlan?.referenceItems ?? [],
    tasteSummary: detailView.contextPlan?.tasteSummary,
    feedbackSummary: detailView.contextPlan?.feedbackSummary,
    projectPackPlan: detailView.projectPackPlan,
    scorecardProfileRef: detailView.scorecardProfileRef,
    scorecardMetricKeys: detailView.scorecardMetricKeys,
    scorecardFailureSignals: detailView.scorecardFailureSignals,
    scorecardAggregate: buildSceneAppScorecardAggregateViewModel({
      descriptor: params.descriptor,
      scorecard: null,
      run: null,
      planResult: params.planResult,
    }),
    notes: dedupeNonEmptyLines([
      ...detailView.planning.warnings,
      ...(detailView.contextPlan?.notes ?? []),
      ...(detailView.projectPackPlan?.notes ?? []),
    ]),
    descriptorSnapshot: {
      deliveryContract: params.descriptor.deliveryContract,
      deliveryProfile: params.descriptor.deliveryProfile,
      linkedServiceSkillId: params.descriptor.linkedServiceSkillId,
      linkedSceneKey: params.descriptor.linkedSceneKey,
    },
    runtimeBackflow: null,
  };
}

function resolveSceneAppExecutionSummaryDeliveryContract(
  summary: SceneAppExecutionSummaryViewModel,
): SceneAppDeliveryContract {
  if (summary.descriptorSnapshot?.deliveryContract) {
    return summary.descriptorSnapshot.deliveryContract;
  }

  switch (summary.deliveryContractLabel) {
    case "结果包":
      return "artifact_bundle";
    case "表格报告":
      return "table_report";
    case "项目资料包":
    default:
      return "project_pack";
  }
}

export function buildSceneAppExecutionSummaryRunDetailViewModel(params: {
  summary: SceneAppExecutionSummaryViewModel;
  run: SceneAppRunSummary;
}): SceneAppRunDetailViewModel {
  const requiredParts = dedupeNonEmptyLines([
    ...(params.summary.descriptorSnapshot?.deliveryProfile?.requiredParts ??
      []),
    ...(params.run.deliveryRequiredParts ?? []),
  ]);
  const detailView = buildSceneAppRunDetailViewModel({
    descriptor: {
      title: params.summary.title,
      deliveryContract: resolveSceneAppExecutionSummaryDeliveryContract(
        params.summary,
      ),
      deliveryProfile: {
        ...params.summary.descriptorSnapshot?.deliveryProfile,
        requiredParts,
      },
    },
    run: params.run,
  });

  return {
    ...detailView,
    packCompletionStrategyLabel:
      detailView.packCompletionStrategyLabel ??
      params.summary.projectPackPlan?.completionStrategyLabel,
    packViewerLabel:
      detailView.packViewerLabel ?? params.summary.projectPackPlan?.viewerLabel,
    plannedDeliveryRequiredParts:
      detailView.plannedDeliveryRequiredParts.length > 0
        ? detailView.plannedDeliveryRequiredParts
        : (params.summary.projectPackPlan?.requiredParts ?? []),
    packPlanNotes:
      detailView.packPlanNotes.length > 0
        ? detailView.packPlanNotes
        : (params.summary.projectPackPlan?.notes ?? []),
  };
}

function resolveSceneAppExecutionRuntimeTone(params: {
  run: SceneAppRunSummary;
  scorecard?: SceneAppScorecard | null;
}): SceneAppExecutionRuntimeBackflowViewModel["statusTone"] {
  const { run, scorecard } = params;
  const hasRisk =
    run.status === "error" ||
    run.status === "timeout" ||
    run.failureSignal === "review_blocked" ||
    run.failureSignal === "publish_stalled" ||
    (run.artifactValidatorIssueCount ?? 0) > 0 ||
    (run.verificationFailureOutcomes?.length ?? 0) > 0 ||
    scorecard?.recommendedAction === "retire";
  if (hasRisk) {
    return "risk";
  }

  const hasWatchSignal =
    run.status === "queued" ||
    run.status === "running" ||
    run.status === "canceled" ||
    run.requestTelemetryAvailable === false ||
    (run.evidenceKnownGaps?.length ?? 0) > 0 ||
    (run.deliveryMissingParts?.length ?? 0) > 0 ||
    scorecard?.recommendedAction === "optimize";
  if (hasWatchSignal) {
    return run.status === "queued" || run.status === "running"
      ? "accent"
      : "watch";
  }

  if (run.status === "success") {
    return "success";
  }

  return "default";
}

function buildSceneAppExecutionRuntimeBackflowViewModel(params: {
  title: string;
  run: SceneAppRunSummary;
  scorecard?: SceneAppScorecard | null;
}): SceneAppExecutionRuntimeBackflowViewModel {
  const { title, run, scorecard } = params;
  const delivery = buildRunDeliveryPresentation(run);
  const scorecardActionLabel = scorecard
    ? getSceneAppScorecardActionLabel(scorecard.recommendedAction)
    : undefined;
  const fallbackNextAction = scorecardActionLabel
    ? `${scorecardActionLabel}，并继续把这轮运行沉淀到判断与选品基线。`
    : "继续把这轮运行沉淀到判断与选品基线。";
  const evidenceSourceLabel = !run.runtimeEvidenceUsed
    ? "当前仍使用运行摘要回退"
    : run.requestTelemetryAvailable === false
      ? "已接通会话证据，遥测仍待补齐"
      : "当前已接入会话证据";

  return {
    runId: run.runId,
    statusLabel: getSceneAppRunStatusLabel(run.status),
    statusTone: resolveSceneAppExecutionRuntimeTone({
      run,
      scorecard,
    }),
    summary: buildRunSummaryText({
      descriptorTitle: title,
      run,
      delivery,
    }),
    nextAction: buildRunNextAction(run, fallbackNextAction, delivery),
    sourceLabel: getSceneAppRunSourceLabel(run.source),
    deliveryCompletionLabel: delivery.completionLabel,
    evidenceSourceLabel,
    startedAtLabel: formatSceneAppDateTime(run.startedAt),
    finishedAtLabel: formatSceneAppDateTime(run.finishedAt),
    scorecardActionLabel,
    topFailureSignalLabel: getFailureSignalLabel(
      scorecard?.topFailureSignal ?? run.failureSignal,
    ),
    deliveryCompletedParts: delivery.completedParts,
    deliveryMissingParts: delivery.missingParts,
    observedFailureSignals: buildLabeledItems(
      buildRuntimeFeedbackSignals(run, scorecard),
      SCORECARD_SIGNAL_LABELS,
    ),
    governanceArtifacts: buildPlainLabelItems(
      (run.governanceArtifactRefs ?? []).map((artifact) =>
        getSceneAppGovernanceArtifactKindLabel(artifact.kind),
      ),
    ),
  };
}

export function backfillSceneAppExecutionSummaryViewModel(params: {
  summary: SceneAppExecutionSummaryViewModel;
  run?: SceneAppRunSummary | null;
  scorecard?: SceneAppScorecard | null;
}): SceneAppExecutionSummaryViewModel {
  const runtimeBackflow = params.run
    ? buildSceneAppExecutionRuntimeBackflowViewModel({
        title: params.summary.title,
        run: params.run,
        scorecard: params.scorecard,
      })
    : null;

  return {
    ...params.summary,
    scorecardAggregate: buildSceneAppScorecardAggregateViewModel({
      descriptor: {
        title: params.summary.title,
        deliveryContract: resolveSceneAppExecutionSummaryDeliveryContract(
          params.summary,
        ),
        deliveryProfile: params.summary.descriptorSnapshot?.deliveryProfile,
        scorecardProfile:
          params.summary.scorecardProfileRef ||
          params.summary.scorecardMetricKeys.length > 0 ||
          params.summary.scorecardFailureSignals.length > 0
            ? {
                profileRef: params.summary.scorecardProfileRef,
                metricKeys: params.summary.scorecardMetricKeys.map(
                  (item) => item.key,
                ),
                failureSignals: params.summary.scorecardFailureSignals.map(
                  (item) => item.key,
                ),
              }
            : undefined,
      },
      scorecard: params.scorecard ?? null,
      run: params.run ?? null,
    }),
    runtimeBackflow,
  };
}

export function buildSceneAppScorecardViewModel(params: {
  descriptor: SceneAppDescriptor | null;
  scorecard: SceneAppScorecard | null;
  run?: SceneAppRunSummary | null;
  planResult?: Pick<
    SceneAppPlanResult,
    "projectPackPlan" | "contextOverlay"
  > | null;
}): SceneAppScorecardViewModel | null {
  const { descriptor, scorecard, run = null } = params;
  if (!descriptor && !scorecard) {
    return null;
  }

  const projectPackPlan = buildProjectPackPlanPresentation({
    descriptor,
    projectPackPlan: params.planResult?.projectPackPlan,
  });
  const contextBaseline = buildContextBaselinePresentation(
    params.planResult?.contextOverlay,
    {
      scorecard,
    },
  );

  if (!scorecard) {
    return {
      hasRuntimeScorecard: false,
      aggregate: buildSceneAppScorecardAggregateViewModel({
        descriptor,
        scorecard,
        run,
        planResult: params.planResult,
      }),
      profileRef: descriptor?.scorecardProfile?.profileRef,
      metricKeys: buildLabeledItems(
        descriptor?.scorecardProfile?.metricKeys,
        SCORECARD_SIGNAL_LABELS,
      ),
      failureSignals: buildLabeledItems(
        descriptor?.scorecardProfile?.failureSignals,
        SCORECARD_SIGNAL_LABELS,
      ),
      observedFailureSignals: [],
      topFailureSignalLabel: undefined,
      deliveryContractLabel: descriptor
        ? getSceneAppDeliveryContractLabel(descriptor.deliveryContract)
        : undefined,
      viewerLabel: projectPackPlan.viewerLabel,
      completionStrategyLabel: projectPackPlan.completionStrategyLabel,
      deliveryRequiredParts: projectPackPlan.requiredParts,
      packPlanNotes: projectPackPlan.notes,
      contextBaseline,
      operatingNarrative: descriptor
        ? buildSceneAppScorecardNarrative(descriptor)
        : "当前还没有明确的经营口径。",
      summary: descriptor?.scorecardProfile?.profileRef
        ? "当前先按基础设置包里的评分口径建立观察面，等待首批真实运行样本回流。"
        : "当前还没有评分数据，先跑一次结果链再看表现。",
      metrics: [],
    };
  }

  return {
    hasRuntimeScorecard: true,
    aggregate: buildSceneAppScorecardAggregateViewModel({
      descriptor,
      scorecard,
      run,
      planResult: params.planResult,
    }),
    profileRef: descriptor?.scorecardProfile?.profileRef,
    metricKeys: buildLabeledItems(
      descriptor?.scorecardProfile?.metricKeys,
      SCORECARD_SIGNAL_LABELS,
    ),
    failureSignals: buildLabeledItems(
      descriptor?.scorecardProfile?.failureSignals,
      SCORECARD_SIGNAL_LABELS,
    ),
    observedFailureSignals: buildLabeledItems(
      scorecard.observedFailureSignals,
      SCORECARD_SIGNAL_LABELS,
    ),
    topFailureSignalLabel: getFailureSignalLabel(scorecard.topFailureSignal),
    deliveryContractLabel: descriptor
      ? getSceneAppDeliveryContractLabel(descriptor.deliveryContract)
      : undefined,
    viewerLabel: projectPackPlan.viewerLabel,
    completionStrategyLabel: projectPackPlan.completionStrategyLabel,
    deliveryRequiredParts: projectPackPlan.requiredParts,
    packPlanNotes: projectPackPlan.notes,
    contextBaseline,
    operatingNarrative: descriptor
      ? buildSceneAppScorecardNarrative(descriptor)
      : "当前先按真实运行数据判断这个场景是否值得继续投入。",
    actionLabel: getSceneAppScorecardActionLabel(scorecard.recommendedAction),
    summary: scorecard.summary,
    metrics: scorecard.metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: metric.value,
      status: metric.status,
    })),
  };
}

export function buildSceneAppRunListItemViewModel(
  run: SceneAppRunSummary,
): SceneAppRunListItemViewModel {
  const delivery = buildRunDeliveryPresentation(run);
  return {
    runId: run.runId,
    status: run.status,
    statusLabel: getSceneAppRunStatusLabel(run.status),
    summary: buildRunSummaryText({
      descriptorTitle: "",
      run,
      delivery,
    }),
    sourceLabel: getSceneAppRunSourceLabel(run.source),
    artifactCount: run.artifactCount,
    deliveryLabel: delivery.deliveryLabel,
    failureSignalLabel: delivery.failureSignalLabel,
    startedAtLabel: formatSceneAppDateTime(run.startedAt),
    finishedAtLabel: formatSceneAppDateTime(run.finishedAt),
  };
}

export function buildSceneAppRunDetailViewModel(params: {
  descriptor: Pick<
    SceneAppDescriptor,
    "title" | "deliveryContract" | "deliveryProfile"
  >;
  run: SceneAppRunSummary;
  planResult?: Pick<
    SceneAppPlanResult,
    "projectPackPlan" | "contextOverlay"
  > | null;
}): SceneAppRunDetailViewModel {
  const delivery = buildRunDeliveryPresentation(params.run);
  const projectPackPlan = buildProjectPackPlanPresentation({
    descriptor: params.descriptor,
    projectPackPlan: params.planResult?.projectPackPlan,
  });
  const contextBaseline = buildContextBaselinePresentation(
    params.planResult?.contextOverlay,
    {
      run: params.run,
    },
  );
  const deliveryArtifactEntries = buildRunDeliveryArtifactEntries(params);
  const governanceActionEntries = buildRunGovernanceActionEntries(params.run);
  const governanceArtifactEntries = buildRunGovernanceArtifactEntries(
    params.run,
  );
  const evidence = buildRunEvidencePresentation(params);
  const insight = getSceneAppRunInsight({
    run: params.run,
    descriptorTitle: params.descriptor.title,
  });

  return {
    runId: params.run.runId,
    status: params.run.status,
    statusLabel: getSceneAppRunStatusLabel(params.run.status),
    stageLabel: insight.stageLabel,
    summary: buildRunSummaryText({
      descriptorTitle: params.descriptor.title,
      run: params.run,
      delivery,
    }),
    nextAction: buildRunNextAction(params.run, insight.nextAction, delivery),
    sourceLabel: getSceneAppRunSourceLabel(params.run.source),
    artifactCount: params.run.artifactCount,
    deliveryCompletionLabel: delivery.completionLabel,
    deliverySummary: delivery.summary,
    deliveryRequiredParts: delivery.requiredParts,
    deliveryCompletedParts: delivery.completedParts,
    deliveryMissingParts: delivery.missingParts,
    deliveryPartCoverageKnown: delivery.partCoverageKnown,
    deliveryViewerLabel: evidence.deliveryViewerLabel,
    packCompletionStrategyLabel: projectPackPlan.completionStrategyLabel,
    packViewerLabel: projectPackPlan.viewerLabel,
    plannedDeliveryRequiredParts: projectPackPlan.requiredParts,
    packPlanNotes: projectPackPlan.notes,
    contextBaseline,
    deliveryArtifactEntries,
    governanceActionEntries,
    governanceArtifactEntries,
    failureSignalLabel: delivery.failureSignalLabel,
    evidenceSourceLabel: evidence.evidenceSourceLabel,
    requestTelemetryLabel: evidence.requestTelemetryLabel,
    artifactValidatorLabel: evidence.artifactValidatorLabel,
    evidenceKnownGaps: evidence.knownGaps,
    verificationFailureOutcomes: evidence.verificationFailureOutcomes,
    startedAtLabel: formatSceneAppDateTime(params.run.startedAt),
    finishedAtLabel: formatSceneAppDateTime(params.run.finishedAt),
    durationLabel: formatSceneAppDuration(params.run),
    entryAction: resolveSceneAppRunEntryAction(params),
  };
}

function buildSceneAppGovernanceDestinations(params: {
  detailView: SceneAppRunDetailViewModel | null;
  run: SceneAppRunSummary | null;
}): SceneAppGovernancePanelDestinationViewModel[] {
  const { detailView, run } = params;
  if (!detailView || !run) {
    return [
      {
        key: "first-run",
        label: "首轮试跑",
        description:
          "先跑出一轮结果、证据摘要和复核结论，再决定接下来怎么推进。",
      },
    ];
  }

  const destinations: SceneAppGovernancePanelDestinationViewModel[] = [];
  const actionKeys = new Set(
    detailView.governanceActionEntries.map((entry) => entry.key),
  );
  const artifactKinds = new Set(
    detailView.governanceArtifactEntries.map((entry) => entry.artifactRef.kind),
  );

  if (
    actionKeys.has("weekly-review-pack") ||
    (artifactKinds.has("evidence_summary") &&
      artifactKinds.has("review_decision_markdown"))
  ) {
    destinations.push({
      key: "weekly-review",
      label: "看结果",
      description:
        "把证据摘要和人工复核记录一起带回来回看这轮结果，方便快速判断卡点、结论和下一步。",
    });
  }

  if (
    actionKeys.has("structured-governance-pack") ||
    artifactKinds.has("review_decision_json")
  ) {
    destinations.push({
      key: "task-center",
      label: "生成",
      description: "结果记录已经适合继续被生成、结果统计或后续持续流程消费。",
    });
  }

  if (detailView.entryAction?.kind === "open_automation_job") {
    destinations.push({
      key: "automation-job",
      label: "持续流程",
      description:
        "这套做法已接到持续任务，可回到持续流程查看历史、频率和交付状态。",
    });
  }

  if (detailView.deliveryArtifactEntries.length > 0) {
    destinations.push({
      key: "delivery-editing",
      label: "结果编辑 / 发布",
      description:
        "当前结果文件已经可直接打开，适合继续编辑、复核或进入发布动作。",
    });
  }

  return destinations;
}

function buildSceneAppGovernanceStatusItems(params: {
  run: SceneAppRunSummary | null;
  detailView: SceneAppRunDetailViewModel | null;
}): SceneAppGovernancePanelStatusItemViewModel[] {
  const { run, detailView } = params;
  if (!run || !detailView) {
    return [
      {
        key: "weekly-pack",
        label: "结果材料",
        value: "待首轮样本",
        description:
          "还没有可继续判断的运行样本，结果材料会在首轮运行后自动形成。",
        tone: "idle",
      },
      {
        key: "structured-pack",
        label: "结果记录",
        value: "待首轮样本",
        description:
          "先跑出一轮结果，后续才能判断这套做法是否适合被生成页和看板继续消费。",
        tone: "idle",
      },
      {
        key: "request-chain",
        label: "请求链路",
        value: "尚未建立",
        description:
          "当前还没有会话级请求与证据样本，暂时没法看成本和调用表现。",
        tone: "idle",
      },
      {
        key: "artifact-check",
        label: "结果校验",
        value: "待首轮样本",
        description:
          "先让这套做法产出第一份结果，再判断交付件是否可直接进入后续发布。",
        tone: "idle",
      },
    ];
  }

  const artifactKinds = new Set(
    detailView.governanceArtifactEntries.map((entry) => entry.artifactRef.kind),
  );
  const weeklyPackReady =
    artifactKinds.has("evidence_summary") &&
    artifactKinds.has("review_decision_markdown");
  const structuredPackReady =
    weeklyPackReady && artifactKinds.has("review_decision_json");
  const validatorIssueCount = run.artifactValidatorIssueCount ?? 0;
  const recoveredCount = run.artifactValidatorRecoveredCount ?? 0;
  const telemetryMatchedCount = run.requestTelemetryMatchedCount ?? 0;

  return [
    {
      key: "weekly-pack",
      label: "结果材料",
      value: weeklyPackReady ? "已齐" : "待补齐",
      description: weeklyPackReady
        ? "证据摘要和人工复核记录都已经可直接打开，适合继续看结果。"
        : "继续判断前建议先补齐证据摘要和人工复核记录，避免临时补材料。",
      tone: weeklyPackReady ? "good" : "watch",
    },
    {
      key: "structured-pack",
      label: "结果记录",
      value: structuredPackReady ? "已齐" : "待补齐",
      description: structuredPackReady
        ? "复核 JSON 已经就绪，后续可以继续用于生成、结果统计或持续流程。"
        : "如果要做结果统计、任务编排或后续持续流程，先把结果记录补齐。",
      tone: structuredPackReady ? "good" : "watch",
    },
    {
      key: "request-chain",
      label: "请求链路",
      value: !run.runtimeEvidenceUsed
        ? "摘要回退"
        : run.requestTelemetryAvailable === false
          ? "暂缺遥测"
          : telemetryMatchedCount > 0
            ? `已关联 ${telemetryMatchedCount} 条`
            : "已接通待匹配",
      description: !run.runtimeEvidenceUsed
        ? "当前还没有接到会话证据，只能按运行摘要回退，暂时不适合做精细判断。"
        : detailView.requestTelemetryLabel,
      tone: !run.runtimeEvidenceUsed
        ? "risk"
        : run.requestTelemetryAvailable === false
          ? "watch"
          : "good",
    },
    {
      key: "artifact-check",
      label: "结果校验",
      value: !run.runtimeEvidenceUsed
        ? "待接入"
        : run.artifactValidatorApplicable === false
          ? "当前无需额外校验"
          : validatorIssueCount > 0
            ? `仍有 ${validatorIssueCount} 条问题`
            : recoveredCount > 0
              ? `已恢复 ${recoveredCount} 项`
              : "无阻塞问题",
      description: detailView.artifactValidatorLabel,
      tone: !run.runtimeEvidenceUsed
        ? "watch"
        : validatorIssueCount > 0
          ? "risk"
          : "good",
    },
  ];
}

export function buildSceneAppGovernancePanelViewModel(params: {
  descriptor: SceneAppDescriptor;
  scorecard: SceneAppScorecard | null;
  run: SceneAppRunSummary | null;
  planResult?: Pick<
    SceneAppPlanResult,
    "projectPackPlan" | "contextOverlay"
  > | null;
}): SceneAppGovernancePanelViewModel {
  const { descriptor, scorecard, run } = params;
  const detailView = run
    ? buildSceneAppRunDetailViewModel({
        descriptor,
        run,
        planResult: params.planResult,
      })
    : null;
  const statusItems = buildSceneAppGovernanceStatusItems({
    run,
    detailView,
  });
  const operatingSummary = buildSceneAppOperatingSummaryViewModel({
    descriptor,
    scorecard,
    run,
    planResult: params.planResult,
  });
  const contextBaseline = buildContextBaselinePresentation(
    params.planResult?.contextOverlay,
    {
      run,
      scorecard,
    },
  );

  return {
    ...operatingSummary,
    latestRunLabel: detailView
      ? `最近结果：${detailView.sourceLabel} · ${detailView.finishedAtLabel}`
      : "最近结果：尚未开始",
    contextBaseline,
    statusItems,
    governanceActionEntries: detailView?.governanceActionEntries ?? [],
    governanceArtifactEntries: detailView?.governanceArtifactEntries ?? [],
    entryAction: detailView?.entryAction ?? null,
  };
}

export function buildSceneAppOperatingSummaryViewModel(params: {
  descriptor: Pick<
    SceneAppDescriptor,
    "title" | "deliveryContract" | "deliveryProfile" | "scorecardProfile"
  >;
  scorecard: SceneAppScorecard | null;
  run: SceneAppRunSummary | null;
  planResult?: Pick<
    SceneAppPlanResult,
    "projectPackPlan" | "contextOverlay"
  > | null;
}): SceneAppOperatingSummaryViewModel {
  const { descriptor, scorecard, run } = params;
  const detailView = run
    ? buildSceneAppRunDetailViewModel({
        descriptor,
        run,
        planResult: params.planResult,
      })
    : null;
  const destinations = buildSceneAppGovernanceDestinations({
    detailView,
    run,
  });
  const scorecardActionLabel = scorecard
    ? getSceneAppScorecardActionLabel(scorecard.recommendedAction)
    : undefined;
  const topFailureSignalLabel = getFailureSignalLabel(
    scorecard?.topFailureSignal ?? run?.failureSignal,
  );

  if (!run || !detailView) {
    return {
      status: "idle",
      statusLabel: "等待首轮运行",
      summary:
        "这套做法还没有首轮结果样本，当前适合先跑出一份正式结果和复核材料。",
      nextAction:
        "先试跑一轮，让结果、证据摘要和复核结论都落下来，再决定是否回到生成继续放大。",
      scorecardActionLabel,
      topFailureSignalLabel,
      destinations,
    };
  }

  const verificationFailureCount =
    detailView.verificationFailureOutcomes.length;
  const validatorIssueCount = run.artifactValidatorIssueCount ?? 0;
  const artifactKinds = new Set(
    detailView.governanceArtifactEntries.map((entry) => entry.artifactRef.kind),
  );
  const weeklyPackReady =
    artifactKinds.has("evidence_summary") &&
    artifactKinds.has("review_decision_markdown");
  const structuredPackReady =
    weeklyPackReady && artifactKinds.has("review_decision_json");
  const governanceMaterialIncomplete =
    !run.runtimeEvidenceUsed ||
    !weeklyPackReady ||
    !structuredPackReady ||
    run.requestTelemetryAvailable === false;
  const hasBlockingIssues =
    run.failureSignal === "review_blocked" ||
    verificationFailureCount > 0 ||
    validatorIssueCount > 0;

  let status: SceneAppOperatingSummaryViewModel["status"] = "good";
  let statusLabel = "结果已可复用";
  let summary =
    "这套做法最近一轮已经带齐结果、证据和结果记录，可以继续进入生成或后续跟进。";
  let nextAction =
    scorecardActionLabel != null
      ? `${scorecardActionLabel}，并把这次结果材料继续沉淀为后续结果跟进与统计的基线。`
      : "继续把这次结果材料沉淀为后续结果跟进、统计和做法筛选的基线。";

  if (scorecard?.recommendedAction === "retire") {
    status = "risk";
    statusLabel = "建议限制投入";
    summary =
      "这套做法当前的经营信号更像是该限制投入，而不是继续扩大曝光或新增长尾入口。";
    nextAction =
      "先补结果记录，把失败信号和复核结论带回结果判断，再决定是重做、降级还是退出主推目录。";
  } else if (hasBlockingIssues) {
    status = "risk";
    statusLabel = "先补复核与修复";
    summary = topFailureSignalLabel
      ? `这套做法最近一轮还没形成可直接放大的结果闭环，当前主要卡在${topFailureSignalLabel}。`
      : "这套做法最近一轮还没形成可直接放大的结果闭环，当前仍有复核或结果质量问题需要先处理。";
    nextAction =
      "优先补结果材料，补齐复核结论、结果校验问题或验证失败项，再决定是否继续放大这套做法。";
  } else if (governanceMaterialIncomplete) {
    status = "watch";
    statusLabel = "先补结果材料";
    summary =
      "这套做法已有可继续判断的运行结果，但生成和后续跟进要用的结果材料还没完全齐，暂时不适合直接放大。";
    nextAction =
      "先补结果记录，把证据摘要、复核记录和结构化 JSON 一次补齐，再继续进入生成或统计面。";
  }

  return {
    status,
    statusLabel,
    summary,
    nextAction,
    scorecardActionLabel,
    topFailureSignalLabel,
    destinations,
  };
}

function buildSceneAppFallbackOperatingSummaryViewModel(params: {
  scorecard: SceneAppScorecard | null;
  run: SceneAppRunSummary | null;
}): SceneAppOperatingSummaryViewModel {
  const { scorecard, run } = params;
  const scorecardActionLabel = scorecard
    ? getSceneAppScorecardActionLabel(scorecard.recommendedAction)
    : undefined;
  const topFailureSignalLabel = getFailureSignalLabel(
    scorecard?.topFailureSignal ?? run?.failureSignal,
  );

  if (!run && !scorecard) {
    return {
      status: "idle",
      statusLabel: "等待首轮运行",
      summary: "当前还没有可判断的结果样本，先跑出第一轮结果再看经营判断。",
      nextAction: "先跑出一轮结果，后续再决定是否回到生成或继续放大。",
      scorecardActionLabel,
      topFailureSignalLabel,
      destinations: [],
    };
  }

  if (scorecard?.recommendedAction === "retire") {
    return {
      status: "risk",
      statusLabel: "建议限制投入",
      summary: "当前经营信号更偏向限制投入，先不要继续扩大这套做法的曝光。",
      nextAction:
        "先把失败信号和复核结论沉淀成结构化材料，再决定是重做、降级还是退出主推。",
      scorecardActionLabel,
      topFailureSignalLabel,
      destinations: [],
    };
  }

  if (
    run?.status === "error" ||
    run?.status === "timeout" ||
    topFailureSignalLabel
  ) {
    return {
      status: "risk",
      statusLabel: "先补复核与修复",
      summary: topFailureSignalLabel
        ? `当前主要卡在${topFailureSignalLabel}，暂时不适合直接放大。`
        : "当前仍有运行或复核问题，暂时不适合直接放大。",
      nextAction: "优先补齐复核与修复动作，再决定是否继续沿当前结果推进。",
      scorecardActionLabel,
      topFailureSignalLabel,
      destinations: [],
    };
  }

  if (run?.status === "queued" || run?.status === "running") {
    return {
      status: "watch",
      statusLabel: "等待当前运行收口",
      summary: "当前这轮还在推进中，经营判断会随结果和结果材料继续更新。",
      nextAction: "先等这轮运行收口，再决定是否继续放大或回到判断。",
      scorecardActionLabel,
      topFailureSignalLabel,
      destinations: [],
    };
  }

  return {
    status: "good",
    statusLabel: "当前可继续复用",
    summary: "当前这轮已经形成可继续消费的样本，可以继续带着结果往下走。",
    nextAction:
      scorecardActionLabel != null
        ? `${scorecardActionLabel}，并继续把这轮结果沉淀成后续判断基线。`
        : "继续把这轮结果沉淀成后续判断基线。",
    scorecardActionLabel,
    topFailureSignalLabel,
    destinations: [],
  };
}

export function buildSceneAppScorecardAggregateViewModel(params: {
  descriptor: Pick<
    SceneAppDescriptor,
    "title" | "deliveryContract" | "deliveryProfile" | "scorecardProfile"
  > | null;
  scorecard: SceneAppScorecard | null;
  run: SceneAppRunSummary | null;
  planResult?: Pick<
    SceneAppPlanResult,
    "projectPackPlan" | "contextOverlay"
  > | null;
}): SceneAppScorecardAggregateViewModel | null {
  const { descriptor, scorecard, run } = params;
  if (!descriptor && !scorecard && !run) {
    return null;
  }

  const operatingSummary = descriptor
    ? buildSceneAppOperatingSummaryViewModel({
        descriptor,
        scorecard,
        run,
        planResult: params.planResult,
      })
    : buildSceneAppFallbackOperatingSummaryViewModel({
        scorecard,
        run,
      });

  return {
    status: operatingSummary.status,
    statusLabel: operatingSummary.statusLabel,
    summary: operatingSummary.summary,
    nextAction: operatingSummary.nextAction,
    actionLabel: operatingSummary.scorecardActionLabel,
    topFailureSignalLabel: operatingSummary.topFailureSignalLabel,
    profileRef: descriptor?.scorecardProfile?.profileRef,
    metricKeys: buildLabeledItems(
      descriptor?.scorecardProfile?.metricKeys,
      SCORECARD_SIGNAL_LABELS,
    ),
    failureSignals: buildLabeledItems(
      descriptor?.scorecardProfile?.failureSignals,
      SCORECARD_SIGNAL_LABELS,
    ),
    observedFailureSignals: buildLabeledItems(
      buildRuntimeFeedbackSignals(run, scorecard),
      SCORECARD_SIGNAL_LABELS,
    ),
    destinations: operatingSummary.destinations,
  };
}

export function buildSceneAppAutomationWorkspaceCardViewModel(params: {
  descriptor: SceneAppDescriptor;
  scorecard: SceneAppScorecard | null;
  run: SceneAppRunSummary | null;
  jobCount: number;
  enabledJobCount: number;
  riskyJobCount: number;
  latestJobName?: string;
  latestJobStatusLabel?: string;
}): SceneAppAutomationWorkspaceCardViewModel {
  const operatingSummary = buildSceneAppOperatingSummaryViewModel({
    descriptor: params.descriptor,
    scorecard: params.scorecard,
    run: params.run,
  });
  const presentationCopy = getSceneAppPresentationCopy(params.descriptor);
  const enabledLabel =
    params.enabledJobCount > 0
      ? `${params.enabledJobCount} 条启用中`
      : "当前未启用自动化";
  const riskLabel =
    params.riskyJobCount > 0
      ? `${params.riskyJobCount} 条带风险提醒`
      : "当前无风险提醒";

  return {
    sceneappId: params.descriptor.id,
    title: params.descriptor.title,
    businessLabel: presentationCopy.businessLabel,
    typeLabel: getSceneAppTypeLabel(params.descriptor.sceneappType),
    patternSummary: getSceneAppPatternSummary(params.descriptor),
    ...operatingSummary,
    scorecardAggregate: buildSceneAppScorecardAggregateViewModel({
      descriptor: params.descriptor,
      scorecard: params.scorecard,
      run: params.run,
    }),
    automationSummary: `${params.jobCount} 条持续流程 · ${enabledLabel} · ${riskLabel}`,
    latestAutomationLabel: params.latestJobName
      ? params.latestJobStatusLabel
        ? `最近运行：${params.latestJobName} · ${params.latestJobStatusLabel}`
        : `最近运行：${params.latestJobName}`
      : "当前还没有已落地的持续流程。",
  };
}
