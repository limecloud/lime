import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";

export function hasRenderableGeneralCanvasPreview(
  state: Pick<GeneralCanvasState, "isOpen" | "content"> | null | undefined,
): boolean {
  if (!state?.isOpen) {
    return false;
  }

  return state.content.trim().length > 0;
}

export function hasNamedGeneralCanvasFilePreview(
  state:
    | Pick<GeneralCanvasState, "isOpen" | "content" | "filename">
    | null
    | undefined,
): boolean {
  if (!hasRenderableGeneralCanvasPreview(state)) {
    return false;
  }

  return typeof state?.filename === "string" && state.filename.trim().length > 0;
}
