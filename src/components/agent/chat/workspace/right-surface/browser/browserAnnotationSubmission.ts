import type { ComposerAttachment } from "@/components/input-kit/types";
import { readBrowserAnnotationImages } from "@/lib/api/browserAnnotationImages";
import { readBrowserDesignChange } from "@/lib/api/browserDesign";
import {
  getInputbarSendOptions,
  type InputbarSendHandler,
  type InputbarSendPayload,
} from "../../../components/Inputbar/inputbarSendPayload";
import {
  createRuntimeSubmissionCapture,
  isRuntimeSubmissionAccepted,
  type RuntimeSubmissionResult,
} from "../../../hooks/agentSendResult";
import {
  BrowserAnnotationDraftStore,
  type BrowserAnnotationDraft,
} from "./browserAnnotationDrafts";

/** Browser rich drafts lower once into the existing text/image input contract. */
export function lowerBrowserAnnotations(
  drafts: readonly BrowserAnnotationDraft[],
): { text: string; attachments: ComposerAttachment[] } {
  const attachments: ComposerAttachment[] = [];
  const text = drafts
    .map((draft, index) => {
      const selection = draft.event.selection;
      const screenshot = draft.capture.screenshot;
      if (screenshot) {
        const match =
          /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(
            screenshot.dataUrl,
          );
        if (!match) throw new Error("Invalid browser annotation screenshot");
        attachments.push({ data: match[2], mediaType: match[1] });
      }
      const attachedImages = readBrowserAnnotationImages(draft.attachedImages);
      for (const image of attachedImages) {
        const [header, data] = image.dataUrl.split(",", 2);
        attachments.push({ data, mediaType: header.slice(5, -7) });
      }
      const rect = selection.targetRect;
      const design = readBrowserDesignChange(
        draft.designChange,
        draft.event.designSnapshot,
      );
      return [
        `Browser comment ${index + 1}`,
        `Page: ${selection.pageTitle} (${selection.pageUrl})`,
        `Frame: ${selection.frameUrl} ${JSON.stringify(selection.framePath)}`,
        `Target: ${selection.kind}`,
        selection.targetSelector
          ? `Selector: ${selection.targetSelector}`
          : null,
        selection.targetPath ? `Element path: ${selection.targetPath}` : null,
        selection.targetRole ? `Role: ${selection.targetRole}` : null,
        selection.targetText
          ? `Selected page text: ${JSON.stringify(selection.targetText)}`
          : null,
        selection.textLocator
          ? `Text locator (UTF-16 offsets): ${JSON.stringify(selection.textLocator)}`
          : null,
        selection.selectionRects
          ? `Selected line rectangles in viewport: ${JSON.stringify(selection.selectionRects)}`
          : null,
        `Viewport: ${selection.viewportSize.width} x ${selection.viewportSize.height} CSS pixels`,
        `Target rectangle in viewport: ${JSON.stringify(rect)}`,
        screenshot
          ? `Attached screenshot: ${screenshot.kind}${screenshot.cropRect ? ` ${JSON.stringify(screenshot.cropRect)}` : ""}. Coordinates above are viewport CSS pixels.`
          : "No screenshot is attached.",
        attachedImages.length
          ? `User-attached images for this comment, in order: ${attachedImages.map((image) => JSON.stringify(image.filename ?? "image")).join(", ")}`
          : null,
        `User comment:\n${draft.body}`,
        ...(design
          ? [
              "Design changes (temporary browser preview):",
              ...design.declarations.map(
                (item) =>
                  `CSS ${item.property}: ${JSON.stringify(item.previousValue)} -> ${JSON.stringify(item.value)}`,
              ),
              ...(design.text
                ? [
                    `Text: ${JSON.stringify(design.text.previousValue)} -> ${JSON.stringify(design.text.value)}`,
                  ]
                : []),
              "Implement these changes in the source code or design tokens that own this UI. Preserve responsive behavior. Do not copy temporary browser preview attributes into source files.",
            ]
          : []),
      ]
        .filter((line) => line !== null)
        .join("\n");
    })
    .join("\n\n");
  return { text, attachments };
}

export async function submitBrowserAnnotations({
  store,
  sessionId,
  threadId,
  payload,
  send,
  isCurrent,
}: {
  store: BrowserAnnotationDraftStore;
  sessionId: string;
  threadId: string;
  payload: InputbarSendPayload;
  send: InputbarSendHandler;
  isCurrent: () => boolean;
}): Promise<RuntimeSubmissionResult> {
  let drafts: readonly BrowserAnnotationDraft[];
  try {
    drafts = store.capture(sessionId, threadId, payload.browserAnnotationIds);
  } catch (error) {
    return { kind: "rejected", error };
  }
  if (!drafts.length) return isCurrent() ? send(payload) : { kind: "rejected" };
  if (!isCurrent() || !store.begin(drafts)) return { kind: "rejected" };
  const options = getInputbarSendOptions(payload);
  let committed = false;
  const accepts = createRuntimeSubmissionCapture(undefined, (result) => {
    if (
      result.receipt.sessionId !== sessionId ||
      result.receipt.threadId !== threadId
    )
      return;
    committed = true;
    store.finish(drafts, true);
    options?.observer?.onRuntimeAccepted?.(result.receipt);
  });
  try {
    const lower = lowerBrowserAnnotations(drafts);
    const submission = options?.composerSubmission;
    const text =
      payload.textOverride ??
      submission?.text ??
      payload.composerDraft?.text ??
      "";
    const images = [
      ...(submission?.attachments ?? payload.images ?? []),
      ...lower.attachments,
    ];
    const textOverride = [text, lower.text].filter(Boolean).join("\n\n");
    if (!isCurrent()) {
      store.finish(drafts, false);
      return { kind: "rejected" };
    }
    const returned = await send({
      ...payload,
      images,
      textOverride,
      // These values have already been combined into sendOptions below.
      onRuntimeAccepted: undefined,
      composerSubmission: undefined,
      sendOptions: {
        ...options,
        ...(submission
          ? { composerSubmission: { ...submission, attachments: images } }
          : {}),
        targetSessionId: sessionId,
        observer: {
          ...options?.observer,
          onRuntimeAccepted: accepts.observer.onRuntimeAccepted,
        },
      },
    });
    const result = accepts.finish(returned);
    if (!committed) store.finish(drafts, false);
    return isRuntimeSubmissionAccepted(result) && !committed
      ? { kind: "rejected" }
      : result;
  } catch (error) {
    const result = accepts.reject(error);
    if (!committed) store.finish(drafts, false);
    return committed ? result : { kind: "rejected", error };
  }
}
