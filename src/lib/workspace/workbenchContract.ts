/**
 * @file workbenchContract.ts
 * @description 工作台共享契约：主题、创作模式、布局与流程状态
 * @module lib/workspace/workbenchContract
 */

export const WORKBENCH_THEME_TYPES = ["general"] as const;

export type ThemeType = (typeof WORKBENCH_THEME_TYPES)[number];
export type ThemeCanvasType = "document" | "video";

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
  if (normalized === "general") {
    return normalized;
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
  const normalized = value?.trim().toLowerCase();
  if (normalized === "document" || normalized === "video") {
    return normalized;
  }
  return null;
}

export function isSpecializedWorkbenchTheme(_theme: string): boolean {
  return false;
}
