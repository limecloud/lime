import type { Material } from "@/types/material";
import type { MaterialType } from "@/types/material";
import { isHiddenInternalArtifactPath } from "./internalArtifactVisibility";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "ico",
  "heic",
]);

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "m4a", "ogg", "flac"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "flv"]);

export const GENERAL_CHAT_RESOURCE_TAG = "通用对话生成";
export const GENERAL_CHAT_RESOURCE_HASH_TAG_PREFIX = "sys:gchat:path:";
export const GENERAL_CHAT_RESOURCE_SESSION_TAG_PREFIX = "sys:gchat:session:";

function normalizePathForHash(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/");
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function buildGeneralChatResourceHash(filePath: string): string {
  return hashString(normalizePathForHash(filePath));
}

export function buildGeneralChatResourceTags(
  filePath: string,
  sessionId?: string | null,
): string[] {
  const tags = [
    GENERAL_CHAT_RESOURCE_TAG,
    `${GENERAL_CHAT_RESOURCE_HASH_TAG_PREFIX}${buildGeneralChatResourceHash(filePath)}`,
  ];

  const normalizedSessionId = sessionId?.trim();
  if (normalizedSessionId) {
    tags.push(
      `${GENERAL_CHAT_RESOURCE_SESSION_TAG_PREFIX}${normalizedSessionId}`,
    );
  }

  return tags;
}

export function extractGeneralChatResourceHash(
  material: Pick<Material, "tags">,
): string | null {
  const matchedTag = material.tags.find((tag) =>
    tag.startsWith(GENERAL_CHAT_RESOURCE_HASH_TAG_PREFIX),
  );

  return matchedTag
    ? matchedTag.slice(GENERAL_CHAT_RESOURCE_HASH_TAG_PREFIX.length)
    : null;
}

export function hasGeneralChatResourceSync(
  materials: Array<Pick<Material, "tags">>,
  filePath: string,
): boolean {
  const targetHash = buildGeneralChatResourceHash(filePath);
  return materials.some(
    (material) => extractGeneralChatResourceHash(material) === targetHash,
  );
}

export function inferGeneralChatResourceMaterialType(
  filePath: string,
): MaterialType | null {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    return null;
  }

  if (isHiddenInternalArtifactPath(normalizedPath)) {
    return null;
  }

  const normalizedName = normalizedPath.replace(/\\/g, "/");
  const fileName = normalizedName.split("/").pop() || normalizedName;
  const dotIndex = fileName.lastIndexOf(".");
  const extension =
    dotIndex >= 0 && dotIndex < fileName.length - 1
      ? fileName.slice(dotIndex + 1).toLowerCase()
      : "";

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  return "document";
}

export function buildGeneralChatResourceDescription(
  sessionId?: string | null,
): string {
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedSessionId) {
    return "通用对话自动入库";
  }

  return `通用对话自动入库 · 会话 ${normalizedSessionId}`;
}
