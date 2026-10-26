import { invokeAppServerFromPage } from "../lib/chat-fixture/rpc.mjs";
import { APP_SERVER_METHOD_SESSION_READ } from "../lib/chat-fixture/constants.mjs";
import { appServerCallFromPage } from "../electron/mcp-config-fixture-smoke.mjs";
import { assert } from "../lib/chat-fixture/utils.mjs";
import { parseJsonRpcRequestsFromInvokeTrace } from "../electron/lib/mcp-config-fixture-evidence.mjs";
import {
  annotationTextOf as textOf,
  annotationImageSummary,
  summarizeBrowserAnnotationSubmission,
} from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";
import { waitForBrowserAnnotationState as waitFor } from "./browser-runtime-electron-gate-b-annotation-diagnostics.mjs";

async function readCanonical(page, requestLog, threadId) {
  return invokeAppServerFromPage(
    page,
    APP_SERVER_METHOD_SESSION_READ,
    { threadId, includeTurns: true },
    requestLog,
  );
}

export async function observeBrowserAnnotationSubmission(
  ctx,
  body,
  kind,
  mainPrompt = "",
  method = "turn/start",
  expectedTurnId = null,
) {
  const {
    page,
    options,
    identity,
    requestLog,
    providerFixture,
    readInvokeTrace,
    initial,
  } = ctx;
  const canonical = await waitFor(
    options,
    () => readCanonical(page, requestLog, identity.threadId),
    (read) =>
      read.result?.thread?.turns?.some(
        (turn) =>
          ["completed", "complete"].includes(
            String(turn.status).toLowerCase(),
          ) &&
          turn.items?.some(
            (item) =>
              item.type === "userMessage" &&
              textOf(item.content).includes(body),
          ),
      ),
    "Annotation canonical turn did not complete",
    (read) => ({
      error: read?.error ?? null,
      threadId: read?.result?.thread?.id ?? null,
      turns: read?.result?.thread?.turns?.map((turn) => ({
        id: turn.id,
        status: turn.status,
        error: turn.error ?? null,
        items: turn.items?.map((item) => ({
          id: item.id,
          type: item.type,
          matchesBody:
            item.type === "userMessage" && textOf(item.content).includes(body),
        })),
      })),
    }),
  );
  const turn = canonical.result.thread.turns.findLast((turn) =>
    turn.items?.some(
      (item) =>
        item.type === "userMessage" && textOf(item.content).includes(body),
    ),
  );
  const item = turn.items.find(
    (item) =>
      item.type === "userMessage" && textOf(item.content).includes(body),
  );
  const uri = item.content.find((part) => part.type === "image")?.url;
  assert(uri, "Annotation user item has no canonical image");
  const mediaRead = await appServerCallFromPage(page, "media/read", {
    threadId: identity.threadId,
    uri,
    offset: 0,
    length: 8_388_608,
  });
  const preview = await waitFor(
    options,
    () =>
      page.locator(`[data-thread-item-id="${item.id}"]`).evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute("data-thread-item-id"),
          images: [
            ...node.querySelectorAll(
              '[data-testid^="message-image-attachment-"]',
            ),
          ]
            .filter((node) => node instanceof HTMLImageElement)
            .map((image) => ({
              src: image.src,
              complete: image.complete,
              width: image.naturalWidth,
            })),
          unavailable: !!node.querySelector(
            '[data-testid^="message-image-attachment-unavailable-"]',
          ),
        })),
      ),
    (nodes) =>
      nodes.length === 1 &&
      nodes[0].images.length === 1 &&
      nodes[0].images[0].complete &&
      nodes[0].images[0].width > 0 &&
      annotationImageSummary(nodes[0].images[0].src)?.sha256 ===
        annotationImageSummary(
          `data:${mediaRead.result?.mimeType};base64,${mediaRead.result?.contentBase64}`,
        )?.sha256,
    "Browser annotation canonical screenshot was not visible in the message",
  );
  const trace = await waitFor(
    options,
    async () => {
      const latest = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
      );
      return [...(readInvokeTrace?.() ?? []), ...latest];
    },
    (trace) =>
      parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(trace)).some(
        (entry) =>
          entry.method === method &&
          entry.params.input?.some((part) => part.text?.includes(body)),
      ),
    `Annotation ${method} trace missing`,
  );
  const evidence = summarizeBrowserAnnotationSubmission({
    trace,
    canonical: canonical.result,
    providerRequests: providerFixture.requests,
    body,
    threadId: identity.threadId,
    pageUrl: initial.address,
    kind,
    mediaRead,
    mainPrompt,
    method,
    expectedTurnId,
  });
  return {
    ...evidence,
    messagePreview: {
      visible: true,
      image: annotationImageSummary(preview[0].images[0].src),
    },
  };
}
