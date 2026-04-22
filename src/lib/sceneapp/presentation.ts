import type {
  SceneAppCompatType,
  SceneAppCurrentDescriptor as SceneAppDescriptor,
  SceneAppDeliveryContract,
  SceneAppPattern,
  SceneAppRunSummary,
  SceneAppScorecard,
  SceneAppType,
} from "./types";

export type SceneAppEntryTone = "slate" | "sky" | "emerald" | "amber" | "lime";

export interface SceneAppEntryCardItem {
  id: string;
  title: string;
  summary: string;
  businessLabel: string;
  valueStatement: string;
  deliveryLabel: string;
  executionLabel: string;
  executionTone: SceneAppEntryTone;
  patternSummary: string;
  infraSummary: string;
  sourceLabel: string;
  sourcePreview: string;
  actionLabel: string;
  disabledReason?: string;
}

export interface SceneAppPresentationCopy {
  businessLabel: string;
  valueStatement: string;
  actionLabel: string;
  executionLabel: string;
  executionTone: SceneAppEntryTone;
  fallbackPrompt: string;
  requiresExplicitUrl?: boolean;
}

export interface SceneAppSeed {
  userInput: string;
  sourceLabel: string;
  sourcePreview: string;
  slots?: Record<string, string>;
}

export interface SceneAppRunInsight {
  sourceLabel: string;
  stageLabel: string;
  summary: string;
  nextAction: string;
}

export interface SceneAppTypePresentation {
  label: string;
  legacyCompat: boolean;
}

export interface SceneAppInfraPresentation {
  label: string;
  legacyCompat: boolean;
}

type SceneAppPresentedType = SceneAppType | SceneAppCompatType;
type SceneAppCurrentPresentationDescriptor = Pick<
  SceneAppDescriptor,
  "id" | "title" | "sceneappType"
>;

export const FEATURED_SCENEAPP_IDS = [
  "story-video-suite",
  "x-article-export",
  "daily-trend-briefing",
] as const;

const PATTERN_LABELS: Record<SceneAppPattern, string> = {
  pipeline: "步骤链",
  generator: "结果生成",
  reviewer: "质量复核",
  inversion: "先补上下文",
  tool_wrapper: "工具封装",
};

const SCENEAPP_COMPAT_TYPE_LABEL = "目录同步";
const SCENEAPP_COMPAT_INFRA_LABEL = "目录同步";

const INFRA_LABELS: Record<string, string> = {
  composition_blueprint: "组合蓝图",
  workspace_storage: "项目沉淀",
  artifact_bundle: "结果包",
  project_pack: "项目整包",
  timeline: "运行轨迹",
  browser_connector: "真实浏览器",
  site_adapter: "网页适配器",
  automation_schedule: "定时调度",
  db_store: "本地存储",
  json_snapshot: "结果快照",
  document_viewer: "文档查看",
  table_report_viewer: "表格回流",
  browser_assist: "浏览器协助",
  automation_job: "自动化任务",
  agent_turn: "Agent 工作区",
  native_skill: "本机技能",
};

const SCENEAPP_TYPE_LABELS: Record<SceneAppType, string> = {
  local_instant: "本地即时",
  local_durable: "持续运行",
  browser_grounded: "真实浏览器",
  hybrid: "多能力组合",
};

const DELIVERY_CONTRACT_LABELS: Record<SceneAppDeliveryContract, string> = {
  artifact_bundle: "结果包",
  project_pack: "项目资料包",
  table_report: "表格报告",
};

const VIEWER_KIND_LABELS: Record<string, string> = {
  artifact_bundle: "结果包查看",
  document: "文档查看",
  table_report: "表格查看",
};

const SCORECARD_ACTION_LABELS: Record<
  SceneAppScorecard["recommendedAction"],
  string
> = {
  launch: "适合继续启动",
  keep: "建议维持现状",
  optimize: "建议继续优化",
  retire: "建议下线收口",
};

const RUN_STATUS_LABELS: Record<SceneAppRunSummary["status"], string> = {
  queued: "排队中",
  running: "执行中",
  success: "成功",
  error: "失败",
  canceled: "已取消",
  timeout: "超时",
};

const RUN_SOURCE_LABELS: Record<SceneAppRunSummary["source"], string> = {
  chat: "人工试跑",
  skill: "技能触发",
  automation: "自动化调度",
  catalog_seed: "目录样板",
};

const FEATURED_SCENEAPP_PRESETS: Record<string, SceneAppPresentationCopy> = {
  "story-video-suite": {
    businessLabel: "多模态组合",
    valueStatement:
      "从一句主题串起脚本、线框图、配乐方向和短视频草稿。",
    actionLabel: "进入生成",
    executionLabel: "当前会话继续",
    executionTone: "sky",
    fallbackPrompt:
      "请围绕一个产品卖点，生成一版 30 秒短视频方案：先给脚本方向、镜头结构、线框图提示和配乐情绪。",
  },
  "x-article-export": {
    businessLabel: "资料沉淀",
    valueStatement: "把网页正文、图片和元信息沉淀成项目资料包。",
    actionLabel: "进入生成",
    executionLabel: "浏览器上下文",
    executionTone: "amber",
    fallbackPrompt: "请把这个网页导出为项目内可复用的资料包。",
    requiresExplicitUrl: true,
  },
  "daily-trend-briefing": {
    businessLabel: "持续研究",
    valueStatement: "把热点主题变成每天自动回流的观察任务。",
    actionLabel: "配置自动化",
    executionLabel: "持续运行",
    executionTone: "emerald",
    fallbackPrompt:
      "持续关注 AI Agent 产品、云厂商动作和多模态工作流机会，每天回流重点变化、判断和下一步建议。",
  },
};

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function truncateSingleLine(value: string, maxLength = 88): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function summarizeLabels(
  values: string[],
  fallback: string,
): string {
  const labels = Array.from(new Set(values.filter(Boolean))).slice(0, 3);

  return labels.length > 0 ? labels.join(" · ") : fallback;
}

export function resolveSceneAppTypePresentation(
  sceneappType: SceneAppPresentedType,
): SceneAppTypePresentation {
  if (sceneappType === "cloud_managed") {
    return {
      label: SCENEAPP_COMPAT_TYPE_LABEL,
      legacyCompat: true,
    };
  }

  return {
    label: SCENEAPP_TYPE_LABELS[sceneappType],
    legacyCompat: false,
  };
}

export function resolveSceneAppInfraPresentation(
  infraKey: string,
): SceneAppInfraPresentation | null {
  if (infraKey === "cloud_runtime") {
    return {
      label: SCENEAPP_COMPAT_INFRA_LABEL,
      legacyCompat: true,
    };
  }

  const label = INFRA_LABELS[infraKey];
  if (!label) {
    return null;
  }

  return {
    label,
    legacyCompat: false,
  };
}

export function collectSceneAppInfraPresentationLabels(
  infraProfile: string[],
): string[] {
  return Array.from(
    new Set(
      infraProfile
        .map((infraKey) => resolveSceneAppInfraPresentation(infraKey)?.label)
        .filter((label): label is string => Boolean(label)),
    ),
  );
}

function inferFallbackCopy(
  descriptor: SceneAppCurrentPresentationDescriptor,
): SceneAppPresentationCopy {
  if (descriptor.sceneappType === "local_durable") {
    return {
      businessLabel: "持续任务",
      valueStatement: "把重复任务固化成可持续回流的结果链。",
      actionLabel: "配置自动化",
      executionLabel: "持续运行",
      executionTone: "emerald",
      fallbackPrompt: `请启动做法「${descriptor.title}」，并把结果持续回流到当前工作区。`,
    };
  }

  if (descriptor.sceneappType === "browser_grounded") {
    return {
      businessLabel: "浏览器依赖",
      valueStatement: "复用真实网页登录态和网页上下文完成结果链。",
      actionLabel: "进入生成",
      executionLabel: "浏览器上下文",
      executionTone: "amber",
      fallbackPrompt: `请执行做法「${descriptor.title}」，并复用当前浏览器上下文完成任务。`,
    };
  }

  if (descriptor.sceneappType === "hybrid") {
    return {
      businessLabel: "多能力组合",
      valueStatement: "把不同能力编排成一条完整的场景结果链。",
      actionLabel: "进入生成",
      executionLabel: "当前会话继续",
      executionTone: "sky",
      fallbackPrompt: `请执行做法「${descriptor.title}」，并把结果整理成完整交付。`,
    };
  }

  return {
    businessLabel: "即时工作流",
    valueStatement: "在当前工作区里快速完成一次结果交付。",
    actionLabel: "进入生成",
    executionLabel: "当前会话继续",
    executionTone: "slate",
    fallbackPrompt: `请执行做法「${descriptor.title}」，并把结果回写到当前工作区。`,
  };
}

export function getSceneAppPresentationCopy(
  descriptor: SceneAppCurrentPresentationDescriptor,
): SceneAppPresentationCopy {
  return FEATURED_SCENEAPP_PRESETS[descriptor.id] ?? inferFallbackCopy(descriptor);
}

export function getSceneAppPatternLabel(pattern: SceneAppPattern): string {
  return PATTERN_LABELS[pattern];
}

export function getSceneAppPatternSummary(
  descriptor: Pick<SceneAppDescriptor, "patternStack">,
): string {
  return summarizeLabels(
    descriptor.patternStack
      .map((pattern) => PATTERN_LABELS[pattern])
      .filter(Boolean),
    "标准结果链",
  );
}

export function getSceneAppInfraSummary(
  descriptor: Pick<SceneAppDescriptor, "infraProfile">,
): string {
  return summarizeLabels(
    collectSceneAppInfraPresentationLabels(descriptor.infraProfile),
    "当前工作区能力",
  );
}

export function getSceneAppTypeLabel(sceneappType: SceneAppPresentedType): string {
  return resolveSceneAppTypePresentation(sceneappType).label;
}

export function getSceneAppDeliveryContractLabel(
  contract: SceneAppDeliveryContract,
): string {
  return DELIVERY_CONTRACT_LABELS[contract];
}

export function getSceneAppViewerKindLabel(
  viewerKind?: string | null,
): string | undefined {
  if (!viewerKind) {
    return undefined;
  }

  return VIEWER_KIND_LABELS[viewerKind] ?? viewerKind;
}

export function getSceneAppScorecardActionLabel(
  action: SceneAppScorecard["recommendedAction"],
): string {
  return SCORECARD_ACTION_LABELS[action];
}

export function getSceneAppRunStatusLabel(
  status: SceneAppRunSummary["status"],
): string {
  return RUN_STATUS_LABELS[status];
}

export function getSceneAppRunSourceLabel(
  source: SceneAppRunSummary["source"],
): string {
  return RUN_SOURCE_LABELS[source];
}

export function getSceneAppRunInsight(params: {
  run: Pick<SceneAppRunSummary, "artifactCount" | "source" | "status">;
  descriptorTitle?: string | null;
}): SceneAppRunInsight {
  const { run } = params;
  const sourceLabel = getSceneAppRunSourceLabel(run.source);
  const subject = params.descriptorTitle?.trim()
    ? `「${params.descriptorTitle.trim()}」`
    : "这套做法";
  const artifactSummary =
    run.artifactCount > 0
      ? `已回流 ${run.artifactCount} 份结果`
      : "暂时还没有记录到结果";

  const sourceHint =
    run.source === "automation"
      ? "优先检查调度频率、超时和交付设置是否匹配。"
      : run.source === "catalog_seed"
        ? "这条记录主要用来表达目录样板预期，可作为启动参考。"
        : "如果这次试跑有效，下一步可以继续固化成更稳定的做法。";

  switch (run.status) {
    case "queued":
      return {
        sourceLabel,
        stageLabel: "待执行",
        summary: `${subject} 已进入执行队列，${artifactSummary}。`,
        nextAction: "可以稍后刷新，确认资源、调度窗口和依赖能力是否就绪。",
      };
    case "running":
      return {
        sourceLabel,
        stageLabel: "执行中",
        summary: `${subject} 正在推进结果链，${artifactSummary}。`,
        nextAction: "建议等待当前轮完成，再判断是否适合沉淀成稳定模板或自动化。",
      };
    case "success":
      return {
        sourceLabel,
        stageLabel: run.artifactCount > 0 ? "已交付" : "已完成",
        summary: `${subject} 本次运行成功，${artifactSummary}。`,
        nextAction:
          run.artifactCount > 0
            ? "可以直接复盘结果质量，并决定是继续放大、优化还是复制到下一个场景。"
            : "虽然运行已完成，但还需要检查结果回流链路是否完整。",
      };
    case "canceled":
      return {
        sourceLabel,
        stageLabel: "已取消",
        summary: `${subject} 这次运行被主动取消，${artifactSummary}。`,
        nextAction: "回看当时的中断原因，再决定是否要以更明确的输入重新发起。",
      };
    case "timeout":
      return {
        sourceLabel,
        stageLabel: "已超时",
        summary: `${subject} 在执行过程中超时，${artifactSummary}。`,
        nextAction: "优先检查依赖能力是否过重、超时阈值是否过短，以及是否需要拆分步骤链。",
      };
    case "error":
      return {
        sourceLabel,
        stageLabel: "需要排障",
        summary: `${subject} 这次运行未成功完成，${artifactSummary}。`,
        nextAction: `建议先检查启动意图、外部依赖和执行条件。${sourceHint}`,
      };
  }
}

export function resolveSceneAppSeed(params: {
  descriptor: SceneAppDescriptor;
  input: string;
  selectedText?: string;
  urlCandidate?: string | null;
}): SceneAppSeed | null {
  const presentationCopy = getSceneAppPresentationCopy(params.descriptor);
  const normalizedInput = normalizeOptionalText(params.input);
  const normalizedSelectedText = normalizeOptionalText(params.selectedText);

  if (presentationCopy.requiresExplicitUrl) {
    const normalizedUrl = normalizeOptionalText(params.urlCandidate);
    if (!normalizedUrl) {
      return null;
    }

    if (normalizedInput && normalizedInput.includes(normalizedUrl)) {
      return {
        userInput: normalizedInput,
        sourceLabel: "将基于当前输入里的链接启动",
        sourcePreview: truncateSingleLine(normalizedInput),
        slots: { article_url: normalizedUrl },
      };
    }

    if (
      normalizedSelectedText &&
      normalizedSelectedText.includes(normalizedUrl)
    ) {
      return {
        userInput: normalizedSelectedText,
        sourceLabel: "将基于选中文本里的链接启动",
        sourcePreview: truncateSingleLine(normalizedSelectedText),
        slots: { article_url: normalizedUrl },
      };
    }

    return {
      userInput: normalizedUrl,
      sourceLabel: "将基于当前识别到的链接启动",
      sourcePreview: normalizedUrl,
      slots: { article_url: normalizedUrl },
    };
  }

  if (normalizedInput) {
    return {
      userInput: normalizedInput,
      sourceLabel: "将基于当前输入启动",
      sourcePreview: truncateSingleLine(normalizedInput),
    };
  }

  if (normalizedSelectedText) {
    return {
      userInput: normalizedSelectedText,
      sourceLabel: "将基于选中文本启动",
      sourcePreview: truncateSingleLine(normalizedSelectedText),
    };
  }

  return {
    userInput: presentationCopy.fallbackPrompt,
    sourceLabel: "将使用内置起步稿启动",
    sourcePreview: truncateSingleLine(presentationCopy.fallbackPrompt),
  };
}

export function buildSceneAppEntryCard(params: {
  descriptor: SceneAppDescriptor;
  projectId?: string | null;
  input: string;
  selectedText?: string;
  urlCandidate?: string | null;
}): SceneAppEntryCardItem | null {
  const seed = resolveSceneAppSeed({
    descriptor: params.descriptor,
    input: params.input,
    selectedText: params.selectedText,
    urlCandidate: params.urlCandidate,
  });
  if (!seed) {
    return null;
  }

  const presentationCopy = getSceneAppPresentationCopy(params.descriptor);
  const requiresProject = params.descriptor.launchRequirements.some(
    (requirement) => requirement.kind === "project",
  );
  const disabledReason =
    requiresProject && !normalizeOptionalText(params.projectId)
      ? "先选择项目工作区后再启动"
      : undefined;

  return {
    id: params.descriptor.id,
    title: params.descriptor.title,
    summary: params.descriptor.summary,
    businessLabel: presentationCopy.businessLabel,
    valueStatement: presentationCopy.valueStatement,
    deliveryLabel: params.descriptor.outputHint,
    executionLabel: presentationCopy.executionLabel,
    executionTone: presentationCopy.executionTone,
    patternSummary: getSceneAppPatternSummary(params.descriptor),
    infraSummary: getSceneAppInfraSummary(params.descriptor),
    sourceLabel: seed.sourceLabel,
    sourcePreview: seed.sourcePreview,
    actionLabel: presentationCopy.actionLabel,
    disabledReason,
  };
}
