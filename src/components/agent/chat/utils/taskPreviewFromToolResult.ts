import { ARTIFACT_DOCUMENT_SCHEMA_VERSION } from "@/lib/artifact-document/types";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import type {
  MessageGenericTaskPreview,
  MessageImageWorkbenchPreview,
  MessageTaskPreview,
  MessageTaskPreviewImageCandidate,
  MessageVideoTaskPreview,
} from "../types";

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
): { prompt?: string; size?: string; imageCount?: number } {
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
    const command =
      typeof parsed.command === "string" ? parsed.command.trim() : undefined;

    if (prompt || size || imageCount || !command) {
      return { prompt, size, imageCount };
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
    .filter(
      (item): item is MessageTaskPreviewImageCandidate => item !== null,
    );

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
  } else if (kind === "url_parse") {
    push(taskArguments.sourceUrl || readMetadataString(candidates, ["url"]));
  } else if (kind === "typesetting") {
    push(taskArguments.targetPlatform);
  }

  return Array.from(items);
}

function resolveGenericTaskStatusMessage(
  kind: MessageGenericTaskPreview["kind"],
  status: MessageGenericTaskPreview["status"],
): string {
  if (status === "complete" || status === "partial") {
    switch (kind) {
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

  return {
    taskId,
    prompt:
      parsedArguments.prompt ||
      params.fallbackPrompt.trim() ||
      "图片任务进行中",
    status: resolveTaskPreviewStatus(status),
    imageCount: parsedArguments.imageCount,
    size: parsedArguments.size,
    phase: resolveTaskPreviewPhase(status),
    statusMessage: "任务已提交到异步队列，正在同步任务状态。",
  };
}

function buildVideoTaskPreviewFromToolResult(
  params: ToolResultPreviewParams,
): MessageVideoTaskPreview | null {
  const resultRecord = asRecord(params.toolResult);
  const metadata = asRecord(resultRecord?.metadata);
  const taskResult = asRecord(resultRecord?.result);
  const firstVideo = readFirstArrayRecord(
    [taskResult, resultRecord],
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
    [firstVideo, taskResult, resultRecord],
    ["url", "result_url", "resultUrl"],
  );
  const thumbnailUrl = readMetadataString(
    [firstVideo, taskResult, resultRecord],
    ["thumbnail_url", "thumbnailUrl", "poster_url", "posterUrl"],
  );
  const durationMs = readMetadataPositiveNumber(
    [firstVideo],
    ["duration_ms", "durationMs"],
  );
  const durationSeconds =
    parsedArguments.durationSeconds ||
    (durationMs ? Math.max(1, Math.round(durationMs / 1000)) : undefined);

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
    phase: resolveTaskPreviewPhase(status),
    statusMessage: videoUrl
      ? "视频结果已同步，打开查看即可继续预览。"
      : "视频任务已提交到异步队列，正在同步任务状态。",
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
    artifactPath,
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
  };
}

export function buildToolResultArtifactFromToolResult(
  params: ToolResultPreviewParams,
): {
  filePath: string;
  content: string;
  metadata: Record<string, unknown>;
} | null {
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
    buildWebImageSearchTaskPreviewFromToolResult(params) ||
    buildGenericTaskPreviewFromToolResult(params)
  );
}
