import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalRemoteImageInputProjectionEvent,
  extractLocalRemoteImageInputSnapshot,
} from "../dist/index.js";

const DATA_URL = "data:image/png;base64,abc123";
const REMOTE_URL = "https://example.com/remote.png";

function draft(overrides = {}) {
  return {
    localImages: [
      {
        path: "/tmp/local.png",
        placeholder: "[Image #1]",
      },
    ],
    remoteImageUrls: [
      {
        url: REMOTE_URL,
        placeholder: "[Image #2]",
      },
      {
        url: DATA_URL,
        placeholder: "[Image #3]",
      },
    ],
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    stage: "restore",
    draft: draft(),
    submittedInput: [
      {
        type: "localImage",
        path: "/tmp/local.png",
        detail: "high",
        placeholder: "[Image #1]",
      },
      {
        type: "image",
        url: DATA_URL,
        detail: "high",
        placeholder: "[Image #3]",
      },
    ],
    modelRequestInput: [
      {
        type: "input_image",
        image_url: "/tmp/local.png",
        detail: "high",
      },
      {
        type: "input_image",
        image_url: DATA_URL,
        detail: "high",
      },
    ],
    restoredDraft: draft(),
    hydratedUserItems: draft(),
    remoteRejections: [
      {
        url: REMOTE_URL,
        error:
          "remote image URLs are not supported; use an inline data URL instead",
      },
    ],
    visibleTranscriptItems: [],
    ...overrides,
  };
}

test("local/remote image input keeps local detail, data URL and restore/hydrate refs stable", () => {
  const event = buildLocalRemoteImageInputProjectionEvent(baseInput(), {
    sequence: 271,
    sessionId: "session-image",
    threadId: "thread-image",
    turnId: "turn-image",
    timestamp: "2026-07-09T00:00:00.000Z",
  });

  assert.deepEqual(
    {
      type: event.type,
      sourceType: event.sourceType,
      sequence: event.sequence,
      sessionId: event.sessionId,
      threadId: event.threadId,
      turnId: event.turnId,
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      control: event.control,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "messages.snapshot",
      sourceType: "local_remote_image_input_projection",
      sequence: 271,
      sessionId: "session-image",
      threadId: "thread-image",
      turnId: "turn-image",
      owner: "context",
      scope: "message",
      phase: "completed",
      surface: "conversation",
      persistence: "snapshot",
      control: "none",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );
  assert.deepEqual(event.payload.validationIssues, []);
  assert.deepEqual(
    event.payload.draftImages.map((image) => [
      image.kind,
      image.source,
      image.detail,
      image.placeholder,
    ]),
    [
      ["local", "/tmp/local.png", "high", "[Image #1]"],
      ["remote", REMOTE_URL, "auto", "[Image #2]"],
      ["data", DATA_URL, "high", "[Image #3]"],
    ],
  );
  assert.equal(event.payload.localDetailStable, true);
  assert.equal(event.payload.remoteHttpRejected, true);
  assert.equal(event.payload.dataUrlsAccepted, true);
  assert.equal(event.payload.restoreStable, true);
  assert.equal(event.payload.hydrateStable, true);
  assert.equal(event.payload.placeholderMapStable, true);
});

test("custom local image detail original is preserved through submission", () => {
  const snapshot = extractLocalRemoteImageInputSnapshot(
    baseInput({
      draft: draft({
        localImages: [
          {
            path: "/tmp/local.png",
            detail: "original",
            placeholder: "[Image #1]",
          },
        ],
      }),
      submittedInput: [
        {
          type: "localImage",
          path: "/tmp/local.png",
          detail: "original",
        },
        {
          type: "image",
          url: DATA_URL,
          detail: "high",
        },
      ],
      restoredDraft: draft({
        localImages: [
          {
            path: "/tmp/local.png",
            detail: "original",
            placeholder: "[Image #1]",
          },
        ],
      }),
      hydratedUserItems: draft({
        localImages: [
          {
            path: "/tmp/local.png",
            detail: "original",
            placeholder: "[Image #1]",
          },
        ],
      }),
    }),
  );

  assert.deepEqual(snapshot.validationIssues, []);
  assert.equal(snapshot.draftImages[0].detail, "original");
  assert.equal(snapshot.submittedImages[0].detail, "original");
});

test("remote HTTP images must be rejected and never submitted to model input", () => {
  const snapshot = extractLocalRemoteImageInputSnapshot(
    baseInput({
      submittedInput: [
        {
          type: "image",
          url: REMOTE_URL,
          detail: "high",
        },
      ],
      modelRequestInput: [
        {
          type: "input_image",
          image_url: REMOTE_URL,
          detail: "high",
        },
      ],
      remoteRejections: [],
    }),
  );

  assert.equal(snapshot.remoteHttpRejected, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "local_image_detail_not_preserved",
      "remote_http_submitted_to_model",
      "remote_rejection_missing",
      "data_url_rejected",
    ],
  );
});

test("unsupported low detail and custom detail drift fail closed", () => {
  const snapshot = extractLocalRemoteImageInputSnapshot(
    baseInput({
      draft: draft({
        localImages: [
          {
            path: "/tmp/local.png",
            detail: "low",
            placeholder: "[Image #1]",
          },
        ],
      }),
      submittedInput: [
        {
          type: "localImage",
          path: "/tmp/local.png",
          detail: "high",
        },
        {
          type: "image",
          url: DATA_URL,
          detail: "high",
        },
      ],
      restoredDraft: draft({
        localImages: [
          {
            path: "/tmp/local.png",
            detail: "low",
            placeholder: "[Image #1]",
          },
        ],
      }),
      hydratedUserItems: draft({
        localImages: [
          {
            path: "/tmp/local.png",
            detail: "low",
            placeholder: "[Image #1]",
          },
        ],
      }),
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["unsupported_low_detail", "local_image_detail_not_preserved"],
  );
});

test("restore order and placeholder map must stay attached to image refs", () => {
  const snapshot = extractLocalRemoteImageInputSnapshot(
    baseInput({
      restoredDraft: {
        localImages: [
          {
            path: "/tmp/local.png",
            placeholder: "[Image #2]",
          },
        ],
        remoteImageUrls: [
          {
            url: DATA_URL,
            placeholder: "[Image #3]",
          },
          {
            url: REMOTE_URL,
            placeholder: "[Image #1]",
          },
        ],
      },
    }),
  );

  assert.equal(snapshot.restoreStable, false);
  assert.equal(snapshot.placeholderMapStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["restored_image_lost", "image_order_drift", "placeholder_map_drift"],
  );
});

test("plain image placeholder text without structured refs cannot pass hydrate guard", () => {
  const snapshot = extractLocalRemoteImageInputSnapshot({
    visibleTranscriptItems: [
      {
        role: "user",
        text: "Please inspect [Image #1]",
      },
    ],
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_image_input", "legacy_text_placeholder_only"],
  );
});
