import { createHash } from "node:crypto";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "../electron/lib/mcp-config-fixture-evidence.mjs";
import {
  annotationTextOf as textOf,
  annotationImageSummary,
  BROWSER_ANNOTATION_FINAL_MARKER,
  summarizeBrowserAnnotationSubmission,
} from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";

/** A screenshot timeout can prove text delivery, never image or visual acceptance. */
export function summarizeBrowserDesignSubmission({
  trace,
  read,
  providerRequests,
  threadId,
  pageUrl,
  previousText,
  revisedText,
  previousSize,
  revisedSize,
  capture,
  message,
  mediaRead,
}) {
  const requests = new Map(
    parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(trace))
      .filter(
        (request) =>
          request.method === "turn/start" &&
          request.params.input?.some((part) =>
            part.text?.includes(revisedText),
          ),
      )
      .map((request) => [request.id, request]),
  );
  const request = requests.size === 1 ? [...requests.values()][0] : null;
  const text = textOf(request?.params.input);
  const matching = (read?.result?.thread?.turns ?? []).flatMap((turn) =>
    (turn.items ?? [])
      .filter(
        (item) =>
          item.type === "userMessage" &&
          (item.clientId === request?.params.clientUserMessageId ||
            textOf(item.content).includes(revisedText)),
      )
      .map((item) => ({ item, turn })),
  );
  const user = matching.length === 1 ? matching[0] : null;
  const providerUsers = providerRequests.flatMap((candidate) => {
    const messages = candidate.body?.messages ?? candidate.body?.input ?? [];
    const lastUser = Array.isArray(messages)
      ? messages.findLast((entry) => entry.role === "user")
      : null;
    return textOf(lastUser?.content).includes(revisedText) ? [lastUser] : [];
  });
  const css = `CSS font-size: ${JSON.stringify(previousSize)} -> ${JSON.stringify(revisedSize)}`;
  const copy = `Text: ${JSON.stringify(previousText)} -> ${JSON.stringify(revisedText)}`;
  const imageEvidence =
    capture?.screenshotStatus === "captured"
      ? summarizeBrowserAnnotationSubmission({
          trace,
          canonical: read?.result,
          providerRequests,
          body: revisedText,
          threadId,
          pageUrl,
          kind: "element",
          mediaRead,
        })
      : null;
  const guiImage = annotationImageSummary(message?.images?.[0]?.src);
  const checks = {
    exactlyOneRealStart:
      !!request?.id &&
      request.transport === "electron-ipc" &&
      request.status === "success" &&
      request.params.threadId === threadId &&
      !!request.params.clientUserMessageId,
    realCanonicalRead:
      isObservedPreloadAppServerResponse(read?.ipcObservation, "thread/read") &&
      read.ipcObservation.params?.threadId === threadId &&
      read.result?.thread?.id === threadId,
    uniqueCanonicalUser:
      !!user?.item.id &&
      user.item.clientId === request?.params.clientUserMessageId,
    completedSameTurn:
      !!user?.turn.id &&
      ["completed", "complete"].includes(
        String(user.turn.status).toLowerCase(),
      ) &&
      user.turn.items.some(
        (item) =>
          item.type === "agentMessage" &&
          textOf(item.content ?? item.text).includes(
            BROWSER_ANNOTATION_FINAL_MARKER,
          ),
      ),
    preciseDesignAndMetadata:
      !!previousText &&
      !!revisedText &&
      previousText !== revisedText &&
      !!previousSize &&
      !!revisedSize &&
      previousSize !== revisedSize &&
      text.includes(css) &&
      text.includes(copy) &&
      text.includes(pageUrl) &&
      text.includes("Target: element") &&
      text.includes("Target rectangle in viewport:") &&
      text.includes("Design changes (temporary browser preview):") &&
      text.includes("User comment:\n\nDesign changes"),
    canonicalTextMatches: !!user && textOf(user.item.content) === text,
    providerReceivedSameDesign:
      providerUsers.length === 1 && textOf(providerUsers[0].content) === text,
    guiShowsSameCanonicalItem:
      message?.id === user?.item.id &&
      message?.visible === true &&
      message.contentVisible === true &&
      message.text?.includes(css) &&
      message.text?.includes(copy),
    screenshotOutcomePreserved: imageEvidence
      ? imageEvidence.failedAssertions.length === 0 &&
        capture.failureReason == null &&
        capture.screenshot?.sha256 === imageEvidence.image?.sha256 &&
        capture.screenshot?.width === imageEvidence.image?.width &&
        capture.screenshot?.height === imageEvidence.image?.height &&
        message?.imageCount === 1 &&
        message.images[0].complete === true &&
        guiImage?.sha256 === imageEvidence.image?.sha256
      : capture?.screenshotStatus === "timeout" &&
        capture.failureReason === "page-ready-timeout" &&
        !capture.screenshot &&
        text.includes("No screenshot is attached.") &&
        request?.params.input.every((part) => part.type !== "image") === true &&
        user?.item.content.every((part) => part.type !== "image") === true &&
        providerUsers.every(
          (user) =>
            !Array.isArray(user.content) ||
            user.content.every(
              (part) =>
                part.type !== "image_url" && part.type !== "input_image",
            ),
        ) &&
        message?.imageCount === 0,
  };
  return {
    checks,
    failedAssertions: Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    requestId: request?.id ?? null,
    threadId,
    turnId: user?.turn.id ?? null,
    userItemId: user?.item.id ?? null,
    clientUserMessageId: request?.params.clientUserMessageId ?? null,
    textSha256: createHash("sha256").update(text).digest("hex"),
    imageDeliveryVerified: !!imageEvidence && checks.screenshotOutcomePreserved,
    imageEvidence,
    visualAcceptance: false,
  };
}
