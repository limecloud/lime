import type {
  AgentToolCallState,
  AgentToolExecutionResult,
} from "@/lib/api/agentProtocol";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { PlatformType } from "@/lib/workspace/workbenchCanvas";
import type {
  CanvasImageInsertAnchorHint,
  CanvasImageTargetType,
} from "@/lib/canvasImageInsertBus";
import {
  normalizeSelectionAnchorText,
  resolveSectionTitleForSelection,
} from "@/components/workspace/document/utils/autoImageInsert";
import type { ContentPart } from "../types";
import type {
  ImageWorkbenchOutputView,
  ImageWorkbenchTaskMode,
  ImageWorkbenchTaskView,
  ImageWorkbenchViewport,
} from "../components/imageWorkbenchTypes";

export interface ImageWorkbenchTask extends ImageWorkbenchTaskView {
  sessionId: string;
  hookImageIds: string[];
  applyTarget: ImageWorkbenchApplyTarget | null;
  taskFilePath?: string | null;
  artifactPath?: string | null;
}

export interface ImageWorkbenchOutput extends ImageWorkbenchOutputView {
  hookImageId: string;
  applyTarget: ImageWorkbenchApplyTarget | null;
}

export type ImageWorkbenchApplyTarget =
  | {
      kind: "canvas-insert";
      canvasType: CanvasImageTargetType;
      anchorHint?: CanvasImageInsertAnchorHint;
      sectionTitle?: string | null;
      anchorText?: string | null;
      projectId?: string | null;
      contentId?: string | null;
      actionLabel: string;
      dispatchLabel: string;
    }
  | {
      kind: "document-cover";
      placeholder: string;
      actionLabel: string;
      successLabel: string;
    };

export interface SessionImageWorkbenchState {
  active: boolean;
  viewport: ImageWorkbenchViewport;
  tasks: ImageWorkbenchTask[];
  outputs: ImageWorkbenchOutput[];
  selectedOutputId: string | null;
  nextOutputIndex: number;
}

export function createInitialSessionImageWorkbenchState(): SessionImageWorkbenchState {
  return {
    active: false,
    viewport: { x: 0, y: 0, scale: 1 },
    tasks: [],
    outputs: [],
    selectedOutputId: null,
    nextOutputIndex: 1,
  };
}

export function resolveImageWorkbenchAssistantMessageId(
  taskId: string,
): string {
  return `image-workbench:${taskId}:assistant`;
}

type ImageWorkbenchMessageStatus =
  | "running"
  | "complete"
  | "partial"
  | "failed"
  | "cancelled";

interface BuildImageWorkbenchProcessDescriptorParams {
  taskId: string;
  prompt: string;
  mode: ImageWorkbenchTaskMode;
  status: ImageWorkbenchMessageStatus;
  rawText?: string;
  count?: number;
  successCount?: number;
  size?: string;
  imageUrl?: string | null;
  failureMessage?: string | null;
  startedAt: Date;
  endedAt?: Date;
}

function resolveImageWorkbenchProgressLabel(
  mode: ImageWorkbenchTaskMode,
): string {
  if (mode === "edit") {
    return "修图";
  }
  if (mode === "variation") {
    return "重绘";
  }
  return "配图";
}

function resolveImageWorkbenchActionVerb(mode: ImageWorkbenchTaskMode): string {
  if (mode === "edit") {
    return "整理来源图与编辑要求，并创建异步修图任务";
  }
  if (mode === "variation") {
    return "整理参考图与重绘要求，并创建异步图片任务";
  }
  return "整理画面主题、尺寸和出图数量，并创建异步图片任务";
}

function formatToolArguments(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function resolveImageWorkbenchAnalysisText(
  params: BuildImageWorkbenchProcessDescriptorParams,
): string {
  const prompt = collapseWhitespace(params.prompt) || "当前图片任务";
  const actionLabel = resolveImageWorkbenchProgressLabel(params.mode);
  switch (params.status) {
    case "running":
      return `我先按你的描述${resolveImageWorkbenchActionVerb(params.mode)}：${prompt}`;
    case "complete":
      return `我已按当前描述完成一轮${actionLabel}，并把结果同步回对话：${prompt}`;
    case "partial":
      return `我已按当前描述完成一轮${actionLabel}，但这次只拿到了部分结果：${prompt}`;
    case "cancelled":
      return `这轮${actionLabel}任务已经停止，当前不会继续生成新的结果：${prompt}`;
    case "failed":
    default:
      return `我已经按当前描述提交过一轮${actionLabel}，但这次没有拿到可用结果：${prompt}`;
  }
}

function resolveImageWorkbenchTaskToolStatus(
  status: ImageWorkbenchMessageStatus,
): AgentToolCallState["status"] {
  if (status === "running") {
    return "running";
  }
  if (status === "failed") {
    return "failed";
  }
  return "completed";
}

function buildImageWorkbenchTaskToolResult(
  params: BuildImageWorkbenchProcessDescriptorParams,
): AgentToolExecutionResult | undefined {
  if (params.status === "running") {
    return undefined;
  }

  const successCount =
    params.successCount ??
    (params.status === "complete" ? params.count || 1 : undefined);
  const images =
    params.imageUrl &&
    (params.status === "complete" || params.status === "partial")
      ? [{ src: params.imageUrl, origin: "tool_payload" as const }]
      : undefined;

  switch (params.status) {
    case "complete":
      return {
        success: true,
        output: `图片任务已完成，返回 ${successCount || 1} 张结果。`,
        images,
      };
    case "partial":
      return {
        success: true,
        output: `图片任务已完成部分结果，当前返回 ${successCount || 0} 张图片。`,
        images,
      };
    case "cancelled":
      return {
        success: true,
        output: "图片任务已取消，当前不会继续生成新的结果。",
      };
    case "failed":
    default:
      return {
        success: false,
        output:
          params.failureMessage?.trim() || "图片任务执行失败，未返回可用结果。",
        error: params.failureMessage?.trim() || "图片任务执行失败",
      };
  }
}

function buildImageWorkbenchTaskToolCall(
  params: BuildImageWorkbenchProcessDescriptorParams,
): AgentToolCallState {
  const prompt = collapseWhitespace(params.prompt) || "当前图片任务";
  const status = resolveImageWorkbenchTaskToolStatus(params.status);

  return {
    id: `${params.taskId}:task`,
    name: "limeCreateImageGenerationTask",
    arguments: formatToolArguments({
      prompt,
      mode: params.mode,
      count: params.count || 1,
      size: params.size || undefined,
      taskId: params.taskId,
    }),
    status,
    result: buildImageWorkbenchTaskToolResult(params),
    startTime: params.startedAt,
    endTime:
      status === "running" ? undefined : (params.endedAt ?? params.startedAt),
  };
}

export function buildImageWorkbenchProcessDescriptor(
  params: BuildImageWorkbenchProcessDescriptorParams,
): {
  toolCalls: AgentToolCallState[];
  contentParts: ContentPart[];
} {
  const taskToolCall = buildImageWorkbenchTaskToolCall(params);

  return {
    toolCalls: [taskToolCall],
    contentParts: [
      {
        type: "text",
        text: resolveImageWorkbenchAnalysisText(params),
      },
      {
        type: "tool_use",
        toolCall: taskToolCall,
      },
    ],
  };
}

export function collapseWhitespace(
  value: string | null | undefined,
): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function extractImagePromptSnippet(content: string, maxLength = 120): string {
  const normalized = collapseWhitespace(
    content
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/[#>*`~\-|]/g, " ")
      .replace(/\d+\.\s+/g, " ")
      .replace(/[^\S\r\n]+/g, " "),
  );

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function resolveDocumentPlatformLabel(platform: PlatformType): string {
  switch (platform) {
    case "wechat":
      return "微信";
    case "xiaohongshu":
      return "小红书";
    case "zhihu":
      return "知乎";
    case "markdown":
    default:
      return "文稿";
  }
}

export function resolveCoverAspectRatio(platform?: PlatformType): string {
  if (platform === "xiaohongshu") {
    return "1:1";
  }
  return "16:9";
}

export function buildImageWorkbenchCommandText(
  prompt: string,
  options?: {
    aspectRatio?: string;
    count?: number;
    layoutHint?: string | null;
  },
): string {
  const normalizedPrompt = collapseWhitespace(prompt) || "生成一张主题配图";
  const trigger =
    options?.layoutHint === "storyboard_3x3" ||
    (options?.count && options.count > 1)
      ? "@分镜"
      : "@配图";
  const layoutSuffix =
    options?.layoutHint === "storyboard_3x3" ? "，3x3 分镜" : "";
  const ratioSuffix = options?.aspectRatio?.trim()
    ? `，${options.aspectRatio.trim()}`
    : "";
  const countSuffix =
    options?.count && options.count > 1
      ? `，出 ${Math.trunc(options.count)} 张`
      : "";
  return `${trigger} 生成 ${normalizedPrompt}${layoutSuffix}${ratioSuffix}${countSuffix}`;
}

export function buildDocumentImageWorkbenchPrompt(params: {
  projectName?: string | null;
  platform: PlatformType;
  content: string;
}): string {
  const platformLabel = resolveDocumentPlatformLabel(params.platform);
  const subject =
    extractImagePromptSnippet(params.content) ||
    collapseWhitespace(params.projectName || "") ||
    "当前主题";
  return `为当前${platformLabel}文稿补一张主视觉配图，重点内容：${subject}`;
}

function findDocumentCoverPlaceholder(content: string): string | null {
  const match = content.match(
    /!\[[^\]]*]\((pending-cover:\/\/[^)\s]+|【img:[^】]+】|cover-generation-failed)\)/,
  );
  return match?.[1]?.trim() || null;
}

export function buildDefaultCanvasImageApplyTarget(params: {
  canvasState: CanvasStateUnion | null;
  projectId?: string | null;
  contentId?: string | null;
  selectedText?: string | null;
}): ImageWorkbenchApplyTarget | null {
  if (!params.canvasState) {
    return null;
  }

  if (params.canvasState.type === "document") {
    return {
      kind: "canvas-insert",
      canvasType: "document",
      anchorHint: "section_end",
      sectionTitle: resolveSectionTitleForSelection(
        params.canvasState.content,
        params.selectedText,
      ),
      anchorText: normalizeSelectionAnchorText(params.selectedText),
      projectId: params.projectId ?? null,
      contentId: params.contentId ?? null,
      actionLabel: "插入文稿",
      dispatchLabel: "已切回文稿，正在插入图片",
    };
  }

  return null;
}

export function resolveScopedImageWorkbenchApplyTarget(params: {
  canvasState: CanvasStateUnion | null;
  projectId?: string | null;
  contentId?: string | null;
  requestedTarget?: "generate" | "cover";
  selectedText?: string | null;
}): ImageWorkbenchApplyTarget | null {
  if (
    params.requestedTarget === "cover" &&
    params.canvasState?.type === "document"
  ) {
    const placeholder = findDocumentCoverPlaceholder(
      params.canvasState.content,
    );
    if (placeholder) {
      return {
        kind: "document-cover",
        placeholder,
        actionLabel: "设为封面",
        successLabel: "已设为封面",
      };
    }
  }

  return buildDefaultCanvasImageApplyTarget(params);
}

export function resolveImageWorkbenchActionLabel(
  target: ImageWorkbenchApplyTarget | null | undefined,
): string {
  if (!target) {
    return "应用到画布";
  }
  return target.actionLabel;
}
