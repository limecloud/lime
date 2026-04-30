import type { MessageTranscriptSegment } from "../types";

const MAX_TRANSCRIPT_SEGMENTS = 160;
const TIMECODE_PATTERN = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})([,.]\d{1,3})?/;

interface TimedValue {
  key: string;
  value: unknown;
}

interface TranscriptContentParseResult {
  text: string | null;
  segments: MessageTranscriptSegment[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function readTimedValue(
  candidate: Record<string, unknown>,
  keys: string[],
): TimedValue | null {
  for (const key of keys) {
    if (candidate[key] !== undefined && candidate[key] !== null) {
      return { key, value: candidate[key] };
    }
  }
  return null;
}

export function parseTranscriptTimestampToMs(value: string): number | null {
  const match = value.trim().match(TIMECODE_PATTERN);
  if (!match) {
    return null;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const fraction = match[4]
    ? Number(`0${match[4].replace(",", ".")}`) * 1000
    : 0;
  const totalMs =
    hours * 60 * 60 * 1000 + minutes * 60 * 1000 + seconds * 1000 + fraction;
  return Number.isFinite(totalMs) ? Math.round(totalMs) : null;
}

function normalizeTimedMs(timedValue: TimedValue | null): number | null {
  if (!timedValue) {
    return null;
  }

  if (typeof timedValue.value === "string" && timedValue.value.trim()) {
    const parsedTimecode = parseTranscriptTimestampToMs(timedValue.value);
    if (parsedTimecode !== null) {
      return parsedTimecode;
    }
    const parsedNumber = Number(timedValue.value.trim());
    if (!Number.isFinite(parsedNumber)) {
      return null;
    }
    return normalizeTimedMs({ key: timedValue.key, value: parsedNumber });
  }

  if (
    typeof timedValue.value !== "number" ||
    !Number.isFinite(timedValue.value) ||
    timedValue.value < 0
  ) {
    return null;
  }

  const key = timedValue.key.toLowerCase();
  if (key.includes("ms") || timedValue.value > 10_000) {
    return Math.round(timedValue.value);
  }
  return Math.round(timedValue.value * 1000);
}

function normalizeSpeakerLabel(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  return value
    .replace(/^speaker[_\s-]*/i, "说话人 ")
    .replace(/^spk[_\s-]*/i, "说话人 ")
    .trim();
}

function normalizeTranscriptSegment(
  record: Record<string, unknown>,
  index: number,
): MessageTranscriptSegment | null {
  const text = readString(
    [record],
    ["text", "transcript", "sentence", "content", "utterance", "word"],
  );
  if (!text) {
    return null;
  }

  const startMs = normalizeTimedMs(
    readTimedValue(record, [
      "start_ms",
      "startMs",
      "start_time_ms",
      "startTimeMs",
      "start_seconds",
      "startSeconds",
      "start_time",
      "startTime",
      "start",
      "from",
      "offset",
    ]),
  );
  const endMs = normalizeTimedMs(
    readTimedValue(record, [
      "end_ms",
      "endMs",
      "end_time_ms",
      "endTimeMs",
      "end_seconds",
      "endSeconds",
      "end_time",
      "endTime",
      "end",
      "to",
    ]),
  );
  const speaker = normalizeSpeakerLabel(
    readString(
      [record],
      [
        "speaker",
        "speaker_label",
        "speakerLabel",
        "speaker_id",
        "speakerId",
        "channel",
      ],
    ),
  );

  return {
    id:
      readString([record], ["id", "segment_id", "segmentId"]) ||
      `segment-${index + 1}`,
    index: index + 1,
    startMs,
    endMs,
    speaker,
    text,
  };
}

function readArrayRecords(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): Record<string, unknown>[] {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (!Array.isArray(value) || value.length === 0) {
        continue;
      }
      const records = value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      if (records.length > 0) {
        return records;
      }
    }
  }
  return [];
}

function extractSegmentsFromJsonRecord(
  record: Record<string, unknown>,
): MessageTranscriptSegment[] {
  const nestedResult = asRecord(record.result);
  const nestedTranscript = asRecord(record.transcript);
  const nestedPayload = asRecord(record.payload);
  const candidates = [record, nestedResult, nestedTranscript, nestedPayload];
  const records = readArrayRecords(candidates, [
    "segments",
    "transcript_segments",
    "transcriptSegments",
    "utterances",
    "speaker_labels",
    "speakerLabels",
    "speaker_segments",
    "speakerSegments",
    "timestamps",
  ]);

  return normalizeTranscriptSegments(
    records
      .map((item, index) => normalizeTranscriptSegment(item, index))
      .filter((item): item is MessageTranscriptSegment => Boolean(item)),
  );
}

function parseSrtOrVttSegments(content: string): MessageTranscriptSegment[] {
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/^WEBVTT[^\n]*(\n|$)/i, "")
    .trim();
  if (!normalized.includes("-->")) {
    return [];
  }

  const blocks = normalized.split(/\n\s*\n/);
  const segments: MessageTranscriptSegment[] = [];
  blocks.forEach((block) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) {
      return;
    }
    const [startLabel, endLabel] = lines[timeIndex].split("-->");
    const startMs = parseTranscriptTimestampToMs(startLabel || "");
    const endMs = parseTranscriptTimestampToMs(
      (endLabel || "").trim().split(/\s+/)[0] || "",
    );
    const textLines = lines.slice(timeIndex + 1);
    if (textLines.length === 0) {
      return;
    }
    const rawText = textLines
      .join(" ")
      .replace(/<v\s+([^>]+)>/gi, "$1: ")
      .replace(/<\/v>/gi, "")
      .trim();
    const speakerMatch = rawText.match(/^([^:：]{1,32})[:：]\s*(.+)$/);
    const speaker = speakerMatch
      ? normalizeSpeakerLabel(speakerMatch[1] || null)
      : null;
    const text = speakerMatch ? speakerMatch[2]?.trim() : rawText;
    if (!text) {
      return;
    }
    segments.push({
      id: `segment-${segments.length + 1}`,
      index: segments.length + 1,
      startMs,
      endMs,
      speaker,
      text,
    });
  });

  return normalizeTranscriptSegments(segments);
}

export function normalizeTranscriptSegments(
  segments: MessageTranscriptSegment[] | undefined | null,
): MessageTranscriptSegment[] {
  if (!segments || segments.length === 0) {
    return [];
  }

  return segments
    .filter((segment) => segment.text.trim())
    .slice(0, MAX_TRANSCRIPT_SEGMENTS)
    .sort((left, right) => {
      const leftStart = left.startMs ?? Number.MAX_SAFE_INTEGER;
      const rightStart = right.startMs ?? Number.MAX_SAFE_INTEGER;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }
      return left.index - right.index;
    })
    .map((segment, index) => ({
      ...segment,
      id: segment.id || `segment-${index + 1}`,
      index: index + 1,
      speaker: normalizeSpeakerLabel(segment.speaker) || null,
      startMs: segment.startMs ?? null,
      endMs: segment.endMs ?? null,
      text: segment.text.trim(),
    }));
}

export function parseTranscriptContent(
  content: string | null | undefined,
): TranscriptContentParseResult {
  const text = typeof content === "string" && content.trim() ? content : null;
  if (!text) {
    return { text: null, segments: [] };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const record = asRecord(parsed);
    if (record) {
      const jsonText =
        readString(
          [record, asRecord(record.result), asRecord(record.payload)],
          [
            "text",
            "transcript_text",
            "transcriptText",
            "transcript",
            "content",
          ],
        ) || text;
      return {
        text: jsonText,
        segments: extractSegmentsFromJsonRecord(record),
      };
    }
    if (Array.isArray(parsed)) {
      return {
        text,
        segments: normalizeTranscriptSegments(
          parsed
            .map((item, index) =>
              asRecord(item)
                ? normalizeTranscriptSegment(asRecord(item)!, index)
                : null,
            )
            .filter((item): item is MessageTranscriptSegment => Boolean(item)),
        ),
      };
    }
  } catch {
    // 非 JSON transcript 继续按 SRT/VTT 或纯文本处理。
  }

  return {
    text,
    segments: parseSrtOrVttSegments(text),
  };
}

export function extractTranscriptSegmentsFromRecords(
  candidates: Array<Record<string, unknown> | null | undefined>,
): MessageTranscriptSegment[] {
  const records = readArrayRecords(candidates, [
    "segments",
    "transcript_segments",
    "transcriptSegments",
    "utterances",
    "speaker_labels",
    "speakerLabels",
    "speaker_segments",
    "speakerSegments",
    "timestamps",
  ]);
  return normalizeTranscriptSegments(
    records
      .map((item, index) => normalizeTranscriptSegment(item, index))
      .filter((item): item is MessageTranscriptSegment => Boolean(item)),
  );
}

export function formatTranscriptTimestamp(ms?: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return "--:--";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteLabel = String(minutes).padStart(2, "0");
  const secondLabel = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${minuteLabel}:${secondLabel}`;
  }
  return `${minuteLabel}:${secondLabel}`;
}

export function formatTranscriptSegmentRange(
  segment: MessageTranscriptSegment,
): string {
  const start = formatTranscriptTimestamp(segment.startMs);
  const end = formatTranscriptTimestamp(segment.endMs);
  if (start === "--:--" && end === "--:--") {
    return `#${segment.index}`;
  }
  if (end === "--:--") {
    return start;
  }
  return `${start} - ${end}`;
}

export function countTranscriptSpeakers(
  segments: MessageTranscriptSegment[] | undefined | null,
): number {
  if (!segments || segments.length === 0) {
    return 0;
  }
  return new Set(
    segments
      .map((segment) => segment.speaker?.trim())
      .filter((speaker): speaker is string => Boolean(speaker)),
  ).size;
}
