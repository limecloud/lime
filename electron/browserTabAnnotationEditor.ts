import type { BrowserWindow } from "./electronRuntime";
import type { WebContentsView } from "electron";
import type { BrowserOverlayHost } from "./browserOverlayHost";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";
import type { BrowserAnnotationEditorPresentation } from "../src/lib/api/browserAnnotationEditorTypes";

export const BROWSER_ANNOTATION_EDITOR_COMMANDS = [
  "browser_tab_show_annotation_editor",
  "browser_tab_update_annotation_editor",
  "browser_tab_close_annotation_editor",
] as const;
export type BrowserAnnotationEditorCommand =
  (typeof BROWSER_ANNOTATION_EDITOR_COMMANDS)[number];

export function invokeBrowserAnnotationEditor(
  overlay: BrowserOverlayHost,
  window: BrowserWindow,
  command: BrowserAnnotationEditorCommand,
  args: Record<string, unknown>,
  view: WebContentsView,
  identity: BrowserAnnotationIdentity,
): unknown {
  const keys =
    command === "browser_tab_show_annotation_editor"
      ? ["tabId", "presentation"]
      : command === "browser_tab_update_annotation_editor"
        ? ["tabId", "editorId", "generation", "pending", "error"]
        : ["tabId", "editorId", "generation"];
  if (Object.keys(args).some((key) => !keys.includes(key)))
    throw new Error("Unsupported browser annotation editor field");
  if (command === "browser_tab_show_annotation_editor")
    return overlay.showAnnotation(
      window,
      identity.viewId,
      args.presentation as BrowserAnnotationEditorPresentation,
      view.webContents,
      view.getBounds(),
      identity,
    );
  if (
    typeof args.editorId !== "string" ||
    !args.editorId.trim() ||
    !Number.isSafeInteger(args.generation) ||
    Number(args.generation) < 1
  )
    throw new Error("Invalid browser annotation editor identity");
  const editor = {
    editorId: args.editorId,
    generation: args.generation as number,
  };
  if (command === "browser_tab_close_annotation_editor")
    return { closed: overlay.closeAnnotation(identity.viewId, editor) };
  if (typeof args.pending !== "boolean" || typeof args.error !== "boolean")
    throw new Error("Invalid browser annotation editor state");
  return overlay.updateAnnotation(identity.viewId, {
    ...editor,
    pending: args.pending,
    error: args.error,
  });
}
