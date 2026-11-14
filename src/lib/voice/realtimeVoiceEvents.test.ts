import { describe, expect, it } from "vitest";
import {
  applyRealtimeServerEvent,
  MAX_REALTIME_TRANSCRIPT_LINES,
  parseRealtimeServerEvent,
  type RealtimeTranscriptLine,
} from "./realtimeVoiceEvents";

function delta(text: string): string {
  return JSON.stringify({
    type: "response.output_audio_transcript.delta",
    item_id: "item-1",
    delta: text,
  });
}

describe("realtimeVoiceEvents", () => {
  it("recognizes real session started and never invents one", () => {
    expect(parseRealtimeServerEvent(delta("hello"))).toEqual({
      kind: "transcript-delta",
      role: "assistant",
      itemId: "item-1",
      delta: "hello",
    });
    expect(
      parseRealtimeServerEvent(
        JSON.stringify({
          type: "session.created",
          session: { id: "sess_123" },
        }),
      ),
    ).toEqual({ kind: "session-started", sessionId: "sess_123" });
    expect(
      parseRealtimeServerEvent(JSON.stringify({ type: "session.started" })),
    ).toEqual({ kind: "session-started", sessionId: undefined });
    expect(
      parseRealtimeServerEvent(JSON.stringify({ type: "session.updated" })),
    ).toEqual({ kind: "ignored" });
    expect(parseRealtimeServerEvent("not-json")).toEqual({ kind: "ignored" });
    expect(parseRealtimeServerEvent({ type: 42 })).toEqual({ kind: "ignored" });
  });

  it("parses user and assistant transcript deltas/done with old and new names", () => {
    expect(
      parseRealtimeServerEvent({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "user-1",
        delta: "Hi",
      }),
    ).toEqual({
      kind: "transcript-delta",
      role: "user",
      itemId: "user-1",
      delta: "Hi",
    });
    expect(
      parseRealtimeServerEvent({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "user-1",
        transcript: "Hi there",
      }),
    ).toEqual({
      kind: "transcript-done",
      role: "user",
      itemId: "user-1",
      text: "Hi there",
    });
    expect(
      parseRealtimeServerEvent({
        type: "response.audio_transcript.done",
        item_id: "assistant-1",
        transcript: "Legacy transcript",
      }),
    ).toEqual({
      kind: "transcript-done",
      role: "assistant",
      itemId: "assistant-1",
      text: "Legacy transcript",
    });
    expect(
      parseRealtimeServerEvent({
        type: "response.output_text.done",
        item_id: "assistant-2",
        text: "Text transcript",
      }),
    ).toEqual({
      kind: "transcript-done",
      role: "assistant",
      itemId: "assistant-2",
      text: "Text transcript",
    });
  });

  it("parses data-channel errors and close events", () => {
    expect(
      parseRealtimeServerEvent({
        type: "error",
        error: { message: "Invalid value" },
      }),
    ).toEqual({ kind: "error", message: "Invalid value" });
    expect(
      parseRealtimeServerEvent({
        type: "conversation.item.input_audio_transcription.failed",
        error: { code: "audio_unintelligible" },
      }),
    ).toEqual({ kind: "error", message: "audio_unintelligible" });
    expect(
      parseRealtimeServerEvent({
        type: "response.done",
        response: {
          status: "failed",
          status_details: { error: { message: "model failed" } },
        },
      }),
    ).toEqual({ kind: "error", message: "model failed" });
    expect(
      parseRealtimeServerEvent({
        type: "session.closed",
        reason: "completed",
      }),
    ).toEqual({ kind: "closed", reason: "completed" });
  });

  it("merges deltas and finalizes the same transcript line", () => {
    let lines: RealtimeTranscriptLine[] = [];
    lines = applyRealtimeServerEvent(lines, {
      kind: "transcript-delta",
      role: "assistant",
      itemId: "item-1",
      delta: "Hel",
    });
    lines = applyRealtimeServerEvent(lines, {
      kind: "transcript-delta",
      role: "assistant",
      itemId: "item-1",
      delta: "lo",
    });
    expect(lines).toEqual([
      {
        id: "assistant:item-1",
        role: "assistant",
        text: "Hello",
        final: false,
      },
    ]);
    lines = applyRealtimeServerEvent(lines, {
      kind: "transcript-done",
      role: "assistant",
      itemId: "item-1",
      text: "Hello there",
    });
    expect(lines).toEqual([
      {
        id: "assistant:item-1",
        role: "assistant",
        text: "Hello there",
        final: true,
      },
    ]);
    expect(applyRealtimeServerEvent(lines, { kind: "ignored" })).toBe(lines);
  });

  it("caps transcript growth without synthesizing content", () => {
    let lines: RealtimeTranscriptLine[] = [];
    for (let index = 0; index < MAX_REALTIME_TRANSCRIPT_LINES + 5; index += 1) {
      lines = applyRealtimeServerEvent(lines, {
        kind: "transcript-done",
        role: "user",
        itemId: `item-${index}`,
        text: `line ${index}`,
      });
    }
    expect(lines).toHaveLength(MAX_REALTIME_TRANSCRIPT_LINES);
    expect(lines[0]?.id).toBe("user:item-5");
  });
});
