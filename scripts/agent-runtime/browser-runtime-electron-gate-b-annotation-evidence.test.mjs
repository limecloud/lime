import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  annotationImageSummary,
  BROWSER_ANNOTATION_FINAL_MARKER,
  createBrowserAnnotationResponses,
  summarizeBrowserAnnotationSubmission,
} from "./browser-runtime-electron-gate-b-annotation-evidence.mjs";

// Metadata-only synthetic PNG bytes; this unit fixture makes no screenshot claim.
function pngUrl(width = 180, height = 112, tail = "test-image") {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${Buffer.concat([bytes, Buffer.from(tail)]).toString("base64")}`;
}

function submission() {
  const image = pngUrl();
  const sha256 = annotationImageSummary(image).sha256;
  const uri = `sidecar://media/input-${sha256}.png`;
  const body = "synthetic-annotation-body";
  const pageUrl = "http://127.0.0.1:1234/fixture";
  const text = [
    "synthetic-main-prompt",
    "Browser comment 1",
    `Page: Fixture (${pageUrl})`,
    "Target: region",
    "Viewport: 800 x 600 CSS pixels",
    'Target rectangle in viewport: {"x":36,"y":38,"width":180,"height":112}',
    'Attached screenshot: crop {"x":0,"y":0,"width":248,"height":182}. Coordinates above are viewport CSS pixels.',
    `User comment:\n${body}`,
  ].join("\n");
  const input = [
    { type: "text", text, text_elements: [] },
    { type: "image", url: uri },
  ];
  const params = {
    threadId: "thread-current",
    clientUserMessageId: "client-current",
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
              JSON.stringify({
                jsonrpc: "2.0",
                id: "rpc-start",
                method: "turn/start",
                params,
              }),
            ],
          },
        },
      },
    ],
    canonical: {
      thread: {
        id: "thread-current",
        turns: [
          {
            id: "turn-current",
            status: "completed",
            items: [
              {
                id: "user-current",
                type: "userMessage",
                clientId: "client-current",
                content: structuredClone(input),
              },
              {
                id: "assistant-current",
                type: "agentMessage",
                text: BROWSER_ANNOTATION_FINAL_MARKER,
              },
            ],
          },
        ],
      },
    },
    providerRequests: [
      {
        path: "/v1/chat/completions",
        authorization: "never-export-this",
        body: {
          messages: [
            { role: "system", content: "private-system-prompt" },
            {
              role: "user",
              content: [
                { type: "text", text },
                { type: "image_url", image_url: { url: image } },
              ],
            },
          ],
        },
      },
    ],
    mediaRead: {
      result: {
        threadId: "thread-current",
        uri,
        mimeType: "image/png",
        contentBase64: image.split(",")[1],
        hasMore: false,
      },
      ipcObservation: {
        electron: true,
        fallback: false,
        command: "app_server_handle_json_lines",
        transport: "electron-ipc",
        status: "success",
        method: "media/read",
        requestId: "rpc-media",
        responseId: "rpc-media",
        params: { threadId: "thread-current", uri },
      },
    },
    body,
    threadId: "thread-current",
    pageUrl,
    kind: "region",
    mainPrompt: "synthetic-main-prompt",
  };
}

function rewriteRequest(state, change) {
  const request = JSON.parse(state.trace[0].args_preview.request.lines[0]);
  change(request);
  state.trace[0].args_preview.request.lines[0] = JSON.stringify(request);
}

describe("Browser annotation Gate B evidence", () => {
  it("uses an explicit text-only provider response without Browser tool gates", () => {
    expect(createBrowserAnnotationResponses()).toEqual([
      { type: "text", content: BROWSER_ANNOTATION_FINAL_MARKER },
    ]);
  });

  it("joins the real transport, canonical client item and provider image bytes", () => {
    const evidence = summarizeBrowserAnnotationSubmission(submission());
    expect(evidence.failedAssertions).toEqual([]);
    expect(evidence).toMatchObject({
      threadId: "thread-current",
      turnId: "turn-current",
      userItemId: "user-current",
      clientUserMessageId: "client-current",
      requestId: "rpc-start",
      image: { width: 180, height: 112 },
      screenshotKind: "crop",
      screenshotCrop: { x: 0, y: 0, width: 248, height: 182 },
    });
  });

  it.each(["thread/queue/add", "turn/steer"])(
    "joins %s to its canonical turn and rejects a different submission method or turn",
    (method) => {
      const state = submission();
      state.method = method;
      state.expectedTurnId = "turn-current";
      rewriteRequest(state, (request) => {
        request.method = method;
        if (method === "turn/steer")
          request.params.expectedTurnId = "turn-current";
      });
      expect(
        summarizeBrowserAnnotationSubmission(state).failedAssertions,
      ).toEqual([]);
      expect(
        summarizeBrowserAnnotationSubmission({
          ...state,
          expectedTurnId: "foreign-turn",
        }).checks.expectedTurnIdentity,
      ).toBe(false);
      rewriteRequest(state, (request) => {
        request.method = "turn/start";
      });
      expect(
        summarizeBrowserAnnotationSubmission(state).checks.realSubmission,
      ).toBe(false);
    },
  );

  it("rejects a steer request aimed at another active turn", () => {
    const state = submission();
    state.method = "turn/steer";
    state.expectedTurnId = "turn-current";
    rewriteRequest(state, (request) => {
      request.method = "turn/steer";
      request.params.expectedTurnId = "foreign-turn";
    });
    expect(
      summarizeBrowserAnnotationSubmission(state).checks.expectedTurnIdentity,
    ).toBe(false);
  });

  it("joins data URL input only when its bytes match canonical storage and delivery", () => {
    const state = submission();
    rewriteRequest(state, (request) => {
      request.params.input[1].url = pngUrl();
    });
    expect(
      summarizeBrowserAnnotationSubmission(state).failedAssertions,
    ).toEqual([]);
    rewriteRequest(state, (request) => {
      request.params.input[1].url = pngUrl(180, 112, "different-input");
    });
    expect(
      summarizeBrowserAnnotationSubmission(state).checks
        .oneImageInSameCanonicalItem,
    ).toBe(false);
  });

  it("rejects a foreign canonical thread even when its text and image match", () => {
    const state = submission();
    state.canonical.thread.id = "thread-other";
    expect(
      summarizeBrowserAnnotationSubmission(state).checks
        .canonicalThreadAndClientItem,
    ).toBe(false);
  });

  it("rejects a different client item and duplicate canonical items", () => {
    const foreign = submission();
    foreign.canonical.thread.turns[0].items[0].clientId = "client-other";
    expect(
      summarizeBrowserAnnotationSubmission(foreign).checks
        .canonicalThreadAndClientItem,
    ).toBe(false);
    const duplicate = submission();
    duplicate.canonical.thread.turns[0].items.push(
      structuredClone(duplicate.canonical.thread.turns[0].items[0]),
    );
    expect(
      summarizeBrowserAnnotationSubmission(duplicate).checks
        .canonicalThreadAndClientItem,
    ).toBe(false);
  });

  it("cannot substitute a direct helper call or in-flight turn for real acceptance", () => {
    const state = submission();
    state.trace[0].transport = "mock";
    state.canonical.thread.turns[0].status = "inProgress";
    const evidence = summarizeBrowserAnnotationSubmission(state);
    expect(evidence.checks.realSubmission).toBe(false);
    expect(evidence.checks.canonicalTerminalTurn).toBe(false);
  });

  it("rejects missing main Composer text and changed page metadata", () => {
    const state = submission();
    state.pageUrl = "http://127.0.0.1:1234/foreign";
    state.mainPrompt = "a-main-prompt-that-was-lost";
    const evidence = summarizeBrowserAnnotationSubmission(state);
    expect(evidence.checks.textAndPageMetadataPreserved).toBe(false);
    expect(evidence.checks.providerReceivedAnnotationText).toBe(false);
  });

  it("rejects an image moved into another user item", () => {
    const state = submission();
    const user = state.canonical.thread.turns[0].items[0];
    const image = user.content.pop();
    state.canonical.thread.turns[0].items.push({
      id: "foreign-item",
      type: "userMessage",
      clientId: "foreign-client",
      content: [image],
    });
    expect(
      summarizeBrowserAnnotationSubmission(state).checks
        .oneImageInSameCanonicalItem,
    ).toBe(false);
  });

  it("requires byte-identical storage and provider image data", () => {
    const state = submission();
    state.mediaRead.result.contentBase64 = pngUrl(
      180,
      112,
      "other-image",
    ).split(",")[1];
    expect(
      summarizeBrowserAnnotationSubmission(state).checks
        .storedImageBytesMatchProvider,
    ).toBe(false);
  });

  it("requires real same-thread media read with matching response ID", () => {
    const state = submission();
    state.mediaRead.ipcObservation.responseId = "foreign-response";
    expect(
      summarizeBrowserAnnotationSubmission(state).checks.realMediaRead,
    ).toBe(false);
    state.mediaRead.ipcObservation.responseId = "rpc-media";
    state.mediaRead.ipcObservation.params.threadId = "foreign-thread";
    expect(
      summarizeBrowserAnnotationSubmission(state).checks.realMediaRead,
    ).toBe(false);
  });

  it("does not count an old provider image in another user message", () => {
    const state = submission();
    const content = state.providerRequests[0].body.messages[1].content;
    const image = content.pop();
    state.providerRequests[0].body.messages.splice(1, 0, {
      role: "user",
      content: [image],
    });
    expect(
      summarizeBrowserAnnotationSubmission(state).checks
        .imageDeliveredToProvider,
    ).toBe(false);
  });

  it("does not count another turn's assistant marker", () => {
    const state = submission();
    const marker = state.canonical.thread.turns[0].items.pop();
    state.canonical.thread.turns.push({
      id: "turn-other",
      status: "completed",
      items: [marker],
    });
    expect(
      summarizeBrowserAnnotationSubmission(state).checks
        .providerFinalMarkerInCanonicalTurn,
    ).toBe(false);
  });

  it("fails closed on an absent or malformed turn/start trace", () => {
    const state = submission();
    state.trace[0].args_preview.request.lines = ["not-json"];
    expect(
      summarizeBrowserAnnotationSubmission(state).checks.realSubmission,
    ).toBe(false);
    const other = submission();
    rewriteRequest(other, (request) => {
      request.method = "turn/steer";
    });
    expect(
      summarizeBrowserAnnotationSubmission(other).checks.realSubmission,
    ).toBe(false);
  });

  it("exports metadata and hashes without image bytes, credentials or prompts", () => {
    const state = submission();
    const serialized = JSON.stringify(
      summarizeBrowserAnnotationSubmission(state),
    );
    for (const secret of [
      "never-export-this",
      "private-system-prompt",
      state.body,
      state.mainPrompt,
      state.mediaRead.result.contentBase64,
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).toContain(annotationImageSummary(pngUrl()).sha256);
  });

  it("rejects non-PNG, zero-size, truncated and malformed image values", () => {
    for (const value of [
      null,
      "https://example.test/private.png",
      "data:image/png;base64,@@@",
      "data:image/png;base64,YQ==",
      pngUrl(0, 4),
      pngUrl(4, 0),
      pngUrl().replace("image/png", "image/jpeg"),
    ])
      expect(annotationImageSummary(value)).toBeNull();
  });
});
