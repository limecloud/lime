import { toast } from "sonner";
import type { MessageImage } from "../types";
import type { ParsedImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import { readMessageImageFromDataUrl } from "../utils/imageAttachments";
import {
  collapseWhitespace,
  type ImageWorkbenchApplyTarget,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";

export interface ImageWorkbenchSkillRequest {
  images: MessageImage[];
  requestContext: Record<string, unknown>;
}

interface ResolveImageWorkbenchSkillRequestParams {
  rawText: string;
  parsedCommand: ParsedImageWorkbenchCommand;
  images: MessageImage[];
  currentImageWorkbenchState: SessionImageWorkbenchState;
  imageWorkbenchSelectedModelId?: string;
  imageWorkbenchSelectedProviderId?: string;
  imageWorkbenchSelectedSize: string;
  imageWorkbenchSessionKey: string;
  sessionIdOverride?: string | null;
  projectId?: string | null;
  projectRootPath?: string | null;
  contentId?: string | null;
  applyTarget?: ImageWorkbenchApplyTarget | null;
  entrySource?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function buildModelSkillLaunchRequestMetadata(params: {
  existingMetadata: Record<string, unknown> | undefined;
  requestContext: Record<string, unknown>;
  launchKey: "image_skill_launch";
  requestContextKey: "image_task";
  defaultKind: "image_task";
  skillName: "image_generate";
}): Record<string, unknown> {
  const scopedRequestContext = asRecord(
    params.requestContext[params.requestContextKey],
  );
  const existingHarness = asRecord(params.existingMetadata?.harness);

  return {
    ...(params.existingMetadata || {}),
    harness: {
      ...(existingHarness || {}),
      allow_model_skills: true,
      [params.launchKey]: {
        skill_name: params.skillName,
        kind:
          typeof params.requestContext.kind === "string"
            ? params.requestContext.kind
            : params.defaultKind,
        ...(scopedRequestContext
          ? {
              [params.requestContextKey]: scopedRequestContext,
            }
          : { request_context: params.requestContext }),
      },
    },
  };
}

function createSkillInputImageRef(index: number): string {
  return `skill-input-image://${index + 1}`;
}

function maybeReadMessageImageFromValue(value: string): MessageImage | null {
  const normalized = value.trim();
  if (!normalized.toLowerCase().startsWith("data:image/")) {
    return null;
  }

  try {
    return readMessageImageFromDataUrl(normalized);
  } catch {
    return null;
  }
}

export function isLocalImageWorkbenchSessionKey(
  sessionKey: string | null | undefined,
): boolean {
  return sessionKey?.trim().startsWith("__local_image_workbench__:") ?? false;
}

export function buildImageWorkbenchSessionTitle(
  mode: ParsedImageWorkbenchCommand["mode"],
  prompt: string,
): string {
  const normalizedPrompt = collapseWhitespace(prompt) || "图片任务";
  const prefix =
    mode === "edit" ? "修图" : mode === "variation" ? "重绘" : "配图";
  const title = `${prefix}：${normalizedPrompt}`;
  return title.length > 36 ? `${title.slice(0, 33)}...` : title;
}

function createDocumentImageTaskSlotId(): string {
  return `document-image-slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildImageSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "image_skill_launch",
    requestContextKey: "image_task",
    defaultKind: "image_task",
    skillName: "image_generate",
  });
}

export function resolveImageWorkbenchSkillRequest(
  params: ResolveImageWorkbenchSkillRequestParams,
): ImageWorkbenchSkillRequest | null {
  if (!params.projectId) {
    toast.error("请先选择项目后再开始配图");
    return null;
  }
  if (!params.projectRootPath?.trim()) {
    toast.error("当前项目目录未就绪，暂时无法创建图片任务");
    return null;
  }

  const { rawText, parsedCommand, images } = params;
  const targetOutput = parsedCommand.targetRef
    ? params.currentImageWorkbenchState.outputs.find(
        (item) =>
          item.refId.toLowerCase() === parsedCommand.targetRef?.toLowerCase(),
      ) || null
    : null;
  const effectiveApplyTarget =
    params.applyTarget ?? targetOutput?.applyTarget ?? null;
  const documentInlineSlotId =
    effectiveApplyTarget?.kind === "canvas-insert" &&
    effectiveApplyTarget.canvasType === "document"
      ? createDocumentImageTaskSlotId()
      : undefined;
  const documentInlineAnchorHint =
    effectiveApplyTarget?.kind === "canvas-insert" &&
    effectiveApplyTarget.canvasType === "document"
      ? effectiveApplyTarget.anchorHint
      : undefined;
  const documentInlineAnchorSectionTitle =
    effectiveApplyTarget?.kind === "canvas-insert" &&
    effectiveApplyTarget.canvasType === "document"
      ? effectiveApplyTarget.sectionTitle
      : undefined;
  const documentInlineAnchorText =
    effectiveApplyTarget?.kind === "canvas-insert" &&
    effectiveApplyTarget.canvasType === "document"
      ? effectiveApplyTarget.anchorText
      : undefined;

  if (
    (parsedCommand.mode === "edit" || parsedCommand.mode === "variation") &&
    !targetOutput &&
    images.length === 0
  ) {
    toast.error("修图或重绘任务需要选择已有图片，或先附加参考图");
    return null;
  }

  const effectivePrompt =
    parsedCommand.prompt.trim() ||
    (parsedCommand.mode === "generate" ? "" : "请基于参考图继续优化画面表现");
  if (!effectivePrompt) {
    toast.error("请补充清晰的配图描述后再提交");
    return null;
  }

  const skillImages: MessageImage[] = [];
  const referenceImages: string[] = [];
  const pushSkillImage = (image: MessageImage) => {
    skillImages.push(image);
    referenceImages.push(createSkillInputImageRef(skillImages.length - 1));
  };
  const pushReferenceImage = (value: string | undefined | null) => {
    const normalized = value?.trim();
    if (!normalized || referenceImages.includes(normalized)) {
      return;
    }
    referenceImages.push(normalized);
  };

  const targetOutputImage = targetOutput
    ? maybeReadMessageImageFromValue(targetOutput.url)
    : null;
  if (targetOutputImage) {
    pushSkillImage(targetOutputImage);
  } else {
    pushReferenceImage(targetOutput?.url);
  }

  images.forEach((image) => {
    pushSkillImage(image);
  });

  const resolvedSessionId =
    params.sessionIdOverride?.trim() || params.imageWorkbenchSessionKey.trim();
  const requestedTarget =
    effectiveApplyTarget?.kind === "document-cover" ? "cover" : "generate";
  const usage =
    requestedTarget === "cover"
      ? "cover"
      : documentInlineSlotId
        ? "document-inline"
        : "claw-image-workbench";

  const requestContext = {
    kind: "image_task",
    image_task: {
      mode: parsedCommand.mode,
      prompt: effectivePrompt,
      raw_text: rawText,
      count: parsedCommand.count,
      size: parsedCommand.size || params.imageWorkbenchSelectedSize,
      aspect_ratio: parsedCommand.aspectRatio,
      usage,
      provider_id: params.imageWorkbenchSelectedProviderId,
      model: params.imageWorkbenchSelectedModelId,
      session_id: resolvedSessionId || undefined,
      project_id: params.projectId,
      content_id: params.contentId || undefined,
      entry_source: params.entrySource || "at_image_command",
      requested_target: requestedTarget,
      slot_id: documentInlineSlotId,
      anchor_hint: documentInlineAnchorHint,
      anchor_section_title: documentInlineAnchorSectionTitle ?? undefined,
      anchor_text: documentInlineAnchorText ?? undefined,
      target_output_id: targetOutput?.id,
      target_output_ref_id: targetOutput?.refId,
      reference_images: referenceImages,
      target_output_summary: targetOutput
        ? {
            prompt: collapseWhitespace(targetOutput.prompt) || undefined,
            provider_name: targetOutput.providerName,
            model_name: targetOutput.modelName,
            size: targetOutput.size,
            url:
              targetOutputImage || !targetOutput.url.trim()
                ? undefined
                : targetOutput.url.trim(),
          }
        : undefined,
      skill_input_images: skillImages.map((image, index) => ({
        ref: createSkillInputImageRef(index),
        media_type: image.mediaType,
        source:
          index === 0 && targetOutputImage ? "target_output" : "attachment",
      })),
    },
  } satisfies Record<string, unknown>;

  return {
    images: skillImages,
    requestContext,
  };
}
