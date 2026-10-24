import type { BrowserDesignPreview } from "./browserDesignPreview";
import type { PageAnnotation } from "./browserAnnotationMarkers";
import type { BrowserAnnotationSelection } from "../src/lib/api/browserAnnotationTypes";

/** Private retained-element preparation; no capability is exposed to the page. */
export function prepareDesignCapture(
  entry: PageAnnotation,
  message: Record<string, unknown>,
  designs: BrowserDesignPreview,
  selection: () => BrowserAnnotationSelection | null,
  send: (payload: Record<string, unknown>) => void,
): void {
  if (typeof message.requestId !== "string" || !message.requestId) return;
  const requestId = message.requestId;
  if (message.type === "clear-design-capture") {
    designs.clearCapture(entry.annotationId, requestId);
    return;
  }
  try {
    if (
      entry.kind !== "element" ||
      !designs.prepareCapture(entry.annotationId, requestId, message.change)
    ) {
      send({ type: "ready", requestId, status: "stale" });
      return;
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!designs.captureCurrent(entry.annotationId, requestId)) return;
        const live = selection();
        send({
          type: "ready",
          requestId,
          status: live ? "ready" : "stale",
          selection: live,
        });
      }),
    );
  } catch {
    designs.clearCapture(entry.annotationId, requestId);
    send({ type: "ready", requestId, status: "stale" });
  }
}
