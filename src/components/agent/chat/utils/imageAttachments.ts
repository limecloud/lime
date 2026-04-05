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
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
};

function normalizeImageMimeType(
  mimeType?: string | null,
  fileName?: string,
): string | null {
  const cleanedMimeType = (mimeType || "").split(";")[0]?.trim().toLowerCase();
  if (cleanedMimeType) {
    if (cleanedMimeType === "image/jpg") {
      return "image/jpeg";
    }
    if (cleanedMimeType.startsWith("image/")) {
      return cleanedMimeType;
    }
  }

  const extension = fileName?.split(".").pop()?.trim().toLowerCase();
  if (!extension) {
    return null;
  }

  return IMAGE_MIME_TYPE_BY_EXTENSION[extension] ?? null;
}

function buildClipboardCandidateKey(candidate: ClipboardImageCandidate): string {
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

  return {
    data: base64Data,
    mediaType,
  };
}

export function buildMessageImageDataUrl(image: MessageImage): string {
  const normalizedMediaType = normalizeImageMimeType(image.mediaType) || "image/png";
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
  const dataUrl = await readFileAsDataUrl(file);
  const { mediaType: dataUrlMediaType, base64Data } = parseDataUrl(dataUrl);

  const mediaType =
    normalizeImageMimeType(preferredMediaType, file.name) ??
    normalizeImageMimeType(dataUrlMediaType, file.name) ??
    normalizeImageMimeType(file.type, file.name);

  if (!mediaType) {
    throw new Error("unsupported_image_type");
  }

  return {
    data: base64Data,
    mediaType,
  };
}
