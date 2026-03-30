/**
 * @file workbenchContract.ts
 * @description 工作台共享契约：主题、创作模式、布局与流程状态
 * @module lib/workspace/workbenchContract
 */

export const WORKBENCH_THEME_TYPES = [
  "general",
  "social-media",
  "poster",
  "music",
  "knowledge",
  "planning",
  "document",
  "video",
  "novel",
] as const;

export type ThemeType = (typeof WORKBENCH_THEME_TYPES)[number];

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

export function normalizeThemeType(value?: string | null): ThemeType {
  if (value && isThemeType(value)) {
    return value;
  }
  return "general";
}

export function isContentCreationTheme(
  theme: string,
): theme is Exclude<ThemeType, "general"> {
  return isThemeType(theme) && theme !== "general";
}
