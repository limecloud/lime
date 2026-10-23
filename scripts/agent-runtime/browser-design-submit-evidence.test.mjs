import { describe, expect, it } from "vitest";
import { summarizeBrowserDesignSubmission as summarize } from "./browser-design-submit-evidence.mjs";
import { BROWSER_ANNOTATION_FINAL_MARKER } from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";
import { annotationImageSummary } from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";

function fixture() {
  const text =
    'Browser comment 1\nPage: http://localhost/fixture\nTarget: element\nViewport: 800 x 600 CSS pixels\nTarget rectangle in viewport: {}\nNo screenshot is attached.\nUser comment:\n\nDesign changes (temporary browser preview):\nCSS font-size: "20px" -> "28px"\nText: "Original" -> "Revised sentinel"';
  const input = [{ type: "text", text }];
  const params = {
    threadId: "thread-1",
    clientUserMessageId: "client-1",
    input,
  };
  return {
    trace: [
      {
        command: "app_server_handle_json_lines",
        transport: "electron-ipc",
        status: "success",
        args_preview: {
          request: {
            lines: [
              JSON.stringify({ id: "rpc-1", method: "turn/start", params }),
            ],
          },
        },
      },
    ],
    read: {
      ipcObservation: {
        electron: true,
        fallback: false,
        command: "app_server_handle_json_lines",
        transport: "electron-ipc",
        status: "success",
        method: "thread/read",
        requestId: "read-1",
        responseId: "read-1",
        params: { threadId: "thread-1" },
      },
      result: {
        thread: {
          id: "thread-1",
          turns: [
            {
              id: "turn-1",
              status: "completed",
              items: [
                {
                  id: "item-1",
                  type: "userMessage",
                  clientId: "client-1",
                  content: structuredClone(input),
                },
                {
                  id: "agent-1",
                  type: "agentMessage",
                  text: BROWSER_ANNOTATION_FINAL_MARKER,
                },
              ],
            },
          ],
        },
      },
    },
    providerRequests: [
      {
        body: { messages: [{ role: "user", content: structuredClone(input) }] },
      },
    ],
    threadId: "thread-1",
    pageUrl: "http://localhost/fixture",
    previousText: "Original",
    revisedText: "Revised sentinel",
    previousSize: "20px",
    revisedSize: "28px",
    capture: {
      screenshotStatus: "timeout",
      failureReason: "page-ready-timeout",
      screenshot: null,
    },
    message: {
      id: "item-1",
      visible: true,
      contentVisible: true,
      text,
      imageCount: 0,
    },
  };
}

function capturedFixture() {
  const data = fixture();
  // Metadata-only PNG is sufficient for hashing tests, never visual evidence.
  const bytes = Buffer.alloc(25);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(200, 16);
  bytes.writeUInt32BE(120, 20);
  const image = `data:image/png;base64,${bytes.toString("base64")}`;
  const summary = annotationImageSummary(image);
  const uri = `sidecar://media/input-${summary.sha256}.png`;
  const request = JSON.parse(data.trace[0].args_preview.request.lines[0]);
  const text = request.params.input[0].text.replace(
    "No screenshot is attached.",
    "Attached screenshot: viewport. Coordinates above are viewport CSS pixels.",
  );
  request.params.input = [
    { type: "text", text },
    { type: "image", url: image },
  ];
  data.trace[0].args_preview.request.lines[0] = JSON.stringify(request);
  data.read.result.thread.turns[0].items[0].content = [
    { type: "text", text },
    { type: "image", url: uri },
  ];
  data.providerRequests[0].body.messages[0].content = [
    { type: "text", text },
    { type: "image_url", image_url: { url: image } },
  ];
  data.message = {
    id: "item-1",
    visible: true,
    contentVisible: true,
    text,
    imageCount: 1,
    images: [{ src: image, complete: true, width: 200 }],
  };
  data.capture = {
    screenshotStatus: "captured",
    failureReason: null,
    screenshot: summary,
  };
  data.mediaRead = {
    result: {
      threadId: data.threadId,
      uri,
      mimeType: "image/png",
      contentBase64: bytes.toString("base64"),
      hasMore: false,
    },
    ipcObservation: {
      ...data.read.ipcObservation,
      method: "media/read",
      params: { threadId: data.threadId, uri },
    },
  };
  return data;
}

describe("Design canonical evidence", () => {
  it("rejects clipped message content even when its hidden text is present", () => {
    const data = fixture();
    data.message.contentVisible = false;
    expect(summarize(data).failedAssertions).toContain(
      "guiShowsSameCanonicalItem",
    );
  });
  it("joins the original native capture to canonical media, provider and rendered image", () => {
    const result = summarize(capturedFixture());
    expect(result.imageEvidence.failedAssertions).toEqual([]);
    expect(result.failedAssertions).toEqual([]);
    expect(result.imageDeliveryVerified).toBe(true);
    expect(result.visualAcceptance).toBe(false);
  });
  it.each([
    [
      "capture hash",
      (data) => {
        data.capture.screenshot.sha256 = "other";
      },
    ],
    [
      "capture dimensions",
      (data) => {
        data.capture.screenshot.width = 201;
      },
    ],
    [
      "media identity",
      (data) => {
        data.mediaRead.result.threadId = "other";
      },
    ],
    [
      "unobserved media",
      (data) => {
        data.mediaRead.ipcObservation.status = "error";
      },
    ],
    [
      "GUI image",
      (data) => {
        data.message.images[0].src = "data:image/png;base64,wrong";
      },
    ],
    [
      "unloaded image",
      (data) => {
        data.message.images[0].complete = false;
      },
    ],
  ])("rejects an unrelated %s", (_name, mutate) => {
    const data = capturedFixture();
    mutate(data);
    const result = summarize(data);
    expect(result.failedAssertions).toContain("screenshotOutcomePreserved");
    expect(result.imageDeliveryVerified).toBe(false);
  });
  it("accepts the exact chain and deduplicates the same observed RPC", () => {
    const data = fixture();
    data.trace.push(structuredClone(data.trace[0]));
    expect(summarize(data).failedAssertions).toEqual([]);
    expect(summarize(data)).toMatchObject({
      imageDeliveryVerified: false,
      visualAcceptance: false,
    });
  });
  it.each([
    [
      "missing IPC",
      (data) => {
        data.trace = [];
      },
      "exactlyOneRealStart",
    ],
    [
      "fallback",
      (data) => {
        data.trace[0].transport = "http";
      },
      "exactlyOneRealStart",
    ],
    [
      "failed start",
      (data) => {
        data.trace[0].status = "error";
      },
      "exactlyOneRealStart",
    ],
    [
      "wrong read identity",
      (data) => {
        data.read.ipcObservation.params.threadId = "other";
      },
      "realCanonicalRead",
    ],
    [
      "unmatched read receipt",
      (data) => {
        data.read.ipcObservation.responseId = "other";
      },
      "realCanonicalRead",
    ],
    [
      "wrong client",
      (data) => {
        data.read.result.thread.turns[0].items[0].clientId = "other";
      },
      "uniqueCanonicalUser",
    ],
    [
      "duplicate item",
      (data) => {
        data.read.result.thread.turns[0].items.push(
          structuredClone(data.read.result.thread.turns[0].items[0]),
        );
      },
      "uniqueCanonicalUser",
    ],
    [
      "missing terminal",
      (data) => {
        data.read.result.thread.turns[0].status = "inProgress";
      },
      "completedSameTurn",
    ],
    [
      "no provider",
      (data) => {
        data.providerRequests = [];
      },
      "providerReceivedSameDesign",
    ],
    [
      "changed provider text",
      (data) => {
        data.providerRequests[0].body.messages[0].content[0].text += " changed";
      },
      "providerReceivedSameDesign",
    ],
    [
      "different canonical text",
      (data) => {
        data.read.result.thread.turns[0].items[0].content[0].text += " changed";
      },
      "canonicalTextMatches",
    ],
    [
      "wrong GUI item",
      (data) => {
        data.message.id = "other";
      },
      "guiShowsSameCanonicalItem",
    ],
    [
      "wrong baseline",
      (data) => {
        data.previousSize = "21px";
      },
      "preciseDesignAndMetadata",
    ],
    [
      "unexplained screenshot failure",
      (data) => {
        data.capture.failureReason = "unknown";
      },
      "screenshotOutcomePreserved",
    ],
    [
      "attached image",
      (data) => {
        data.message.imageCount = 1;
      },
      "screenshotOutcomePreserved",
    ],
  ])("rejects %s", (_name, mutate, failed) => {
    const data = fixture();
    mutate(data);
    expect(summarize(data).failedAssertions).toContain(failed);
  });
});
