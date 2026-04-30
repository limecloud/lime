import type {
  ArtifactDocumentBlock,
  ArtifactDocumentV1,
} from "@/lib/artifact-document";
import type { MessageTranscriptSegment } from "../types";
import {
  countTranscriptSpeakers,
  normalizeTranscriptSegments,
  parseTranscriptTimestampToMs,
} from "../utils/transcriptSegments";

const TRANSCRIPTION_TASK_TYPE = "transcription_generate";
const AUDIO_TRANSCRIPTION_CONTRACT = "audio_transcription";
const TRANSCRIPT_TEXT_BLOCK_ID = "transcript-text";
const TRANSCRIPT_SEGMENTS_BLOCK_ID = "transcript-segments";
const TRANSCRIPT_CORRECTION_STATUS_BLOCK_ID = "transcript-correction-status";

interface TranscriptCorrectionDiffSummary {
  textChanged: boolean;
  originalTextLength: number;
  correctedTextLength: number;
  textLengthDelta: number;
  originalSegmentCount: number;
  correctedSegmentCount: number;
  changedSegmentCount: number;
  originalSpeakerCount: number;
  correctedSpeakerCount: number;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataText(
  document: ArtifactDocumentV1,
  key: string,
): string | null {
  return normalizeText(document.metadata[key]);
}

function isAudioTranscriptionDocument(document: ArtifactDocumentV1): boolean {
  return (
    readMetadataText(document, "modalityContractKey") ===
      AUDIO_TRANSCRIPTION_CONTRACT ||
    readMetadataText(document, "taskType") === TRANSCRIPTION_TASK_TYPE ||
    document.artifactId.startsWith("transcription-generate:")
  );
}

function findArtifactBlock<T extends ArtifactDocumentBlock["type"]>(
  document: ArtifactDocumentV1,
  blockId: string,
  blockType: T,
): Extract<ArtifactDocumentBlock, { type: T }> | null {
  const block = document.blocks.find(
    (item) => item.id === blockId && item.type === blockType,
  );
  return (
    (block as Extract<ArtifactDocumentBlock, { type: T }> | undefined) || null
  );
}

function resolveCorrectedTranscriptText(document: ArtifactDocumentV1): string {
  const codeBlock = findArtifactBlock(
    document,
    TRANSCRIPT_TEXT_BLOCK_ID,
    "code_block",
  );
  return (
    normalizeText(codeBlock?.code) ||
    readMetadataText(document, "transcriptText") ||
    ""
  );
}

function resolveOriginalTranscriptText(document: ArtifactDocumentV1): string {
  return readMetadataText(document, "transcriptText") || "";
}

function parseSegmentRange(value: string): {
  startMs: number | null;
  endMs: number | null;
} {
  const normalized = value.replace(/[–—]/g, "-").trim();
  const parts = normalized.includes("-->")
    ? normalized.split("-->")
    : normalized.split(/\s+-\s+/);

  return {
    startMs: parts[0] ? parseTranscriptTimestampToMs(parts[0]) : null,
    endMs: parts[1] ? parseTranscriptTimestampToMs(parts[1]) : null,
  };
}

function normalizeSpeaker(value: string | undefined): string | null {
  const speaker = normalizeText(value);
  if (!speaker || speaker === "未标注") {
    return null;
  }
  return speaker;
}

function resolveOriginalTranscriptSegments(
  document: ArtifactDocumentV1,
): MessageTranscriptSegment[] {
  if (!Array.isArray(document.metadata.transcriptSegments)) {
    return [];
  }

  return normalizeTranscriptSegments(
    document.metadata.transcriptSegments as MessageTranscriptSegment[],
  );
}

function isSameSegment(
  left: MessageTranscriptSegment | undefined,
  right: MessageTranscriptSegment | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.text.trim() === right.text.trim() &&
    (left.speaker?.trim() || "") === (right.speaker?.trim() || "") &&
    (left.startMs ?? null) === (right.startMs ?? null) &&
    (left.endMs ?? null) === (right.endMs ?? null)
  );
}

function countChangedSegments(
  originalSegments: MessageTranscriptSegment[],
  correctedSegments: MessageTranscriptSegment[],
): number {
  const total = Math.max(originalSegments.length, correctedSegments.length);
  let changedCount = 0;

  for (let index = 0; index < total; index += 1) {
    if (!isSameSegment(originalSegments[index], correctedSegments[index])) {
      changedCount += 1;
    }
  }

  return changedCount;
}

function buildTranscriptCorrectionDiffSummary(
  document: ArtifactDocumentV1,
  correctedText: string,
  correctedSegments: MessageTranscriptSegment[],
): TranscriptCorrectionDiffSummary {
  const originalText = resolveOriginalTranscriptText(document);
  const originalSegments = resolveOriginalTranscriptSegments(document);
  const originalTextLength = originalText.trim().length;
  const correctedTextLength = correctedText.trim().length;

  return {
    textChanged: originalText.trim() !== correctedText.trim(),
    originalTextLength,
    correctedTextLength,
    textLengthDelta: correctedTextLength - originalTextLength,
    originalSegmentCount: originalSegments.length,
    correctedSegmentCount: correctedSegments.length,
    changedSegmentCount: countChangedSegments(
      originalSegments,
      correctedSegments,
    ),
    originalSpeakerCount: countTranscriptSpeakers(originalSegments),
    correctedSpeakerCount: countTranscriptSpeakers(correctedSegments),
  };
}

function formatDelta(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

function buildCorrectionStatusBody(
  summary: TranscriptCorrectionDiffSummary,
  sourceTranscriptPath: string | null,
): string {
  const lines = [
    "校对稿已保存为当前运行时文档的新版本；原始 ASR 输出文件保持不变。",
    `文本长度：${summary.originalTextLength} -> ${summary.correctedTextLength}（${formatDelta(
      summary.textLengthDelta,
    )}）`,
    `时间轴段落：${summary.originalSegmentCount} -> ${summary.correctedSegmentCount}，变更段落 ${summary.changedSegmentCount} 个`,
    `说话人数：${summary.originalSpeakerCount} -> ${summary.correctedSpeakerCount}`,
  ];

  if (sourceTranscriptPath) {
    lines.push(`原始 transcript：${sourceTranscriptPath}`);
  }

  return lines.join("\n");
}

function upsertCorrectionStatusBlock(
  document: ArtifactDocumentV1,
  diffSummary: TranscriptCorrectionDiffSummary,
  sourceTranscriptPath: string | null,
): ArtifactDocumentBlock[] {
  const statusBlock: ArtifactDocumentBlock = {
    id: TRANSCRIPT_CORRECTION_STATUS_BLOCK_ID,
    type: "callout",
    tone: "success",
    title: "校对稿已保存",
    body: buildCorrectionStatusBody(diffSummary, sourceTranscriptPath),
  };
  const existingIndex = document.blocks.findIndex(
    (block) => block.id === TRANSCRIPT_CORRECTION_STATUS_BLOCK_ID,
  );

  if (existingIndex >= 0) {
    return document.blocks.map((block, index) =>
      index === existingIndex ? statusBlock : block,
    );
  }

  const transcriptOutputIndex = document.blocks.findIndex(
    (block) => block.id === "transcript-output",
  );
  if (transcriptOutputIndex < 0) {
    return [...document.blocks, statusBlock];
  }

  return [
    ...document.blocks.slice(0, transcriptOutputIndex + 1),
    statusBlock,
    ...document.blocks.slice(transcriptOutputIndex + 1),
  ];
}

export function extractCorrectedTranscriptSegments(
  document: ArtifactDocumentV1,
): MessageTranscriptSegment[] {
  const tableBlock = findArtifactBlock(
    document,
    TRANSCRIPT_SEGMENTS_BLOCK_ID,
    "table",
  );
  if (!tableBlock || !Array.isArray(tableBlock.rows)) {
    return [];
  }

  return tableBlock.rows
    .map((row, index): MessageTranscriptSegment | null => {
      const [rangeLabel = "", speakerLabel = "", ...textCells] = row;
      const text = textCells.join(" | ").trim();
      if (!text) {
        return null;
      }
      const { startMs, endMs } = parseSegmentRange(rangeLabel);

      return {
        id: `corrected-segment-${index + 1}`,
        index: index + 1,
        startMs,
        endMs,
        speaker: normalizeSpeaker(speakerLabel),
        text,
      };
    })
    .filter((item): item is MessageTranscriptSegment => Boolean(item));
}

function countCorrectedSpeakers(segments: MessageTranscriptSegment[]): number {
  return new Set(
    segments
      .map((segment) => segment.speaker?.trim())
      .filter((speaker): speaker is string => Boolean(speaker)),
  ).size;
}

export function applyTranscriptCorrectionVersionMetadata(
  document: ArtifactDocumentV1,
  options: {
    editedBlockId?: string | null;
    savedAt?: string;
  } = {},
): ArtifactDocumentV1 {
  if (!isAudioTranscriptionDocument(document)) {
    return document;
  }

  const correctedText = resolveCorrectedTranscriptText(document);
  const correctedSegments = extractCorrectedTranscriptSegments(document);
  const sourceTranscriptPath = readMetadataText(document, "transcriptPath");
  const diffSummary = buildTranscriptCorrectionDiffSummary(
    document,
    correctedText,
    correctedSegments,
  );

  return {
    ...document,
    blocks: upsertCorrectionStatusBlock(
      document,
      diffSummary,
      sourceTranscriptPath,
    ),
    metadata: {
      ...document.metadata,
      transcriptCorrectionEnabled: true,
      transcriptCorrectionStatus: "saved",
      transcriptCorrectionSource: "artifact_document_version",
      transcriptCorrectionPatchKind: "artifact_document_version",
      transcriptCorrectionOriginalImmutable: true,
      transcriptCorrectionSavedAt: options.savedAt || new Date().toISOString(),
      transcriptCorrectionEditedBlockId: options.editedBlockId || null,
      transcriptCorrectionTextBlockId: correctedText
        ? TRANSCRIPT_TEXT_BLOCK_ID
        : null,
      transcriptCorrectionTextLength: correctedText.trim().length,
      transcriptCorrectionSegmentBlockId:
        correctedSegments.length > 0 ? TRANSCRIPT_SEGMENTS_BLOCK_ID : null,
      transcriptCorrectionSegmentCount: correctedSegments.length,
      transcriptCorrectionSpeakerCount:
        countCorrectedSpeakers(correctedSegments),
      transcriptCorrectionSourceTranscriptPath: sourceTranscriptPath,
      transcriptCorrectionDiffSummary: diffSummary,
      transcriptSegmentsCorrected: correctedSegments,
    },
  };
}
