import { ARTIFACT_DOCUMENT_SCHEMA_VERSION } from "@/lib/artifact-document/types";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import type {
  ImageStoryboardSlot,
  MessageGenericTaskPreview,
  MessageImageWorkbenchPreview,
  MessageTaskPreview,
  MessageTaskPreviewImageCandidate,
  MessageVideoTaskPreview,
} from "../types";
import {
  countTranscriptSpeakers,
  extractTranscriptSegmentsFromRecords,
  formatTranscriptSegmentRange,
  normalizeTranscriptSegments,
  parseTranscriptContent,
} from "./transcriptSegments";

interface ToolResultPreviewParams {
  toolId?: string;
  toolName: string;
  toolArguments: string | undefined;
  toolResult: Record<string, unknown> | undefined;
  fallbackPrompt: string;
}

const GENERIC_TASK_KINDS = new Set<MessageGenericTaskPreview["kind"]>([
  "broadcast_generate",
  "modal_resource_search",
  "transcription_generate",
  "url_parse",
  "typesetting",
]);
const WEB_IMAGE_SEARCH_TOOL_NAMES = new Set(["lime_search_web_images"]);
const AUDIO_TASK_PREVIEW_ARTIFACT_ROOT = ".lime/runtime/audio-generate";
const TRANSCRIPTION_TASK_PREVIEW_ARTIFACT_ROOT =
  ".lime/runtime/transcription-generate";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readMetadataString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function readMetadataPositiveNumber(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): number | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
      }
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
  }
  return undefined;
}

function readFirstArrayRecord(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): Record<string, unknown> | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (!Array.isArray(value) || value.length === 0) {
        continue;
      }
      const firstRecord = asRecord(value[0]);
      if (firstRecord) {
        return firstRecord;
      }
    }
  }
  return null;
}

function readArrayRecords(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): Record<string, unknown>[] {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (!Array.isArray(value) || value.length === 0) {
        continue;
      }
      const records = value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      if (records.length > 0) {
        return records;
      }
    }
  }
  return [];
}

function readImageStoryboardSlots(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): ImageStoryboardSlot[] {
  return readArrayRecords(candidates, keys)
    .map((record, index) => {
      const slotIndex =
        readMetadataPositiveNumber([record], ["slot_index", "slotIndex"]) ||
        index + 1;
      const slotId =
        readMetadataString([record], ["slot_id", "slotId"]) ||
        `storyboard-slot-${slotIndex}`;

      return {
        slotId,
        slotIndex,
        label:
          readMetadataString([record], ["label", "slot_label", "slotLabel"]) ||
          null,
        prompt:
          readMetadataString(
            [record],
            ["prompt", "slot_prompt", "slotPrompt", "revised_prompt"],
          ) || null,
        shotType:
          readMetadataString([record], ["shot_type", "shotType"]) || null,
        status: readMetadataString([record], ["status"]) || null,
      } satisfies ImageStoryboardSlot;
    })
    .sort((left, right) => left.slotIndex - right.slotIndex);
}

function resolveTaskPreviewStatus(
  status: string | undefined,
): MessageTaskPreview["status"] {
  switch ((status || "").trim().toLowerCase()) {
    case "completed":
    case "success":
    case "succeeded":
      return "complete";
    case "partial":
      return "partial";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "running":
    case "processing":
    case "in_progress":
    case "queued":
    case "pending_submit":
    case "pending":
    default:
      return "running";
  }
}

function resolveTaskPreviewPhase(status: string | undefined): string {
  switch ((status || "").trim().toLowerCase()) {
    case "completed":
    case "success":
    case "succeeded":
      return "succeeded";
    case "partial":
      return "partial";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "queued":
    case "pending_submit":
    case "pending":
      return "queued";
    case "running":
    case "processing":
    case "in_progress":
      return "running";
    default:
      return "queued";
  }
}

function readCommandArgumentValue(
  command: string,
  flag: string,
): string | undefined {
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${escapedFlag}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`,
  );
  const match = command.match(pattern);
  return match?.[1]?.trim() || match?.[2]?.trim() || match?.[3]?.trim();
}

function extractImageTaskPromptFromToolArguments(
  toolName: string,
  toolArguments: string | undefined,
): {
  prompt?: string;
  size?: string;
  imageCount?: number;
  layoutHint?: string;
} {
  if (!toolArguments) {
    return {};
  }

  try {
    const parsed = JSON.parse(toolArguments) as Record<string, unknown>;
    const prompt = readMetadataString([parsed], ["prompt"]);
    const size = readMetadataString([parsed], ["size", "resolution"]);
    const imageCount = readMetadataPositiveNumber(
      [parsed],
      ["count", "image_count", "imageCount"],
    );
    const layoutHint = readMetadataString(
      [parsed],
      ["layout_hint", "layoutHint"],
    );
    const command =
      typeof parsed.command === "string" ? parsed.command.trim() : undefined;

    if (prompt || size || imageCount || layoutHint || !command) {
      return { prompt, size, imageCount, layoutHint };
    }

    if (
      toolName.trim().toLowerCase() === "bash" &&
      (command.includes("lime media image generate") ||
        command.includes("lime task create image"))
    ) {
      return {
        prompt: readCommandArgumentValue(command, "--prompt"),
        size: readCommandArgumentValue(command, "--size"),
        imageCount: readCommandArgumentValue(command, "--count")
          ? Number.parseInt(
              readCommandArgumentValue(command, "--count") || "",
              10,
            )
          : undefined,
        layoutHint: readCommandArgumentValue(command, "--layout-hint"),
      };
    }
  } catch {
    return {};
  }

  return {};
}

function extractVideoTaskPromptFromToolArguments(
  toolName: string,
  toolArguments: string | undefined,
): {
  prompt?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  providerId?: string;
  model?: string;
} {
  if (!toolArguments) {
    return {};
  }

  try {
    const parsed = JSON.parse(toolArguments) as Record<string, unknown>;
    const prompt = readMetadataString([parsed], ["prompt"]);
    const durationSeconds = readMetadataPositiveNumber(
      [parsed],
      ["duration", "duration_seconds", "durationSeconds"],
    );
    const aspectRatio = readMetadataString(
      [parsed],
      ["aspect_ratio", "aspectRatio"],
    );
    const resolution = readMetadataString([parsed], ["resolution"]);
    const providerId = readMetadataString(
      [parsed],
      ["provider_id", "providerId"],
    );
    const model = readMetadataString([parsed], ["model"]);
    const command =
      typeof parsed.command === "string" ? parsed.command.trim() : undefined;

    if (
      prompt ||
      durationSeconds ||
      aspectRatio ||
      resolution ||
      providerId ||
      model ||
      !command
    ) {
      return {
        prompt,
        durationSeconds,
        aspectRatio,
        resolution,
        providerId,
        model,
      };
    }

    if (
      toolName.trim().toLowerCase() === "bash" &&
      (command.includes("lime media video generate") ||
        command.includes("lime task create video"))
    ) {
      return {
        prompt: readCommandArgumentValue(command, "--prompt"),
        durationSeconds: readCommandArgumentValue(command, "--duration")
          ? Number.parseInt(
              readCommandArgumentValue(command, "--duration") || "",
              10,
            )
          : undefined,
        aspectRatio:
          readCommandArgumentValue(command, "--aspect-ratio") ||
          readCommandArgumentValue(command, "--aspect_ratio"),
        resolution: readCommandArgumentValue(command, "--resolution"),
        providerId:
          readCommandArgumentValue(command, "--provider-id") ||
          readCommandArgumentValue(command, "--provider"),
        model: readCommandArgumentValue(command, "--model"),
      };
    }
  } catch {
    return {};
  }

  return {};
}

function extractGenericTaskArguments(toolArguments: string | undefined): {
  prompt?: string;
  title?: string;
  query?: string;
  resourceType?: string;
  usage?: string;
  count?: number;
  targetPlatform?: string;
  sourcePath?: string;
  sourceUrl?: string;
  language?: string;
  outputFormat?: string;
  sourceText?: string;
  voice?: string;
  voiceStyle?: string;
  targetLanguage?: string;
  audioPath?: string;
  mimeType?: string;
  durationMs?: number;
} {
  if (!toolArguments) {
    return {};
  }

  try {
    const parsed = JSON.parse(toolArguments) as Record<string, unknown>;
    return {
      prompt: readMetadataString([parsed], ["prompt", "content"]),
      title: readMetadataString([parsed], ["title"]),
      query: readMetadataString([parsed], ["query"]),
      resourceType: readMetadataString(
        [parsed],
        ["resource_type", "resourceType"],
      ),
      usage: readMetadataString([parsed], ["usage"]),
      count: readMetadataPositiveNumber([parsed], ["count"]),
      targetPlatform: readMetadataString(
        [parsed],
        ["target_platform", "targetPlatform"],
      ),
      sourcePath: readMetadataString([parsed], ["source_path", "sourcePath"]),
      sourceUrl: readMetadataString([parsed], ["source_url", "sourceUrl"]),
      language: readMetadataString(
        [parsed],
        ["language", "target_language", "targetLanguage"],
      ),
      outputFormat: readMetadataString(
        [parsed],
        ["output_format", "outputFormat", "format"],
      ),
      sourceText: readMetadataString(
        [parsed],
        ["source_text", "sourceText", "text"],
      ),
      voice: readMetadataString([parsed], ["voice"]),
      voiceStyle: readMetadataString([parsed], ["voice_style", "voiceStyle"]),
      targetLanguage: readMetadataString(
        [parsed],
        ["target_language", "targetLanguage"],
      ),
      audioPath: readMetadataString(
        [parsed],
        ["audio_path", "audioPath", "audio_url", "audioUrl"],
      ),
      mimeType: readMetadataString([parsed], ["mime_type", "mimeType"]),
      durationMs: readMetadataPositiveNumber(
        [parsed],
        ["duration_ms", "durationMs"],
      ),
    };
  } catch {
    return {};
  }
}

function normalizeToolName(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function buildPreviewId(value: string | undefined, fallback: string): string {
  const normalized = (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function buildWebImageSearchArtifactPath(
  toolId: string | undefined,
  query: string | undefined,
): string {
  const identifier = buildPreviewId(toolId || query, "resource-search-preview");
  return `.lime/runtime/resource-search/${identifier}.md`;
}

function buildAudioTaskPreviewArtifactPath(taskId: string): string {
  return `${AUDIO_TASK_PREVIEW_ARTIFACT_ROOT}/${buildPreviewId(
    taskId,
    "audio-task",
  )}.md`;
}

function buildTranscriptionTaskPreviewArtifactPath(taskId: string): string {
  return `${TRANSCRIPTION_TASK_PREVIEW_ARTIFACT_ROOT}/${buildPreviewId(
    taskId,
    "transcription-task",
  )}.md`;
}

function formatDurationMsLabel(durationMs?: number): string | undefined {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return undefined;
  }
  if (durationMs < 60_000) {
    return `${Math.max(1, Math.round(durationMs / 1000))} 秒`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

function readWebImageSearchResult(params: ToolResultPreviewParams): {
  provider?: string;
  query?: string;
  returnedCount?: number;
  aspect?: string;
  hits: MessageTaskPreviewImageCandidate[];
} | null {
  if (!WEB_IMAGE_SEARCH_TOOL_NAMES.has(normalizeToolName(params.toolName))) {
    return null;
  }

  const resultRecord = asRecord(params.toolResult);
  const metadata = asRecord(resultRecord?.metadata);
  const metadataResult = asRecord(metadata?.result);
  const taskResult = asRecord(resultRecord?.result);
  const hitRecords = readArrayRecords(
    [metadataResult, taskResult, resultRecord],
    ["hits"],
  );
  if (hitRecords.length === 0) {
    return null;
  }

  const hits = hitRecords
    .map<MessageTaskPreviewImageCandidate | null>((hit, index) => {
      const thumbnailUrl = readMetadataString(
        [hit],
        ["thumbnail_url", "thumbnailUrl", "content_url", "contentUrl"],
      );
      if (!thumbnailUrl) {
        return null;
      }

      return {
        id:
          readMetadataString([hit], ["id"]) ||
          `${buildPreviewId(params.toolId, "resource-search")}-${index + 1}`,
        thumbnailUrl,
        contentUrl:
          readMetadataString([hit], ["content_url", "contentUrl"]) ||
          thumbnailUrl,
        hostPageUrl:
          readMetadataString([hit], ["host_page_url", "hostPageUrl"]) || null,
        width: readMetadataPositiveNumber([hit], ["width"]),
        height: readMetadataPositiveNumber([hit], ["height"]),
        name:
          readMetadataString([hit], ["name", "title", "alt"]) ||
          `图片候选 ${index + 1}`,
      };
    })
    .filter((item): item is MessageTaskPreviewImageCandidate => item !== null);

  if (hits.length === 0) {
    return null;
  }

  return {
    provider: readMetadataString(
      [metadataResult, taskResult, resultRecord],
      ["provider", "provider_id", "providerId"],
    ),
    query:
      readMetadataString(
        [metadataResult, taskResult, resultRecord],
        ["query"],
      ) || extractGenericTaskArguments(params.toolArguments).query,
    returnedCount:
      readMetadataPositiveNumber(
        [metadataResult, taskResult, resultRecord],
        ["returnedCount", "returned_count"],
      ) || hits.length,
    aspect: readMetadataString(
      [metadataResult, taskResult, resultRecord],
      ["aspect"],
    ),
    hits,
  };
}

function resolveWebImageSearchProviderLabel(provider?: string): string {
  const normalized = (provider || "").trim().toLowerCase();
  if (normalized === "pexels") {
    return "Pexels";
  }
  return provider?.trim() || "联网图库";
}

function buildWebImageSearchArtifactDocument(params: {
  toolId: string | undefined;
  provider?: string;
  query?: string;
  returnedCount: number;
  aspect?: string;
  hits: MessageTaskPreviewImageCandidate[];
}) {
  const providerLabel = resolveWebImageSearchProviderLabel(params.provider);
  const artifactId = `resource-search:${buildPreviewId(params.toolId, "preview")}`;
  const queryLabel = params.query?.trim() || "图片素材";
  const highlightItems = [
    `来源：${providerLabel}`,
    `候选：${params.returnedCount} 张`,
    params.aspect?.trim() ? `画幅：${params.aspect.trim()}` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
    artifactId,
    kind: "brief" as const,
    title: `${providerLabel} 图片候选`,
    status: "ready" as const,
    language: "zh-CN",
    summary: `已为“${queryLabel}”返回 ${params.returnedCount} 张图片素材候选。`,
    blocks: [
      {
        id: "hero",
        type: "hero_summary" as const,
        eyebrow: "素材检索",
        title: queryLabel,
        summary: `已返回 ${params.returnedCount} 张高相关图片候选，打开右侧即可继续挑选与查看来源。`,
        highlights: highlightItems,
      },
      ...params.hits.map((hit, index) => ({
        id: `image-${index + 1}`,
        type: "image" as const,
        url: hit.contentUrl || hit.thumbnailUrl,
        alt: hit.name || `图片候选 ${index + 1}`,
        caption: [
          hit.name?.trim(),
          hit.width && hit.height ? `${hit.width}x${hit.height}` : null,
          hit.hostPageUrl?.trim() || null,
        ]
          .filter((item): item is string => Boolean(item))
          .join(" · "),
        sourceIds: [`source-${index + 1}`],
      })),
    ],
    sources: params.hits.map((hit, index) => ({
      id: `source-${index + 1}`,
      type: "search_result" as const,
      label: hit.name || `图片候选 ${index + 1}`,
      locator: {
        url: hit.hostPageUrl || hit.contentUrl || hit.thumbnailUrl,
      },
      reliability: "secondary" as const,
    })),
    metadata: {
      generatedBy: "agent" as const,
      rendererHints: {
        density: "comfortable" as const,
      },
      searchProvider: params.provider || null,
      searchQuery: params.query || null,
      returnedCount: params.returnedCount,
      aspect: params.aspect || null,
    },
  };
}

function buildGenericTaskMetaItems(
  kind: MessageGenericTaskPreview["kind"],
  taskArguments: ReturnType<typeof extractGenericTaskArguments>,
  candidates: Array<Record<string, unknown> | null | undefined>,
): string[] {
  const items = new Set<string>();
  const push = (value?: string | number) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      items.add(String(value));
      return;
    }
    if (typeof value === "string" && value.trim()) {
      items.add(value.trim());
    }
  };

  if (kind === "modal_resource_search") {
    push(taskArguments.resourceType);
    push(taskArguments.usage);
    if (taskArguments.count) {
      push(`${taskArguments.count} 个候选`);
    }
  } else if (kind === "broadcast_generate") {
    push(readMetadataString(candidates, ["audience", "tone"]));
    const durationMinutes = readMetadataPositiveNumber(candidates, [
      "duration_hint_minutes",
      "durationHintMinutes",
    ]);
    if (durationMinutes) {
      push(`${durationMinutes} 分钟`);
    }
  } else if (kind === "transcription_generate") {
    push(taskArguments.sourcePath || taskArguments.sourceUrl);
    push(
      taskArguments.language ||
        taskArguments.targetLanguage ||
        readMetadataString(candidates, ["language", "target_language"]),
    );
    push(
      taskArguments.outputFormat ||
        readMetadataString(candidates, [
          "output_format",
          "outputFormat",
          "format",
        ]),
    );
  } else if (kind === "url_parse") {
    push(taskArguments.sourceUrl || readMetadataString(candidates, ["url"]));
  } else if (kind === "typesetting") {
    push(taskArguments.targetPlatform);
  } else if (kind === "audio_generate") {
    push(
      taskArguments.voice ||
        readMetadataString(candidates, [
          "voice",
          "voice_preset",
          "voicePreset",
        ]),
    );
    push(
      taskArguments.voiceStyle ||
        readMetadataString(candidates, ["voice_style", "voiceStyle"]),
    );
    push(
      taskArguments.targetLanguage ||
        readMetadataString(candidates, ["target_language", "targetLanguage"]),
    );
    push(
      taskArguments.mimeType ||
        readMetadataString(candidates, ["mime_type", "mimeType"]),
    );
    const durationMs =
      taskArguments.durationMs ||
      readMetadataPositiveNumber(candidates, ["duration_ms", "durationMs"]);
    push(formatDurationMsLabel(durationMs));
  }

  return Array.from(items);
}

function resolveGenericTaskStatusMessage(
  kind: MessageGenericTaskPreview["kind"],
  status: MessageGenericTaskPreview["status"],
): string {
  if (status === "complete" || status === "partial") {
    switch (kind) {
      case "audio_generate":
        return "音频结果已同步，打开查看即可继续预览与管理任务。";
      case "broadcast_generate":
        return "播报整理结果已同步，打开查看即可继续审阅文稿。";
      case "modal_resource_search":
        return "素材检索结果已同步，打开查看即可继续筛选结果。";
      case "transcription_generate":
        return "转写结果已同步，打开查看即可继续校对内容。";
      case "url_parse":
        return "链接解析结果已同步，打开查看即可继续提取关键信息。";
      case "typesetting":
        return "排版结果已同步，打开查看即可继续润色文稿。";
    }
  }

  if (status === "failed") {
    switch (kind) {
      case "audio_generate":
        return "配音生成失败，请调整文本、音色或模型后重试。";
      case "broadcast_generate":
        return "播报整理失败，请调整输入内容后重试。";
      case "modal_resource_search":
        return "素材检索失败，请稍后重试或调整关键词。";
      case "transcription_generate":
        return "转写失败，请检查音频来源或稍后重试。";
      case "url_parse":
        return "链接解析失败，请检查链接后重试。";
      case "typesetting":
        return "排版失败，请调整内容后重试。";
    }
  }

  if (status === "cancelled") {
    return "任务已取消，当前不会继续处理新的结果。";
  }

  switch (kind) {
    case "audio_generate":
      return "配音任务已写入 audio_task/audio_output，工作区会继续同步音频结果。";
    case "broadcast_generate":
      return "播报整理任务已提交，工作区会继续同步最新进度。";
    case "modal_resource_search":
      return "素材检索任务已提交，工作区会继续同步候选结果。";
    case "transcription_generate":
      return "转写任务已提交，工作区会继续同步最新进度。";
    case "url_parse":
      return "链接解析任务已提交，工作区会继续同步解析状态。";
    case "typesetting":
      return "排版任务已提交，工作区会继续同步优化进度。";
  }
}

function buildAudioTaskPreviewFromToolResult(
  params: ToolResultPreviewParams,
): MessageGenericTaskPreview | null {
  const resultRecord = asRecord(params.toolResult);
  const metadata = asRecord(resultRecord?.metadata);
  const taskResult = asRecord(resultRecord?.result);
  const taskId = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["task_id", "taskId", "id"],
  );
  const taskType = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["task_type", "taskType"],
  );
  if (!taskId || !taskType) {
    return null;
  }

  const normalizedTaskType = taskType.trim().toLowerCase();
  if (
    normalizedTaskType !== "audio_generate" &&
    normalizedTaskType !== "voice_generate" &&
    normalizedTaskType !== "voice"
  ) {
    return null;
  }

  const parsedArguments = extractGenericTaskArguments(params.toolArguments);
  const status = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["status"],
  );
  const previewStatus = resolveTaskPreviewStatus(status);
  const candidates = [metadata, resultRecord, taskResult];
  const sourceText =
    parsedArguments.sourceText ||
    readMetadataString(candidates, ["source_text", "sourceText", "prompt"]) ||
    params.fallbackPrompt.trim() ||
    "配音任务";
  const taskFilePath =
    readMetadataString(candidates, ["artifact_path", "artifactPath"]) ||
    readMetadataString(candidates, ["path", "absolute_path", "absolutePath"]) ||
    null;
  const audioUrl =
    parsedArguments.audioPath ||
    readMetadataString(candidates, [
      "audio_path",
      "audioPath",
      "audio_url",
      "audioUrl",
      "url",
      "result_url",
      "resultUrl",
    ]) ||
    null;
  const durationMs =
    parsedArguments.durationMs ||
    readMetadataPositiveNumber(candidates, ["duration_ms", "durationMs"]) ||
    null;
  const mimeType =
    parsedArguments.mimeType ||
    readMetadataString(candidates, ["mime_type", "mimeType"]) ||
    null;
  const voice =
    parsedArguments.voice || readMetadataString(candidates, ["voice"]) || null;

  return {
    kind: "audio_generate",
    taskId,
    taskType: "audio_generate",
    prompt: sourceText,
    title:
      parsedArguments.title ||
      readMetadataString(candidates, ["title"]) ||
      "配音生成任务",
    status: previewStatus,
    projectId:
      readMetadataString(candidates, ["project_id", "projectId"]) || null,
    contentId:
      readMetadataString(candidates, ["content_id", "contentId"]) || null,
    artifactPath: buildAudioTaskPreviewArtifactPath(taskId),
    taskFilePath,
    providerId:
      readMetadataString(candidates, [
        "provider_id",
        "providerId",
        "provider",
      ]) || null,
    model: readMetadataString(candidates, ["model"]) || null,
    phase: resolveTaskPreviewPhase(status),
    statusMessage: resolveGenericTaskStatusMessage(
      "audio_generate",
      previewStatus,
    ),
    metaItems: buildGenericTaskMetaItems(
      "audio_generate",
      parsedArguments,
      candidates,
    ),
    audioUrl,
    mimeType,
    durationMs,
    sourceText,
    voice,
  };
}

export function buildAudioTaskArtifactDocument(
  preview: MessageGenericTaskPreview,
) {
  const taskFilePath = preview.taskFilePath?.trim();
  const audioUrl = preview.audioUrl?.trim();
  const errorCode = preview.errorCode?.trim();
  const errorMessage = preview.errorMessage?.trim();
  const highlights = [
    preview.status === "running" ? "状态：待执行" : `状态：${preview.status}`,
    preview.voice?.trim() ? `音色：${preview.voice.trim()}` : null,
    preview.model?.trim() ? `模型：${preview.model.trim()}` : null,
    errorCode ? `错误码：${errorCode}` : null,
    formatDurationMsLabel(preview.durationMs || undefined)
      ? `时长：${formatDurationMsLabel(preview.durationMs || undefined)}`
      : null,
  ].filter((item): item is string => Boolean(item));
  const audioOutputTone =
    preview.status === "failed"
      ? ("danger" as const)
      : audioUrl
        ? ("success" as const)
        : ("info" as const);
  const audioOutputTitle =
    preview.status === "failed"
      ? "音频生成失败"
      : audioUrl
        ? "音频结果已同步"
        : "等待音频执行器";
  const audioOutputBody =
    preview.status === "failed"
      ? [
          preview.statusMessage?.trim(),
          errorCode ? `错误码：${errorCode}` : null,
          errorMessage ? `原因：${errorMessage}` : null,
        ]
          .filter((item): item is string => Boolean(item))
          .join("\n")
      : audioUrl
        ? `音频路径：${audioUrl}`
        : "当前步骤只创建标准任务产物，不生成真实音频、不伪造云端提交；后续执行器会回写 audio_output.audio_path。";

  return {
    schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
    artifactId: `audio-generate:${preview.taskId}`,
    kind: "brief" as const,
    title: preview.title?.trim() || "配音生成任务",
    status:
      preview.status === "failed"
        ? ("failed" as const)
        : preview.status === "complete" || preview.status === "partial"
          ? ("ready" as const)
          : ("streaming" as const),
    language: "zh-CN",
    summary:
      preview.status === "running"
        ? "配音任务已经写入标准 audio_task/audio_output 产物，等待执行器同步音频结果。"
        : preview.statusMessage || "配音任务已经进入统一多模态运行合同主链。",
    blocks: [
      {
        id: "hero",
        type: "hero_summary" as const,
        eyebrow: "配音生成",
        title: preview.prompt || "配音任务",
        summary:
          preview.statusMessage ||
          "配音任务已经写入标准 audio_task/audio_output 产物。",
        highlights,
      },
      {
        id: "source-text",
        type: "rich_text" as const,
        contentFormat: "markdown" as const,
        content: preview.sourceText || preview.prompt,
        markdown: `### 待配音文本\n\n${preview.sourceText || preview.prompt}`,
        text: preview.sourceText || preview.prompt,
      },
      {
        id: "audio-output",
        type: "callout" as const,
        tone: audioOutputTone,
        title: audioOutputTitle,
        body: audioOutputBody,
      },
    ],
    sources: taskFilePath
      ? [
          {
            id: "audio-task-file",
            type: "file" as const,
            label: "audio_generate task file",
            locator: {
              path: taskFilePath,
            },
            reliability: "primary" as const,
          },
        ]
      : [],
    metadata: {
      generatedBy: "agent" as const,
      rendererHints: {
        density: "comfortable" as const,
      },
      taskId: preview.taskId,
      taskType: "audio_generate",
      taskFilePath,
      audioUrl: audioUrl || null,
      mimeType: preview.mimeType || null,
      durationMs: preview.durationMs || null,
      voice: preview.voice || null,
      errorCode: errorCode || null,
      errorMessage: errorMessage || null,
      modalityContractKey: "voice_generation",
    },
  };
}

export function buildTranscriptionTaskArtifactDocument(
  preview: MessageGenericTaskPreview,
) {
  const taskFilePath = preview.taskFilePath?.trim();
  const transcriptPath = preview.transcriptPath?.trim();
  const transcriptText =
    typeof preview.transcriptText === "string" && preview.transcriptText.trim()
      ? preview.transcriptText
      : null;
  const sourcePath = preview.sourcePath?.trim();
  const sourceUrl = preview.sourceUrl?.trim();
  const errorCode = preview.errorCode?.trim();
  const errorMessage = preview.errorMessage?.trim();
  const transcriptSegments = normalizeTranscriptSegments(
    preview.transcriptSegments || [],
  );
  const speakerCount = countTranscriptSpeakers(transcriptSegments);
  const highlights = [
    preview.status === "running" ? "状态：待转写" : `状态：${preview.status}`,
    preview.language?.trim() ? `语言：${preview.language.trim()}` : null,
    preview.outputFormat?.trim()
      ? `格式：${preview.outputFormat.trim()}`
      : null,
    preview.model?.trim() ? `模型：${preview.model.trim()}` : null,
    transcriptSegments.length > 0 ? `段落：${transcriptSegments.length}` : null,
    speakerCount > 0 ? `说话人：${speakerCount}` : null,
    transcriptText ? `字数：${transcriptText.trim().length}` : null,
    errorCode ? `错误码：${errorCode}` : null,
  ].filter((item): item is string => Boolean(item));
  const sourceLabel = sourcePath || sourceUrl || preview.prompt || "音频来源";
  const transcriptTone =
    preview.status === "failed"
      ? ("danger" as const)
      : transcriptPath
        ? ("success" as const)
        : ("info" as const);
  const transcriptTitle =
    preview.status === "failed"
      ? "转写失败"
      : transcriptPath
        ? "Transcript 已同步，可校对保存"
        : "等待转写执行器";
  const transcriptBody =
    preview.status === "failed"
      ? [
          preview.statusMessage?.trim(),
          errorCode ? `错误码：${errorCode}` : null,
          errorMessage ? `原因：${errorMessage}` : null,
        ]
          .filter((item): item is string => Boolean(item))
          .join("\n")
      : transcriptPath
        ? transcriptText
          ? `Transcript 已载入，可直接在下方编辑校对；保存后会作为同一运行时文档的新版本记录，不改写原始 ASR 输出。源文件路径：${transcriptPath}`
          : `Transcript 路径：${transcriptPath}`
        : "当前步骤只创建标准 transcription_generate 任务产物；lime-transcription-worker 会回写 transcript.completed 或 transcript.failed，不回退 frontend ASR。";

  const transcriptBlocks = transcriptText
    ? [
        {
          id: "transcript-text",
          type: "code_block" as const,
          title: "转写文本（可编辑校对）",
          language: "text",
          code: transcriptText,
        },
      ]
    : [];
  const segmentBlocks =
    transcriptSegments.length > 0
      ? [
          {
            id: "transcript-segments",
            type: "table" as const,
            title: "转写时间轴（可逐段编辑校对）",
            columns: ["时间", "说话人", "内容"],
            rows: transcriptSegments.map((segment) => [
              formatTranscriptSegmentRange(segment),
              segment.speaker?.trim() || "未标注",
              segment.text,
            ]),
          },
        ]
      : [];

  return {
    schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
    artifactId: `transcription-generate:${preview.taskId}`,
    kind: "brief" as const,
    title: preview.title?.trim() || "内容转写任务",
    status:
      preview.status === "failed"
        ? ("failed" as const)
        : preview.status === "complete" || preview.status === "partial"
          ? ("ready" as const)
          : ("streaming" as const),
    language: "zh-CN",
    summary:
      preview.status === "running"
        ? "转写任务已经写入标准 transcription_generate/transcript 产物，等待执行器同步结果。"
        : preview.statusMessage || "转写任务已经进入统一多模态运行合同主链。",
    blocks: [
      {
        id: "hero",
        type: "hero_summary" as const,
        eyebrow: "内容转写",
        title: preview.prompt || "转写任务",
        summary:
          preview.statusMessage ||
          "转写任务已经写入标准 transcription_generate/transcript 产物。",
        highlights,
      },
      {
        id: "source",
        type: "rich_text" as const,
        contentFormat: "markdown" as const,
        content: sourceLabel,
        markdown: `### 转写来源\n\n${sourceLabel}`,
        text: sourceLabel,
      },
      ...segmentBlocks,
      ...transcriptBlocks,
      {
        id: "transcript-output",
        type: "callout" as const,
        tone: transcriptTone,
        title: transcriptTitle,
        body: transcriptBody,
      },
    ],
    sources: [
      taskFilePath
        ? {
            id: "transcription-task-file",
            type: "file" as const,
            label: "transcription_generate task file",
            locator: {
              path: taskFilePath,
            },
            reliability: "primary" as const,
          }
        : null,
      transcriptPath
        ? {
            id: "transcript-file",
            type: "file" as const,
            label: "transcript output",
            locator: {
              path: transcriptPath,
            },
            reliability: "primary" as const,
          }
        : null,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
    metadata: {
      generatedBy: "agent" as const,
      rendererHints: {
        density: "comfortable" as const,
      },
      taskId: preview.taskId,
      taskType: "transcription_generate",
      taskFilePath,
      transcriptPath: transcriptPath || null,
      sourcePath: sourcePath || null,
      sourceUrl: sourceUrl || null,
      language: preview.language || null,
      outputFormat: preview.outputFormat || null,
      transcriptText: transcriptText || null,
      transcriptSegments,
      transcriptCorrectionEnabled: Boolean(
        transcriptText || transcriptSegments.length > 0,
      ),
      transcriptCorrectionStatus:
        transcriptText || transcriptSegments.length > 0
          ? "available"
          : "waiting_transcript",
      transcriptCorrectionSource: "artifact_document_version",
      transcriptCorrectionPatchKind: "artifact_document_version",
      transcriptCorrectionOriginalImmutable: true,
      providerId: preview.providerId || null,
      model: preview.model || null,
      errorCode: errorCode || null,
      errorMessage: errorMessage || null,
      modalityContractKey: "audio_transcription",
    },
  };
}

export function buildImageTaskPreviewFromToolResult(
  params: ToolResultPreviewParams,
): MessageImageWorkbenchPreview | null {
  const resultRecord = asRecord(params.toolResult);
  const metadata = asRecord(resultRecord?.metadata);
  const taskId = readMetadataString([metadata], ["task_id", "taskId"]);
  const taskType = readMetadataString([metadata], ["task_type", "taskType"]);
  if (!taskId || !taskType) {
    return null;
  }

  const normalizedTaskType = taskType.trim().toLowerCase();
  if (
    !normalizedTaskType.includes("image") &&
    !normalizedTaskType.includes("cover")
  ) {
    return null;
  }

  const parsedArguments = extractImageTaskPromptFromToolArguments(
    params.toolName,
    params.toolArguments,
  );
  const status = readMetadataString([metadata], ["status"]);
  const previewStatus = resolveTaskPreviewStatus(status);
  const requestedCount =
    parsedArguments.imageCount ||
    readMetadataPositiveNumber(
      [metadata],
      [
        "requested_count",
        "requestedCount",
        "count",
        "image_count",
        "imageCount",
      ],
    );
  const receivedCount = readMetadataPositiveNumber(
    [metadata],
    ["received_count", "receivedCount"],
  );
  const layoutHint =
    parsedArguments.layoutHint ||
    readMetadataString([metadata], ["layout_hint", "layoutHint"]) ||
    null;
  const storyboardSlots = readImageStoryboardSlots(
    [metadata],
    ["storyboard_slots", "storyboardSlots"],
  );
  const expectedImageCount = Math.max(
    requestedCount || 0,
    storyboardSlots.length,
  );
  const resolvedImageCount =
    previewStatus === "running"
      ? expectedImageCount || requestedCount
      : receivedCount || expectedImageCount || requestedCount;
  const statusMessage =
    previewStatus === "complete"
      ? receivedCount && receivedCount > 0
        ? layoutHint === "storyboard_3x3"
          ? `3x3 分镜已生成完成，共 ${receivedCount} 张。`
          : `图片已生成完成，共 ${receivedCount} 张。`
        : layoutHint === "storyboard_3x3"
          ? "3x3 分镜已生成完成，可在右侧继续查看与使用。"
          : "图片结果已生成完成，可在右侧查看与使用。"
      : previewStatus === "partial"
        ? receivedCount && receivedCount > 0
          ? layoutHint === "storyboard_3x3"
            ? `3x3 分镜已返回部分结果，共 ${receivedCount} 张。`
            : `图片已返回部分结果，共 ${receivedCount} 张。`
          : layoutHint === "storyboard_3x3"
            ? "3x3 分镜已返回部分结果，可在右侧继续查看。"
            : "图片已返回部分结果，可在右侧继续查看。"
        : previewStatus === "failed"
          ? "图片任务执行失败，请查看工具结果或任务详情。"
          : previewStatus === "cancelled"
            ? "图片任务已取消。"
            : "图片任务已提交，正在排队处理。";

  return {
    taskId,
    prompt:
      parsedArguments.prompt ||
      readMetadataString([metadata], ["prompt"]) ||
      params.fallbackPrompt.trim() ||
      "图片任务进行中",
    status: previewStatus,
    projectId:
      readMetadataString([metadata], ["project_id", "projectId"]) || null,
    contentId:
      readMetadataString([metadata], ["content_id", "contentId"]) || null,
    taskFilePath:
      readMetadataString(
        [metadata],
        ["path", "absolute_path", "absolutePath"],
      ) || null,
    artifactPath:
      readMetadataString([metadata], ["artifact_path", "artifactPath"]) || null,
    imageCount: resolvedImageCount,
    expectedImageCount: expectedImageCount || requestedCount,
    layoutHint,
    storyboardSlots: storyboardSlots.length > 0 ? storyboardSlots : undefined,
    size:
      parsedArguments.size ||
      readMetadataString([metadata], ["size", "resolution"]),
    phase: resolveTaskPreviewPhase(status),
    statusMessage,
  };
}

function buildVideoTaskPreviewFromToolResult(
  params: ToolResultPreviewParams,
): MessageVideoTaskPreview | null {
  const resultRecord = asRecord(params.toolResult);
  const metadata = asRecord(resultRecord?.metadata);
  const taskResult =
    asRecord(resultRecord?.result) || asRecord(metadata?.result);
  const firstVideo = readFirstArrayRecord(
    [taskResult, metadata, resultRecord],
    ["videos", "results"],
  );
  const taskId = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["task_id", "taskId", "id"],
  );
  const taskType = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["task_type", "taskType"],
  );
  if (!taskId || !taskType) {
    return null;
  }

  const normalizedTaskType = taskType.trim().toLowerCase();
  if (!normalizedTaskType.includes("video")) {
    return null;
  }

  const parsedArguments = extractVideoTaskPromptFromToolArguments(
    params.toolName,
    params.toolArguments,
  );
  const status = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["status"],
  );
  const videoUrl = readMetadataString(
    [firstVideo, taskResult, metadata, resultRecord],
    ["url", "result_url", "resultUrl"],
  );
  const thumbnailUrl = readMetadataString(
    [firstVideo, taskResult, metadata, resultRecord],
    ["thumbnail_url", "thumbnailUrl", "poster_url", "posterUrl"],
  );
  const durationMs = readMetadataPositiveNumber(
    [firstVideo],
    ["duration_ms", "durationMs"],
  );
  const durationSeconds =
    parsedArguments.durationSeconds ||
    (durationMs ? Math.max(1, Math.round(durationMs / 1000)) : undefined);
  const previewStatus = resolveTaskPreviewStatus(status);
  const phase = resolveTaskPreviewPhase(status);
  const statusMessage =
    previewStatus === "complete"
      ? videoUrl
        ? "视频结果已同步，打开查看即可继续预览。"
        : "视频已经生成完成，正在同步最终结果。"
      : previewStatus === "partial"
        ? videoUrl
          ? "视频已返回部分结果，打开查看可继续确认当前片段。"
          : "视频已返回部分结果，工作区正在补齐剩余结果。"
        : previewStatus === "failed"
          ? readMetadataString(
              [metadata, resultRecord, taskResult],
              ["error", "error_message", "errorMessage"],
            ) || "视频生成失败，请稍后重试。"
          : previewStatus === "cancelled"
            ? "视频任务已取消，当前不会继续生成新的结果。"
            : phase === "queued"
              ? "视频任务已进入排队队列，稍后会自动开始生成。"
              : "视频任务正在生成中，工作区会继续同步最新状态。";

  return {
    kind: "video_generate",
    taskId,
    taskType: "video_generate",
    prompt:
      parsedArguments.prompt ||
      readMetadataString([metadata, resultRecord, taskResult], ["prompt"]) ||
      params.fallbackPrompt.trim() ||
      "视频任务进行中",
    status: resolveTaskPreviewStatus(status),
    projectId:
      readMetadataString(
        [metadata, resultRecord, taskResult],
        ["project_id", "projectId"],
      ) || null,
    contentId:
      readMetadataString(
        [metadata, resultRecord, taskResult],
        ["content_id", "contentId"],
      ) || null,
    videoUrl: videoUrl || null,
    thumbnailUrl: thumbnailUrl || null,
    durationSeconds,
    aspectRatio:
      parsedArguments.aspectRatio ||
      readMetadataString(
        [metadata, resultRecord, taskResult],
        ["aspect_ratio", "aspectRatio"],
      ),
    resolution:
      parsedArguments.resolution ||
      readMetadataString([metadata, resultRecord, taskResult], ["resolution"]),
    providerId:
      parsedArguments.providerId ||
      readMetadataString(
        [metadata, resultRecord, taskResult],
        ["provider_id", "providerId", "provider"],
      ) ||
      null,
    model:
      parsedArguments.model ||
      readMetadataString([metadata, resultRecord, taskResult], ["model"]) ||
      null,
    phase,
    statusMessage,
  };
}

function buildWebImageSearchTaskPreviewFromToolResult(
  params: ToolResultPreviewParams,
): MessageGenericTaskPreview | null {
  const webImageSearch = readWebImageSearchResult(params);
  if (!webImageSearch) {
    return null;
  }

  const providerLabel = resolveWebImageSearchProviderLabel(
    webImageSearch.provider,
  );
  const query =
    webImageSearch.query?.trim() || params.fallbackPrompt.trim() || "图片素材";
  const returnedCount =
    webImageSearch.returnedCount || webImageSearch.hits.length;

  return {
    kind: "modal_resource_search",
    taskId: `resource-search:${buildPreviewId(params.toolId, "preview")}`,
    taskType: "modal_resource_search",
    prompt: query,
    title: `${providerLabel} 图片候选`,
    status: "complete",
    projectId: null,
    contentId: null,
    artifactPath: buildWebImageSearchArtifactPath(params.toolId, query),
    providerId: webImageSearch.provider || null,
    model: null,
    phase: "completed",
    statusMessage: `已找到 ${returnedCount} 张${providerLabel}图片候选，打开查看可继续挑选与查看来源。`,
    metaItems: [
      providerLabel,
      `${returnedCount} 个候选`,
      webImageSearch.aspect?.trim() || undefined,
    ].filter((item): item is string => Boolean(item)),
    imageCandidates: webImageSearch.hits.slice(0, 4),
  };
}

function buildGenericTaskPreviewFromToolResult(
  params: ToolResultPreviewParams,
): MessageGenericTaskPreview | null {
  const resultRecord = asRecord(params.toolResult);
  const metadata = asRecord(resultRecord?.metadata);
  const taskResult = asRecord(resultRecord?.result);
  const taskId = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["task_id", "taskId", "id"],
  );
  const taskType = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["task_type", "taskType"],
  );
  if (!taskId || !taskType) {
    return null;
  }

  const normalizedTaskType = taskType.trim().toLowerCase();
  if (
    !GENERIC_TASK_KINDS.has(
      normalizedTaskType as MessageGenericTaskPreview["kind"],
    )
  ) {
    return null;
  }

  const kind = normalizedTaskType as MessageGenericTaskPreview["kind"];
  const parsedArguments = extractGenericTaskArguments(params.toolArguments);
  const status = readMetadataString(
    [metadata, resultRecord, taskResult],
    ["status"],
  );
  const artifactPath =
    extractArtifactProtocolPathsFromValue(resultRecord)[0] ||
    extractArtifactProtocolPathsFromValue(taskResult)[0] ||
    extractArtifactProtocolPathsFromValue(metadata)[0] ||
    null;
  const taskFilePath =
    readMetadataString(
      [metadata, resultRecord, taskResult],
      ["artifact_path", "artifactPath"],
    ) ||
    readMetadataString(
      [metadata, resultRecord, taskResult],
      ["path", "absolute_path", "absolutePath"],
    ) ||
    artifactPath ||
    null;
  const prompt =
    parsedArguments.prompt ||
    parsedArguments.query ||
    parsedArguments.title ||
    readMetadataString(
      [metadata, resultRecord, taskResult],
      ["prompt", "query", "title"],
    ) ||
    params.fallbackPrompt.trim() ||
    "任务进行中";
  const candidates = [metadata, resultRecord, taskResult];
  const transcriptRecordCandidates = [
    metadata,
    resultRecord,
    taskResult,
    asRecord(metadata?.transcript),
    asRecord(resultRecord?.transcript),
    asRecord(taskResult?.transcript),
  ];
  const rawTranscriptText =
    kind === "transcription_generate"
      ? readMetadataString(transcriptRecordCandidates, [
          "transcript_text",
          "transcriptText",
          "text",
        ]) || null
      : null;
  const parsedTranscript =
    kind === "transcription_generate"
      ? parseTranscriptContent(rawTranscriptText)
      : { text: null, segments: [] };
  const extractedTranscriptSegments =
    kind === "transcription_generate"
      ? extractTranscriptSegmentsFromRecords(transcriptRecordCandidates)
      : [];
  const transcriptSegments =
    extractedTranscriptSegments.length > 0
      ? extractedTranscriptSegments
      : parsedTranscript.segments;
  const metaItems = buildGenericTaskMetaItems(
    kind,
    parsedArguments,
    candidates,
  );

  return {
    kind,
    taskId,
    taskType: kind,
    prompt,
    title:
      parsedArguments.title ||
      readMetadataString([metadata, resultRecord, taskResult], ["title"]),
    status: resolveTaskPreviewStatus(status),
    projectId:
      readMetadataString(
        [metadata, resultRecord, taskResult],
        ["project_id", "projectId"],
      ) || null,
    contentId:
      readMetadataString(
        [metadata, resultRecord, taskResult],
        ["content_id", "contentId"],
      ) || null,
    artifactPath:
      kind === "transcription_generate"
        ? buildTranscriptionTaskPreviewArtifactPath(taskId)
        : artifactPath,
    providerId:
      readMetadataString(
        [metadata, resultRecord, taskResult],
        ["provider_id", "providerId", "provider"],
      ) || null,
    model:
      readMetadataString([metadata, resultRecord, taskResult], ["model"]) ||
      null,
    phase: resolveTaskPreviewPhase(status),
    statusMessage: resolveGenericTaskStatusMessage(
      kind,
      resolveTaskPreviewStatus(status),
    ),
    metaItems,
    imageCandidates: kind === "modal_resource_search" ? [] : undefined,
    taskFilePath: kind === "transcription_generate" ? taskFilePath : undefined,
    sourcePath:
      kind === "transcription_generate"
        ? parsedArguments.sourcePath ||
          readMetadataString(
            [metadata, resultRecord, taskResult],
            ["source_path", "sourcePath"],
          ) ||
          null
        : undefined,
    sourceUrl:
      kind === "transcription_generate"
        ? parsedArguments.sourceUrl ||
          readMetadataString(
            [metadata, resultRecord, taskResult],
            ["source_url", "sourceUrl"],
          ) ||
          null
        : undefined,
    language:
      kind === "transcription_generate"
        ? parsedArguments.language ||
          parsedArguments.targetLanguage ||
          readMetadataString(
            [metadata, resultRecord, taskResult],
            ["language", "target_language", "targetLanguage"],
          ) ||
          null
        : undefined,
    outputFormat:
      kind === "transcription_generate"
        ? parsedArguments.outputFormat ||
          readMetadataString(
            [metadata, resultRecord, taskResult],
            ["output_format", "outputFormat", "format"],
          ) ||
          null
        : undefined,
    transcriptPath:
      kind === "transcription_generate"
        ? readMetadataString(
            [metadata, resultRecord, taskResult],
            ["transcript_path", "transcriptPath"],
          ) || null
        : undefined,
    transcriptText:
      kind === "transcription_generate"
        ? parsedTranscript.text || rawTranscriptText || null
        : undefined,
    transcriptSegments:
      kind === "transcription_generate"
        ? normalizeTranscriptSegments(transcriptSegments)
        : undefined,
  };
}

export function buildToolResultArtifactFromToolResult(
  params: ToolResultPreviewParams,
): {
  filePath: string;
  content: string;
  metadata: Record<string, unknown>;
} | null {
  const audioPreview = buildAudioTaskPreviewFromToolResult(params);
  if (audioPreview) {
    const artifactPath =
      audioPreview.artifactPath ||
      buildAudioTaskPreviewArtifactPath(audioPreview.taskId);
    return {
      filePath: artifactPath,
      content: "",
      metadata: {
        artifactDocument: buildAudioTaskArtifactDocument(audioPreview),
        artifact_type: "document",
        previewText:
          audioPreview.statusMessage || "配音任务已写入统一任务产物协议",
        taskId: audioPreview.taskId,
        taskType: "audio_generate",
        taskFilePath: audioPreview.taskFilePath || null,
        audioUrl: audioPreview.audioUrl || null,
        modalityContractKey: "voice_generation",
      },
    };
  }

  const taskPreview = buildGenericTaskPreviewFromToolResult(params);
  if (taskPreview?.kind === "transcription_generate") {
    const artifactPath =
      taskPreview.artifactPath ||
      buildTranscriptionTaskPreviewArtifactPath(taskPreview.taskId);
    return {
      filePath: artifactPath,
      content: "",
      metadata: {
        artifactDocument: buildTranscriptionTaskArtifactDocument(taskPreview),
        artifact_type: "document",
        previewText:
          taskPreview.statusMessage || "转写任务已写入统一任务产物协议",
        taskId: taskPreview.taskId,
        taskType: "transcription_generate",
        taskFilePath: taskPreview.taskFilePath || null,
        transcriptPath: taskPreview.transcriptPath || null,
        transcriptText: taskPreview.transcriptText || null,
        transcriptSegments: taskPreview.transcriptSegments || [],
        transcriptCorrectionEnabled: Boolean(
          taskPreview.transcriptText ||
          (taskPreview.transcriptSegments || []).length > 0,
        ),
        transcriptCorrectionStatus:
          taskPreview.transcriptText ||
          (taskPreview.transcriptSegments || []).length > 0
            ? "available"
            : "waiting_transcript",
        transcriptCorrectionSource: "artifact_document_version",
        transcriptCorrectionPatchKind: "artifact_document_version",
        transcriptCorrectionOriginalImmutable: true,
        sourcePath: taskPreview.sourcePath || null,
        sourceUrl: taskPreview.sourceUrl || null,
        language: taskPreview.language || null,
        outputFormat: taskPreview.outputFormat || null,
        modalityContractKey: "audio_transcription",
      },
    };
  }

  const webImageSearch = readWebImageSearchResult(params);
  if (!webImageSearch) {
    return null;
  }

  const providerLabel = resolveWebImageSearchProviderLabel(
    webImageSearch.provider,
  );
  const query =
    webImageSearch.query?.trim() || params.fallbackPrompt.trim() || "图片素材";
  const returnedCount =
    webImageSearch.returnedCount || webImageSearch.hits.length;
  const artifactPath = buildWebImageSearchArtifactPath(params.toolId, query);
  const artifactDocument = buildWebImageSearchArtifactDocument({
    toolId: params.toolId,
    provider: webImageSearch.provider,
    query,
    returnedCount,
    aspect: webImageSearch.aspect,
    hits: webImageSearch.hits,
  });

  return {
    filePath: artifactPath,
    content: "",
    metadata: {
      artifactDocument,
      artifact_type: "document",
      previewText: `已找到 ${returnedCount} 张${providerLabel}图片候选`,
      provider: webImageSearch.provider || null,
      query,
      returnedCount,
      aspect: webImageSearch.aspect || null,
    },
  };
}

export function buildTaskPreviewFromToolResult(
  params: ToolResultPreviewParams,
): MessageTaskPreview | null {
  return (
    buildVideoTaskPreviewFromToolResult(params) ||
    buildAudioTaskPreviewFromToolResult(params) ||
    buildWebImageSearchTaskPreviewFromToolResult(params) ||
    buildGenericTaskPreviewFromToolResult(params)
  );
}
