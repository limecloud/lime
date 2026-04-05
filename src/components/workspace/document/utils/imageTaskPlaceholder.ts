import type { InsertableImage } from "@/lib/documentImageInsertBus";
import {
  insertMarkdownBlock,
  normalizeSelectionAnchorText,
} from "./autoImageInsert";

export type DocumentImageTaskPlaceholderStatus =
  | "running"
  | "failed"
  | "cancelled";

export interface DocumentImageTaskPlaceholderDescriptor {
  taskId: string;
  prompt: string;
  status: DocumentImageTaskPlaceholderStatus;
  slotId?: string | null;
  anchorSectionTitle?: string | null;
  anchorText?: string | null;
}

interface DocumentImageTaskImageDescriptor {
  taskId: string;
  imageUrl: string;
  prompt: string;
  slotId?: string | null;
  anchorSectionTitle?: string | null;
  anchorText?: string | null;
}

const IMAGE_TASK_PLACEHOLDER_PREFIX = "pending-image-task://";
const IMAGE_TASK_SLOT_MARKER_PREFIX = "lime:image-task-slot:";

function normalizePrompt(value?: string | null): string {
  return value?.trim() || "配图任务";
}

function normalizeTaskId(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeSlotId(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeAnchorSectionTitle(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeAnchorText(value?: string | null): string | null {
  return normalizeSelectionAnchorText(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createPlaceholderQuery(params: {
  taskId: string;
  prompt: string;
  status: DocumentImageTaskPlaceholderStatus;
  slotId?: string | null;
}): string {
  const query = new URLSearchParams();
  query.set("status", params.status);
  query.set("prompt", normalizePrompt(params.prompt));
  const normalizedSlotId = normalizeSlotId(params.slotId);
  if (normalizedSlotId) {
    query.set("slot", normalizedSlotId);
  }
  return `${IMAGE_TASK_PLACEHOLDER_PREFIX}${encodeURIComponent(params.taskId)}?${query.toString()}`;
}

function buildSlotMarker(slotId: string): string {
  return `<!-- ${IMAGE_TASK_SLOT_MARKER_PREFIX}${slotId} -->`;
}

function replaceImageUrlForSlot(
  markdown: string,
  slotId: string,
  nextUrl: string,
): string | null {
  const marker = buildSlotMarker(slotId);
  const pattern = new RegExp(
    String.raw`!\[([^\]]*)\]\(([^)]+)\)(\r?\n\s*${escapeRegExp(marker)})`,
  );
  if (!pattern.test(markdown)) {
    return null;
  }
  return markdown.replace(
    pattern,
    (_match, altText: string, _url: string, suffix: string) =>
      `![${altText}](${nextUrl})${suffix}`,
  );
}

function replacePlaceholderUrlForTaskId(
  markdown: string,
  taskId: string,
  nextUrl: string,
): string | null {
  let matched = false;
  const nextContent = markdown.replace(
    /pending-image-task:\/\/[^)\s]+/g,
    (src) => {
      const parsed = parseDocumentImageTaskPlaceholderSrc(src);
      if (!parsed || parsed.taskId !== taskId) {
        return src;
      }
      matched = true;
      return nextUrl;
    },
  );
  return matched ? nextContent : null;
}

function createPlaceholderImage(
  prompt: string,
  contentUrl: string,
): InsertableImage {
  return {
    id: `document-image-task:${crypto.randomUUID()}`,
    previewUrl: contentUrl,
    contentUrl,
    title: normalizePrompt(prompt),
    provider: "lime",
  };
}

function createImageTaskBlockLines(params: {
  imageUrl: string;
  prompt: string;
  slotId?: string | null;
}): string[] {
  const image = createPlaceholderImage(params.prompt, params.imageUrl);
  const lines = [`![${image.title || "配图任务"}](${image.contentUrl})`];
  const normalizedSlotId = normalizeSlotId(params.slotId);
  if (normalizedSlotId) {
    lines.push(buildSlotMarker(normalizedSlotId));
  }
  return lines;
}

function appendImageTaskBlock(
  markdown: string,
  imageUrl: string,
  prompt: string,
  slotId?: string | null,
  anchorSectionTitle?: string | null,
  anchorText?: string | null,
): string {
  return insertMarkdownBlock(
    markdown,
    createImageTaskBlockLines({
      imageUrl,
      prompt,
      slotId,
    }),
    {
      sectionTitle: normalizeAnchorSectionTitle(anchorSectionTitle),
      anchorText: normalizeAnchorText(anchorText),
    },
  );
}

export function buildDocumentImageTaskPlaceholderSrc(
  params: DocumentImageTaskPlaceholderDescriptor,
): string {
  const normalizedTaskId = normalizeTaskId(params.taskId);
  if (!normalizedTaskId) {
    return "";
  }
  return createPlaceholderQuery({
    taskId: normalizedTaskId,
    prompt: params.prompt,
    status: params.status,
    slotId: params.slotId,
  });
}

export function parseDocumentImageTaskPlaceholderSrc(
  src?: string | null,
): (DocumentImageTaskPlaceholderDescriptor & { src: string }) | null {
  const normalizedSrc = src?.trim();
  if (!normalizedSrc?.startsWith(IMAGE_TASK_PLACEHOLDER_PREFIX)) {
    return null;
  }

  const rest = normalizedSrc.slice(IMAGE_TASK_PLACEHOLDER_PREFIX.length);
  const [encodedTaskId, rawQuery = ""] = rest.split("?");
  const taskId = normalizeTaskId(decodeURIComponent(encodedTaskId || ""));
  if (!taskId) {
    return null;
  }

  const query = new URLSearchParams(rawQuery);
  const statusRaw = query.get("status")?.trim().toLowerCase();
  const status: DocumentImageTaskPlaceholderStatus =
    statusRaw === "failed"
      ? "failed"
      : statusRaw === "cancelled"
        ? "cancelled"
        : "running";

  return {
    src: normalizedSrc,
    taskId,
    prompt: normalizePrompt(query.get("prompt")),
    status,
    slotId: normalizeSlotId(query.get("slot")),
  };
}

export function isDocumentImageTaskPlaceholderSrc(
  src?: string | null,
): boolean {
  return parseDocumentImageTaskPlaceholderSrc(src) !== null;
}

export function upsertDocumentImageTaskPlaceholder(
  markdown: string,
  params: DocumentImageTaskPlaceholderDescriptor,
): string {
  const placeholderSrc = buildDocumentImageTaskPlaceholderSrc(params);
  if (!placeholderSrc) {
    return markdown;
  }

  const normalizedSlotId = normalizeSlotId(params.slotId);
  if (normalizedSlotId) {
    const replacedBySlot = replaceImageUrlForSlot(
      markdown,
      normalizedSlotId,
      placeholderSrc,
    );
    if (replacedBySlot) {
      return replacedBySlot;
    }
  }

  const replacedByTaskId = replacePlaceholderUrlForTaskId(
    markdown,
    params.taskId,
    placeholderSrc,
  );
  if (replacedByTaskId) {
    return replacedByTaskId;
  }

  return appendImageTaskBlock(
    markdown,
    placeholderSrc,
    params.prompt,
    params.slotId,
    params.anchorSectionTitle,
    params.anchorText,
  );
}

export function replaceDocumentImageTaskPlaceholderWithImage(
  markdown: string,
  params: DocumentImageTaskImageDescriptor,
): string {
  const normalizedImageUrl = params.imageUrl.trim();
  if (!normalizedImageUrl) {
    return markdown;
  }

  const normalizedSlotId = normalizeSlotId(params.slotId);
  if (normalizedSlotId) {
    const replacedBySlot = replaceImageUrlForSlot(
      markdown,
      normalizedSlotId,
      normalizedImageUrl,
    );
    if (replacedBySlot) {
      return replacedBySlot;
    }
  }

  const replacedByTaskId = replacePlaceholderUrlForTaskId(
    markdown,
    params.taskId,
    normalizedImageUrl,
  );
  if (replacedByTaskId) {
    return replacedByTaskId;
  }

  if (markdown.includes(`(${normalizedImageUrl})`)) {
    return markdown;
  }

  return appendImageTaskBlock(
    markdown,
    normalizedImageUrl,
    params.prompt,
    params.slotId,
    params.anchorSectionTitle,
    params.anchorText,
  );
}
