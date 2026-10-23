import { createHash } from "node:crypto";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "../electron/lib/mcp-config-fixture-evidence.mjs";

export const BROWSER_ANNOTATION_FINAL_MARKER = "BROWSER_ANNOTATION_GATE_B_DONE";

/** Only the provider is scripted. Browser, editor, IPC, runtime and storage stay real. */
export function createBrowserAnnotationResponses() {
  return [{ type: "text", content: BROWSER_ANNOTATION_FINAL_MARKER }];
}

export function annotationImageSummary(dataUrl) {
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
    dataUrl ?? "",
  );
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    return null;
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height) return null;
  return {
    mediaType: match[1],
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width,
    height,
  };
}

function imageUrls(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const child of value) imageUrls(child, result);
    return result;
  }
  if (typeof value.image_url === "string") result.push(value.image_url);
  else if (typeof value.image_url?.url === "string")
    result.push(value.image_url.url);
  for (const [key, child] of Object.entries(value))
    if (key !== "image_url") imageUrls(child, result);
  return result;
}

export function annotationTextOf(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content
        .filter((part) => part?.type === "text" || part?.type === "input_text")
        .map((part) => part.text ?? "")
        .join("\n")
    : "";
}

function providerUser(request, body) {
  const messages = request?.body?.messages ?? request?.body?.input ?? [];
  return Array.isArray(messages)
    ? messages.findLast(
        (message) =>
          message?.role === "user" &&
          annotationTextOf(message.content).includes(body),
      )
    : null;
}

/** Fail closed on the same user item, transport, thread and delivered image bytes. */
export function summarizeBrowserAnnotationSubmission({
  trace,
  canonical,
  providerRequests,
  body,
  threadId,
  pageUrl,
  kind,
  mediaRead,
  mainPrompt = "",
  method = "turn/start",
  expectedTurnId = null,
}) {
  const requests = parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(trace));
  const request = requests.findLast(
    (entry) =>
      entry.method === method &&
      entry.params.threadId === threadId &&
      entry.params.input?.some(
        (part) => part?.type === "text" && part.text?.includes(body),
      ),
  );
  const input = request?.params?.input ?? [];
  const text = annotationTextOf(input);
  const users =
    canonical?.thread?.id === threadId
      ? (canonical.thread.turns ?? [])
          .flatMap((turn) => (turn.items ?? []).map((item) => ({ turn, item })))
          .filter(
            ({ item }) =>
              item.type === "userMessage" &&
              item.clientId === request?.params.clientUserMessageId,
          )
      : [];
  const user = users.length === 1 ? users[0] : null;
  const inputImage = input.filter((part) => part.type === "image");
  const submittedImage = annotationImageSummary(inputImage[0]?.url);
  const storedImage = (user?.item.content ?? []).filter(
    (part) => part.type === "image",
  );
  const providerRequest = providerRequests.findLast((candidate) =>
    providerUser(candidate, body),
  );
  const providerMessage = providerUser(providerRequest, body);
  const delivered = imageUrls(providerMessage)
    .map(annotationImageSummary)
    .filter(Boolean);
  const media = mediaRead?.result;
  const stored = annotationImageSummary(
    typeof media?.contentBase64 === "string"
      ? `data:${media.mimeType};base64,${media.contentBase64}`
      : null,
  );
  const expectedUri =
    delivered.length === 1
      ? `sidecar://media/input-${delivered[0].sha256}.png`
      : null;
  const checks = {
    realSubmission:
      request?.transport === "electron-ipc" &&
      request.status === "success" &&
      !!request.id,
    canonicalThreadAndClientItem:
      !!user?.item.id && !!request?.params.clientUserMessageId,
    expectedTurnIdentity:
      expectedTurnId === null ||
      (user?.turn.id === expectedTurnId &&
        (method !== "turn/steer" ||
          request?.params.expectedTurnId === expectedTurnId)),
    canonicalTerminalTurn: ["completed", "complete"].includes(
      String(user?.turn.status ?? "").toLowerCase(),
    ),
    textAndPageMetadataPreserved:
      !!body &&
      text.includes(body) &&
      text.includes(`Target: ${kind}`) &&
      text.includes(pageUrl) &&
      text.includes("Target rectangle in viewport:") &&
      text.includes("Viewport:") &&
      (!mainPrompt || text.includes(mainPrompt)),
    canonicalTextPreserved:
      !!user && annotationTextOf(user.item.content) === text,
    oneImageInSameCanonicalItem:
      inputImage.length === 1 &&
      storedImage.length === 1 &&
      !!expectedUri &&
      (inputImage[0].url === expectedUri ||
        (submittedImage !== null &&
          submittedImage.sha256 === delivered[0]?.sha256)) &&
      storedImage[0].url === expectedUri,
    imageDeliveredToProvider:
      delivered.length === 1 && delivered[0].byteLength > 24,
    storedImageBytesMatchProvider:
      !!stored &&
      stored.sha256 === delivered[0]?.sha256 &&
      media?.threadId === threadId &&
      media.uri === expectedUri &&
      media.hasMore === false,
    realMediaRead:
      isObservedPreloadAppServerResponse(
        mediaRead?.ipcObservation,
        "media/read",
      ) &&
      mediaRead.ipcObservation.params?.threadId === threadId &&
      mediaRead.ipcObservation.params.uri === expectedUri,
    providerReceivedAnnotationText:
      !!providerMessage &&
      annotationTextOf(providerMessage.content).includes(`Target: ${kind}`) &&
      (!mainPrompt ||
        annotationTextOf(providerMessage.content).includes(mainPrompt)),
    providerFinalMarkerInCanonicalTurn: !!user?.turn.items?.some(
      (item) =>
        item.type === "agentMessage" &&
        annotationTextOf(item.content ?? item.text).includes(
          BROWSER_ANNOTATION_FINAL_MARKER,
        ),
    ),
  };
  const cropText = /Attached screenshot: crop (\{[^\n]+\})\. Coordinates/u.exec(
    text,
  )?.[1];
  let screenshotCrop = null;
  try {
    screenshotCrop = cropText ? JSON.parse(cropText) : null;
  } catch {
    /* Malformed geometry never proves a crop. */
  }
  return {
    checks,
    failedAssertions: Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    threadId,
    turnId: user?.turn.id ?? null,
    userItemId: user?.item.id ?? null,
    clientUserMessageId: request?.params.clientUserMessageId ?? null,
    requestId: request?.id ?? null,
    method,
    image: delivered[0] ?? null,
    screenshotKind:
      /Attached screenshot: (crop|viewport)/u.exec(text)?.[1] ?? null,
    screenshotCrop,
    providerPath: providerRequest?.path ?? null,
  };
}
