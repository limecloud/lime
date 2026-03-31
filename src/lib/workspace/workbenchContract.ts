/**
 * @file workbenchContract.ts
 * @description 工作台共享契约：主题、创作模式、布局与流程状态
 * @module lib/workspace/workbenchContract
 */

export const WORKBENCH_THEME_TYPES = [
  "general",
  "social-media",
  "knowledge",
  "planning",
  "document",
  "video",
] as const;

export type ThemeType = (typeof WORKBENCH_THEME_TYPES)[number];
export type ThemeCanvasType = Extract<ThemeType, "document" | "video">;

const LEGACY_THEME_ALIASES: Record<string, ThemeType> = {
  poster: "document",
  music: "document",
  novel: "document",
  script: "video",
};

export type CreationMode = "guided" | "fast" | "hybrid" | "framework";

export type LayoutMode = "chat" | "chat-canvas" | "canvas";

export type StepType =
  | "clarify"
  | "research"
  | "outline"
  | "write"
  | "polish"
  | "adapt";

export type StepStatus =
  | "pending"
  | "active"
  | "completed"
  | "skipped"
  | "error";

export function isThemeType(value: string): value is ThemeType {
  return (WORKBENCH_THEME_TYPES as readonly string[]).includes(value);
}

export function normalizeThemeTypeOrNull(
  value?: string | null,
): ThemeType | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized && isThemeType(normalized)) {
    return normalized;
  }
  if (normalized && normalized in LEGACY_THEME_ALIASES) {
    return LEGACY_THEME_ALIASES[normalized];
  }
  return null;
}

export function normalizeThemeType(value?: string | null): ThemeType {
  const normalized = normalizeThemeTypeOrNull(value);
  if (normalized) {
    return normalized;
  }
  return "general";
}

export function normalizeThemeCanvasType(
  value?: string | null,
): ThemeCanvasType | null {
  const normalized = normalizeThemeTypeOrNull(value);
  if (normalized === "document" || normalized === "video") {
    return normalized;
  }
  return null;
}

export function isSpecializedWorkbenchTheme(
  theme: string,
): theme is Exclude<ThemeType, "general"> {
  return isThemeType(theme) && theme !== "general";
}
