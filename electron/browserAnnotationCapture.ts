import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { annotationScreenshot } from "./browserAnnotationScreenshot";
import { readAnnotationSelection } from "./browserAnnotationModel";
import type { AnnotationEntry } from "./browserAnnotationHost";
import type { BrowserAnnotationCaptureResult } from "../src/lib/api/browserAnnotationTypes";
import type { BrowserDesignChange } from "../src/lib/api/browserDesign";

interface CaptureOptions {
  entry: AnnotationEntry;
  current: () => boolean;
  send: (payload: Record<string, unknown>) => boolean;
  timeout: number;
  mode: () => "always" | "necessary";
  design?: { change: BrowserDesignChange };
  retain: (requestId: string) => void;
  stale: () => void;
}

/** Same WebContents capture and timeout lifecycle for selection and first Design commit. */
export async function captureAnnotation(
  options: CaptureOptions,
): Promise<BrowserAnnotationCaptureResult> {
  const { entry, current, send, timeout, mode, design, retain, stale } =
    options;
  if (entry.capturing)
    throw new Error("Browser annotation capture is already pending");
  const selection = structuredClone(entry.selection!);
  const result: BrowserAnnotationCaptureResult = {
    annotationId: entry.session.annotationId,
    selection,
    screenshot: null,
    screenshotStatus: "failed",
    failureReason: "capture-failed",
  };
  const requestId = randomUUID();
  let screenshotSelection = selection;
  let timer: ReturnType<typeof setTimeout> | undefined;
  entry.capturing = true;
  try {
    if (!current()) {
      result.screenshotStatus = "stale";
      result.failureReason = "page-changed";
      return result;
    }
    const ready = new Promise<Record<string, unknown>>((resolve) => {
      entry.pending = { requestId, resolve };
      timer = setTimeout(() => resolve({ status: "timeout" }), timeout);
    });
    send({
      type: design ? "prepare-design-capture" : "prepare",
      requestId,
      ...(design ? { change: design.change } : {}),
    });
    const prepared = await ready;
    if (timer) clearTimeout(timer);
    if (!current() || prepared.status === "stale") {
      result.screenshotStatus = "stale";
      result.failureReason = "page-changed";
      return result;
    }
    if (prepared.status === "timeout") {
      result.screenshotStatus = "timeout";
      result.failureReason = "page-ready-timeout";
      return result;
    }
    const live =
      prepared.status === "ready"
        ? readAnnotationSelection(
            prepared.selection,
            entry.session.kind,
            entry.url,
            entry.target.view.webContents.getTitle(),
          )
        : null;
    if (!live || (!design && !isDeepStrictEqual(live, selection))) {
      result.screenshotStatus = "stale";
      result.failureReason = "selection-changed";
      return result;
    }
    screenshotSelection = live;
    const image = await Promise.race([
      entry.target.view.webContents.capturePage(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeout * 5);
      }),
    ]);
    if (!current()) {
      result.screenshotStatus = "stale";
      result.failureReason = "page-changed";
      return result;
    }
    if (image === null) {
      result.screenshotStatus = "timeout";
      result.failureReason = "capture-timeout";
      return result;
    }
    result.screenshot = annotationScreenshot(
      image,
      screenshotSelection,
      mode(),
    );
    result.screenshotStatus = "captured";
    result.failureReason = null;
    return result;
  } catch {
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    entry.pending = null;
    entry.capturing = false;
    if (design) send({ type: "clear-design-capture", requestId });
    else if (current() && result.screenshotStatus !== "stale") {
      entry.retained = true;
      retain(requestId);
    } else send({ type: "clear", requestId });
    stale();
  }
}
