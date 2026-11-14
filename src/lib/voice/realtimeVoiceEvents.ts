/**
 * OpenAI Realtime `oai-events` data channel 事件解析。
 *
 * 这里只消费真实 server event；没有 session.created/started 时上层不得把
 * 连接标记为已开始。未知事件保持 ignored，不合成 transcript/audio。
 */

export type RealtimeTranscriptRole = "user" | "assistant";

export interface RealtimeTranscriptLine {
  id: string;
  role: RealtimeTranscriptRole;
  text: string;
  final: boolean;
}

export type RealtimeServerEvent =
  | { kind: "session-started"; sessionId?: string }
  | {
      kind: "transcript-delta";
      role: RealtimeTranscriptRole;
      itemId: string;
      delta: string;
    }
  | {
      kind: "transcript-done";
      role: RealtimeTranscriptRole;
      itemId: string;
      text?: string;
    }
  | { kind: "error"; message: string }
  | { kind: "closed"; reason?: string }
  | { kind: "ignored" };

export const MAX_REALTIME_TRANSCRIPT_LINES = 50;
const MAX_REALTIME_TRANSCRIPT_CHARS = 20_000;

const USER_TRANSCRIPT_DELTA =
  "conversation.item.input_audio_transcription.delta";
const USER_TRANSCRIPT_COMPLETED =
  "conversation.item.input_audio_transcription.completed";
const USER_TRANSCRIPT_FAILED =
  "conversation.item.input_audio_transcription.failed";
const ASSISTANT_TRANSCRIPT_DELTAS = new Set([
  "response.audio_transcript.delta",
  "response.output_audio_transcript.delta",
  "response.output_text.delta",
]);
const ASSISTANT_TRANSCRIPT_DONES = new Set([
  "response.audio_transcript.done",
  "response.output_audio_transcript.done",
  "response.output_text.done",
]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** SSE/RTC delta text must keep its whitespace, even a lone space. */
function deltaText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === "string") {
    try {
      return recordValue(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  return recordValue(payload);
}

function eventItemId(source: Record<string, unknown>): string {
  return (
    nonEmptyString(source.item_id) ??
    nonEmptyString(source.itemId) ??
    nonEmptyString(source.response_id) ??
    nonEmptyString(source.responseId) ??
    "unknown"
  );
}

function errorMessage(source: Record<string, unknown>): string {
  const error = recordValue(source.error);
  return (
    nonEmptyString(error?.message) ??
    nonEmptyString(source.message) ??
    nonEmptyString(error?.code) ??
    "OpenAI Realtime reported an error"
  );
}

/** 解析一条 data-channel JSON 事件；非法/未知输入返回 ignored。 */
export function parseRealtimeServerEvent(
  payload: unknown,
): RealtimeServerEvent {
  if (payload === null || payload === undefined) return { kind: "ignored" };
  const source = eventPayload(payload);
  const type = nonEmptyString(source?.type);
  if (!source || !type) return { kind: "ignored" };

  if (type === "session.created" || type === "session.started") {
    const session = recordValue(source.session);
    return {
      kind: "session-started",
      sessionId: nonEmptyString(session?.id) ?? nonEmptyString(source.id),
    };
  }
  if (type === "error" || type === USER_TRANSCRIPT_FAILED) {
    return { kind: "error", message: errorMessage(source) };
  }
  if (type === "session.closed" || type === "session.ended") {
    return { kind: "closed", reason: nonEmptyString(source.reason) };
  }
  if (type === "response.done") {
    const response = recordValue(source.response);
    if (nonEmptyString(response?.status) === "failed") {
      const details = recordValue(response?.status_details);
      return {
        kind: "error",
        message:
          nonEmptyString(recordValue(details?.error)?.message) ??
          "OpenAI Realtime response failed",
      };
    }
    return { kind: "ignored" };
  }
  if (type === USER_TRANSCRIPT_DELTA) {
    const delta = deltaText(source.delta);
    return delta
      ? {
          kind: "transcript-delta",
          role: "user",
          itemId: eventItemId(source),
          delta,
        }
      : { kind: "ignored" };
  }
  if (type === USER_TRANSCRIPT_COMPLETED) {
    return {
      kind: "transcript-done",
      role: "user",
      itemId: eventItemId(source),
      text: nonEmptyString(source.transcript) ?? nonEmptyString(source.text),
    };
  }
  if (ASSISTANT_TRANSCRIPT_DELTAS.has(type)) {
    const delta = deltaText(source.delta);
    return delta
      ? {
          kind: "transcript-delta",
          role: "assistant",
          itemId: eventItemId(source),
          delta,
        }
      : { kind: "ignored" };
  }
  if (ASSISTANT_TRANSCRIPT_DONES.has(type)) {
    return {
      kind: "transcript-done",
      role: "assistant",
      itemId: eventItemId(source),
      text: nonEmptyString(source.transcript) ?? nonEmptyString(source.text),
    };
  }
  return { kind: "ignored" };
}

function boundedText(text: string): string {
  return text.length > MAX_REALTIME_TRANSCRIPT_CHARS
    ? text.slice(0, MAX_REALTIME_TRANSCRIPT_CHARS)
    : text;
}

/** 把事件归并到 transcript timeline；只追加真实 delta/done。 */
export function applyRealtimeServerEvent(
  lines: readonly RealtimeTranscriptLine[],
  event: RealtimeServerEvent,
): RealtimeTranscriptLine[] {
  if (event.kind !== "transcript-delta" && event.kind !== "transcript-done") {
    return lines as RealtimeTranscriptLine[];
  }
  const id = `${event.role}:${event.itemId}`;
  const index = lines.findIndex((line) => line.id === id);
  if (event.kind === "transcript-delta") {
    if (index === -1) {
      const next = [
        ...lines,
        {
          id,
          role: event.role,
          text: boundedText(event.delta),
          final: false,
        },
      ];
      return next.slice(-MAX_REALTIME_TRANSCRIPT_LINES);
    }
    const current = lines[index];
    const next = [...lines];
    next[index] = {
      ...current,
      text: boundedText(current.text + event.delta),
      final: false,
    };
    return next;
  }

  const next = [...lines];
  if (index === -1) {
    next.push({
      id,
      role: event.role,
      text: boundedText(event.text ?? ""),
      final: true,
    });
  } else {
    next[index] = {
      ...lines[index],
      text: boundedText(event.text ?? lines[index].text),
      final: true,
    };
  }
  return next.slice(-MAX_REALTIME_TRANSCRIPT_LINES);
}
