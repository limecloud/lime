import { normalizeThemeCanvasType } from "@/lib/workspace/workbenchContract";

const ACTIVE_CONTENT_TARGET_KEY = "lime-active-content-target";

export type ActiveCanvasType =
  | "document"
  | "video"
  | null;

export interface ActiveContentTarget {
  projectId: string | null;
  contentId: string | null;
  canvasType?: ActiveCanvasType;
  updatedAt: number;
}

const hasWindow = () => typeof window !== "undefined";

const normalizeId = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeCanvasType = (
  value: string | null | undefined,
): ActiveCanvasType => {
  return normalizeThemeCanvasType(value);
};

export const getActiveContentTarget = (): ActiveContentTarget | null => {
  if (!hasWindow()) return null;
  try {
    const raw = localStorage.getItem(ACTIVE_CONTENT_TARGET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveContentTarget>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      projectId: normalizeId(parsed.projectId),
      contentId: normalizeId(parsed.contentId),
      canvasType: normalizeCanvasType(
        typeof parsed.canvasType === "string" ? parsed.canvasType : null,
      ),
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
};

export const setActiveContentTarget = (
  projectId?: string | null,
  contentId?: string | null,
  canvasType?: ActiveCanvasType,
) => {
  if (!hasWindow()) return;
  const payload: ActiveContentTarget = {
    projectId: normalizeId(projectId),
    contentId: normalizeId(contentId),
    canvasType: normalizeCanvasType(canvasType || null),
    updatedAt: Date.now(),
  };

  if (!payload.projectId && !payload.contentId) {
    localStorage.removeItem(ACTIVE_CONTENT_TARGET_KEY);
    return;
  }

  localStorage.setItem(ACTIVE_CONTENT_TARGET_KEY, JSON.stringify(payload));
};
