import { normalizeThemeCanvasType } from "@/lib/workspace/workbenchContract";

const CANVAS_IMAGE_INSERT_EVENT = "lime:canvas-image-insert-request";
const CANVAS_IMAGE_INSERT_ACK_EVENT = "lime:canvas-image-insert-ack";
const CANVAS_IMAGE_INSERT_QUEUE_KEY = "lime:canvas-image-insert-queue";
const MAX_QUEUE_SIZE = 40;

export type CanvasImageInsertSource =
  | "pexels"
  | "pixabay"
  | "gallery"
  | "manual";

export type CanvasImageTargetType =
  | "auto"
  | "document"
  | "video";

export type CanvasImageInsertAnchorHint =
  | "cursor"
  | "section_end"
  | "scene_end"
  | "video_start_frame";

export interface InsertableImage {
  id: string;
  previewUrl: string;
  contentUrl: string;
  pageUrl?: string;
  title?: string;
  width?: number;
  height?: number;
  attributionName?: string;
  provider?: string;
}

export interface CanvasImageInsertRequest {
  requestId: string;
  createdAt: number;
  projectId: string | null;
  contentId: string | null;
  canvasType: CanvasImageTargetType;
  anchorHint?: CanvasImageInsertAnchorHint;
  source: CanvasImageInsertSource;
  image: InsertableImage;
}

export interface EmitCanvasImageInsertRequestInput {
  projectId?: string | null;
  contentId?: string | null;
  canvasType?: CanvasImageTargetType;
  anchorHint?: CanvasImageInsertAnchorHint;
  source: CanvasImageInsertSource;
  image: InsertableImage;
}

export interface CanvasImageInsertAck {
  requestId: string;
  processedAt: number;
  success: boolean;
  canvasType: CanvasImageTargetType;
  locationLabel?: string;
  reason?: string;
}

const hasWindow = () => typeof window !== "undefined";

const normalizeId = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const VALID_CANVAS_TYPES = new Set<CanvasImageTargetType>([
  "auto",
  "document",
  "video",
]);

const normalizeCanvasType = (
  value: CanvasImageTargetType | string | null | undefined,
): CanvasImageTargetType => {
  if (!value) return "auto";
  const normalized = value.trim().toLowerCase();
  if (VALID_CANVAS_TYPES.has(normalized as CanvasImageTargetType)) {
    return normalized as CanvasImageTargetType;
  }
  return normalizeThemeCanvasType(normalized) ?? "auto";
};

const createRequest = (
  input: EmitCanvasImageInsertRequestInput,
): CanvasImageInsertRequest => ({
  requestId: crypto.randomUUID(),
  createdAt: Date.now(),
  projectId: normalizeId(input.projectId),
  contentId: normalizeId(input.contentId),
  canvasType: normalizeCanvasType(input.canvasType),
  anchorHint: input.anchorHint,
  source: input.source,
  image: input.image,
});

const readQueue = (): CanvasImageInsertRequest[] => {
  if (!hasWindow()) return [];
  try {
    const raw = localStorage.getItem(CANVAS_IMAGE_INSERT_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is CanvasImageInsertRequest => {
      return (
        item &&
        typeof item === "object" &&
        typeof item.requestId === "string" &&
        typeof item.createdAt === "number" &&
        typeof item.source === "string" &&
        item.image &&
        typeof item.image.contentUrl === "string"
      );
    });
  } catch {
    return [];
  }
};

const writeQueue = (queue: CanvasImageInsertRequest[]) => {
  if (!hasWindow()) return;
  localStorage.setItem(
    CANVAS_IMAGE_INSERT_QUEUE_KEY,
    JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)),
  );
};

export const getPendingCanvasImageInsertRequests = () => readQueue();

export const ackCanvasImageInsertRequest = (requestId: string): void => {
  if (!requestId) return;
  const queue = readQueue();
  const nextQueue = queue.filter((item) => item.requestId !== requestId);
  if (nextQueue.length === queue.length) return;
  writeQueue(nextQueue);
};

export const emitCanvasImageInsertRequest = (
  input: EmitCanvasImageInsertRequestInput,
): CanvasImageInsertRequest => {
  const request = createRequest(input);
  const queue = readQueue();
  queue.push(request);
  writeQueue(queue);

  if (hasWindow()) {
    window.dispatchEvent(
      new CustomEvent<CanvasImageInsertRequest>(CANVAS_IMAGE_INSERT_EVENT, {
        detail: request,
      }),
    );
  }

  return request;
};

export const onCanvasImageInsertRequest = (
  listener: (request: CanvasImageInsertRequest) => void,
): (() => void) => {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }
    const request = (event as CustomEvent<CanvasImageInsertRequest>).detail;
    if (!request || typeof request.requestId !== "string") {
      return;
    }
    listener(request);
  };

  window.addEventListener(CANVAS_IMAGE_INSERT_EVENT, handler);
  return () => {
    window.removeEventListener(CANVAS_IMAGE_INSERT_EVENT, handler);
  };
};

export const emitCanvasImageInsertAck = (ack: Omit<CanvasImageInsertAck, "processedAt">) => {
  if (!hasWindow()) return;
  const payload: CanvasImageInsertAck = {
    ...ack,
    processedAt: Date.now(),
  };
  window.dispatchEvent(
    new CustomEvent<CanvasImageInsertAck>(CANVAS_IMAGE_INSERT_ACK_EVENT, {
      detail: payload,
    }),
  );
};

export const onCanvasImageInsertAck = (
  listener: (ack: CanvasImageInsertAck) => void,
): (() => void) => {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }
    const ack = (event as CustomEvent<CanvasImageInsertAck>).detail;
    if (!ack || typeof ack.requestId !== "string") {
      return;
    }
    listener(ack);
  };

  window.addEventListener(CANVAS_IMAGE_INSERT_ACK_EVENT, handler);
  return () => {
    window.removeEventListener(CANVAS_IMAGE_INSERT_ACK_EVENT, handler);
  };
};

export const matchesCanvasImageInsertTarget = (
  request: CanvasImageInsertRequest,
  target: {
    projectId?: string | null;
    contentId?: string | null;
    canvasType: CanvasImageTargetType;
  },
): boolean => {
  if (request.projectId && request.projectId !== (target.projectId || null)) {
    return false;
  }
  if (request.contentId && request.contentId !== (target.contentId || null)) {
    return false;
  }
  if (
    request.canvasType !== "auto" &&
    request.canvasType !== target.canvasType
  ) {
    return false;
  }
  return true;
};
