import { describe, expect, it } from "vitest";
import { readCanonicalThreadItem } from "./appServerCanonicalItemReader";
import { readCanonicalThreadDetail } from "./appServerCanonicalThreadProjection";
import { readCanonicalMessageContentParts } from "./appServerCanonicalMessageContent";

const media = {
  type: "media",
  kind: "image",
  caption: "Result",
  reference: {
    uri: "sidecar://media/result/image.png",
    mime_type: "image/png",
    sidecar_ref: { ref: "sidecar://media/result/image.png" },
    byte_size: 300,
  },
};

describe("canonical multi-protocol message content", () => {
  it.each(["item.started", "item.completed"])(
    "preserves media-only %s with the same identity",
    (type) => {
      const item = readCanonicalThreadItem(
        {
          id: "image-result",
          type: "agentMessage",
          text: "",
          contentParts: [media],
        },
        {
          eventId: type,
          sequence: 2,
          sessionId: "session-1",
          threadId: "thread-1",
          turnId: "turn-1",
          type,
          timestamp: "2026-10-25T00:00:00Z",
          payload: {},
        },
      );
      expect(item).toMatchObject({
        id: "image-result",
        type: "agent_message",
        text: "",
        contentParts: [media],
      });
    },
  );

  it("keeps mixed text and media in order and leaves plain text unchanged", () => {
    const parts = [{ type: "text", text: "Result" }, media];
    expect(readCanonicalMessageContentParts(parts)).toEqual(parts);
    expect(readCanonicalMessageContentParts(undefined)).toBeUndefined();
  });

  it("restores the same media-only Item from public thread/read", () => {
    const detail = readCanonicalThreadDetail({
      thread: {
        id: "thread-1",
        sessionId: "session-1",
        status: { type: "idle" },
        createdAt: 1792886400,
        updatedAt: 1792886401,
        modelProvider: "provider",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                id: "image-result",
                type: "agentMessage",
                text: "",
                phase: "final_answer",
                contentParts: [media],
              },
            ],
          },
        ],
      },
    });
    expect(detail?.thread_read?.thread_items).toContainEqual(
      expect.objectContaining({
        id: "image-result",
        type: "agent_message",
        text: "",
        contentParts: [media],
      }),
    );
  });

  it.each(["uri", "source_uri", "preview_url"])(
    "rejects inline payload in %s",
    (key) => {
      expect(
        readCanonicalMessageContentParts([
          {
            ...media,
            reference: {
              ...media.reference,
              [key]: " data:image/png;base64,secret",
            },
          },
        ]),
      ).toBeNull();
    },
  );

  it.each([
    null,
    {},
    [{ type: "media" }],
    [{ ...media, reference: { ...media.reference, byte_size: -1 } }],
  ])("rejects malformed content %j", (parts) => {
    expect(readCanonicalMessageContentParts(parts)).toBeNull();
  });
});
