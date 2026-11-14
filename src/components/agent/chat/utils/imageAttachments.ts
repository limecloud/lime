import type { MessageImage } from "../types";

export interface ClipboardImageCandidate {
  file: File;
  mediaType?: string;
}

const IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export const MAX_IMAGE_ATTACHMENTS_PER_TURN = 20;
export const MAX_IMAGE_ATTACHMENT_BYTES = 3_932_160;
export const SUPPORTED_IMAGE_ATTACHMENT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

const SUPPORTED_IMAGE_ATTACHMENT_MEDIA_TYPE_SET = new Set<string>(
  SUPPORTED_IMAGE_ATTACHMENT_MEDIA_TYPES,
);

export function normalizeImageMimeType(
  mimeType?: string | null,
  fileName?: string,
): string | null {
  const cleanedMimeType = (mimeType || "").split(";")[0]?.trim().toLowerCase();
  if (cleanedMimeType) {
    if (cleanedMimeType === "image/jpg") {
      return "image/jpeg";
    }
    if (SUPPORTED_IMAGE_ATTACHMENT_MEDIA_TYPE_SET.has(cleanedMimeType)) {
      return cleanedMimeType;
    }
  }

  const extension = fileName?.split(".").pop()?.trim().toLowerCase();
  if (!extension) {
    return null;
  }

  return IMAGE_MIME_TYPE_BY_EXTENSION[extension] ?? null;
}

function assertSupportedImageSize(byteLength: number) {
  if (byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error("image_too_large");
  }
}

function estimateBase64DecodedBytes(base64Data: string): number {
  const normalized = base64Data.replace(/\s+/g, "");
  if (!normalized) {
    return 0;
  }
  const paddingLength = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - paddingLength);
}

function buildClipboardCandidateKey(
  candidate: ClipboardImageCandidate,
): string {
  const { file, mediaType } = candidate;
  return [
    file.name || "clipboard-image",
    file.size,
    file.lastModified,
    mediaType || "",
  ].join(":");
}

function parseDataUrl(dataUrl: string): {
  mediaType: string | null;
  base64Data: string;
} {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("invalid_data_url");
  }

  const header = dataUrl.slice(0, commaIndex);
  const base64Data = dataUrl.slice(commaIndex + 1).replace(/\s+/g, "");
  const mediaTypeMatch = /^data:([^;,]+)/i.exec(header);
  const mediaType = normalizeImageMimeType(mediaTypeMatch?.[1] ?? null);

  return {
    mediaType,
    base64Data,
  };
}

export function readMessageImageFromDataUrl(dataUrl: string): MessageImage {
  const { mediaType, base64Data } = parseDataUrl(dataUrl);
  if (!mediaType) {
    throw new Error("unsupported_image_type");
  }
  assertSupportedImageSize(estimateBase64DecodedBytes(base64Data));

  return {
    data: base64Data,
    mediaType,
  };
}

/** 把 data URL 还原成 File，交给 addImages 走与选择/粘贴相同的读取与校验路径。 */
export function createImageAttachmentFile(
  dataUrl: string,
  fileName = "app-snapshot.png",
): File {
  const image = readMessageImageFromDataUrl(dataUrl);
  if (!image.data) {
    throw new Error("invalid_image_data");
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(image.data);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  } catch {
    throw new Error("invalid_image_data");
  }

  return new File([bytes.buffer as ArrayBuffer], fileName, {
    type: image.mediaType,
  });
}

export function buildMessageImageDataUrl(image: MessageImage): string {
  const normalizedMediaType =
    normalizeImageMimeType(image.mediaType) || "image/png";
  return `data:${normalizedMediaType};base64,${image.data}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== "string" || result.length === 0) {
        reject(new Error("invalid_result"));
        return;
      }
      resolve(result);
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("read_failed"));
    };

    reader.readAsDataURL(file);
  });
}

export function getClipboardImageCandidates(
  clipboardData?: DataTransfer | null,
): ClipboardImageCandidate[] {
  if (!clipboardData) {
    return [];
  }

  const uniqueCandidates = new Map<string, ClipboardImageCandidate>();
  const pushCandidate = (candidate: ClipboardImageCandidate | null) => {
    if (!candidate) {
      return;
    }
    const mediaType = normalizeImageMimeType(
      candidate.mediaType ?? candidate.file.type,
      candidate.file.name,
    );
    if (!mediaType) {
      return;
    }

    const normalizedCandidate: ClipboardImageCandidate = {
      file: candidate.file,
      mediaType,
    };
    uniqueCandidates.set(
      buildClipboardCandidateKey(normalizedCandidate),
      normalizedCandidate,
    );
  };

  Array.from(clipboardData.items || []).forEach((item) => {
    if (item.kind !== "file") {
      return;
    }

    const file = item.getAsFile();
    if (!file) {
      return;
    }

    pushCandidate({
      file,
      mediaType: item.type,
    });
  });

  if (uniqueCandidates.size > 0) {
    return Array.from(uniqueCandidates.values());
  }

  Array.from(clipboardData.files || []).forEach((file) => {
    pushCandidate({
      file,
      mediaType: file.type,
    });
  });

  return Array.from(uniqueCandidates.values());
}

export async function readImageAttachment(
  file: File,
  preferredMediaType?: string,
): Promise<MessageImage> {
  assertSupportedImageSize(file.size);
  const dataUrl = await readFileAsDataUrl(file);
  const { mediaType: dataUrlMediaType, base64Data } = parseDataUrl(dataUrl);

  const mediaType =
    normalizeImageMimeType(preferredMediaType, file.name) ??
    normalizeImageMimeType(dataUrlMediaType, file.name) ??
    normalizeImageMimeType(file.type, file.name);

  if (!mediaType) {
    throw new Error("unsupported_image_type");
  }
  assertSupportedImageSize(estimateBase64DecodedBytes(base64Data));

  return {
    data: base64Data,
    mediaType,
  };
}
