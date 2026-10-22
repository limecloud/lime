import { resolvePreferredFilePreviewMode } from "../../workspace/filePreviewModel";
import type { CanvasWorkbenchDefaultPreview } from "../CanvasWorkbenchLayoutViewModel";

export type { CanvasWorkbenchDefaultPreview } from "../CanvasWorkbenchLayoutViewModel";

export type CanvasWorkbenchTab = "markdown" | "html" | "code" | "changes";
export type CanvasWorkbenchLayoutMode = "split" | "stacked";
export type CanvasWorkbenchMode = "default" | "coding";

export type CanvasWorkbenchTranslation = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export const WORKBENCH_SHELL_CLASSNAME =
  "border-l border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]";

export const WORKBENCH_PANEL_CLASSNAME =
  "rounded-[10px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]";

export const WORKBENCH_MUTED_PANEL_CLASSNAME =
  "rounded-[10px] border border-dashed border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)] px-4 py-5 text-sm text-[color:var(--lime-text-muted)]";

export const WORKBENCH_GHOST_BUTTON_CLASSNAME =
  "border-[color:var(--lime-surface-border)] text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-soft)] hover:text-[color:var(--lime-text-strong)]";

export function resolveInitialCanvasWorkbenchTab(
  defaultPreview: CanvasWorkbenchDefaultPreview | null,
  changeView: { items?: unknown[] } | null | undefined,
  initialDocumentPath: string | null | undefined,
  shouldPreferReviewTab: boolean,
): CanvasWorkbenchTab {
  if (
    shouldPreferReviewTab ||
    (changeView?.items?.length || 0) > 0 ||
    defaultPreview?.previousContent
  ) {
    return "changes";
  }

  if (defaultPreview || initialDocumentPath) {
    return resolvePreferredFilePreviewMode(
      defaultPreview?.filePath ||
        defaultPreview?.absolutePath ||
        defaultPreview?.title ||
        initialDocumentPath,
    );
  }

  return "changes";
}

export function translateCanvasWorkbenchText(
  t: CanvasWorkbenchTranslation,
  key: string,
  options?: Record<string, unknown>,
): string {
  const translated = t(key, options);
  if (translated !== key || !options) {
    return translated;
  }
  const fallbackDetails = Object.values(options)
    .filter(
      (value) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    )
    .map(String)
    .filter((value) => value.trim().length > 0);
  return fallbackDetails.length > 0
    ? `${key} ${fallbackDetails.join(" ")}`
    : translated;
}
