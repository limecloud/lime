import { describe, expect, it } from "vitest";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import {
  applyTranscriptCorrectionVersionMetadata,
  extractCorrectedTranscriptSegments,
} from "./transcriptCorrectionArtifact";

function createTranscriptionDocument(): ArtifactDocumentV1 {
  return {
    schemaVersion: "artifact_document.v1",
    artifactId: "transcription-generate:task-transcription-1",
    kind: "brief",
    title: "内容转写任务",
    status: "ready",
    language: "zh-CN",
    blocks: [
      {
        id: "transcript-segments",
        type: "table",
        title: "转写时间轴（可逐段编辑校对）",
        columns: ["时间", "说话人", "内容"],
        rows: [
          ["00:01 - 00:03", "主持人", "欢迎来到 Lime 访谈节目。"],
          ["00:04 - 00:07", "嘉宾", "这里是修订后的回答。"],
        ],
      },
      {
        id: "transcript-text",
        type: "code_block",
        title: "转写文本（可编辑校对）",
        language: "text",
        code: "欢迎来到 Lime 访谈节目。\n这里是修订后的回答。",
      },
    ],
    sources: [],
    metadata: {
      taskId: "task-transcription-1",
      taskType: "transcription_generate",
      modalityContractKey: "audio_transcription",
      transcriptPath: ".lime/runtime/transcripts/task-transcription-1.txt",
      transcriptText: "欢迎来到 Lime 访谈节目。\n这里是修订后的回答。",
      transcriptSegments: [
        {
          id: "segment-1",
          index: 1,
          startMs: 1000,
          endMs: 3000,
          speaker: "主持人",
          text: "欢迎来到 Lime 访谈节目。",
        },
        {
          id: "segment-2",
          index: 2,
          startMs: 4000,
          endMs: 7000,
          speaker: "嘉宾",
          text: "这里是修订后的回答。",
        },
      ],
    },
  };
}

describe("transcriptCorrectionArtifact", () => {
  it("应从转写时间轴表格提取校对后的分段", () => {
    expect(
      extractCorrectedTranscriptSegments(createTranscriptionDocument()),
    ).toEqual([
      {
        id: "corrected-segment-1",
        index: 1,
        startMs: 1000,
        endMs: 3000,
        speaker: "主持人",
        text: "欢迎来到 Lime 访谈节目。",
      },
      {
        id: "corrected-segment-2",
        index: 2,
        startMs: 4000,
        endMs: 7000,
        speaker: "嘉宾",
        text: "这里是修订后的回答。",
      },
    ]);
  });

  it("应只为 audio_transcription 文档补校对稿版本 metadata", () => {
    const document = applyTranscriptCorrectionVersionMetadata(
      createTranscriptionDocument(),
      {
        editedBlockId: "transcript-text",
        savedAt: "2026-04-30T12:00:00.000Z",
      },
    );

    expect(document.metadata).toMatchObject({
      transcriptCorrectionEnabled: true,
      transcriptCorrectionStatus: "saved",
      transcriptCorrectionSource: "artifact_document_version",
      transcriptCorrectionPatchKind: "artifact_document_version",
      transcriptCorrectionOriginalImmutable: true,
      transcriptCorrectionSavedAt: "2026-04-30T12:00:00.000Z",
      transcriptCorrectionEditedBlockId: "transcript-text",
      transcriptCorrectionTextBlockId: "transcript-text",
      transcriptCorrectionTextLength: 26,
      transcriptCorrectionSegmentBlockId: "transcript-segments",
      transcriptCorrectionSegmentCount: 2,
      transcriptCorrectionSpeakerCount: 2,
      transcriptCorrectionSourceTranscriptPath:
        ".lime/runtime/transcripts/task-transcription-1.txt",
      transcriptCorrectionDiffSummary: {
        textChanged: false,
        originalTextLength: 26,
        correctedTextLength: 26,
        textLengthDelta: 0,
        originalSegmentCount: 2,
        correctedSegmentCount: 2,
        changedSegmentCount: 0,
        originalSpeakerCount: 2,
        correctedSpeakerCount: 2,
      },
      transcriptSegmentsCorrected: [
        expect.objectContaining({
          id: "corrected-segment-1",
          speaker: "主持人",
        }),
        expect.objectContaining({
          id: "corrected-segment-2",
          speaker: "嘉宾",
        }),
      ],
    });
    expect(document.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "transcript-correction-status",
          type: "callout",
          tone: "success",
          title: "校对稿已保存",
          body: expect.stringContaining("原始 ASR 输出文件保持不变"),
        }),
      ]),
    );
  });

  it("非转写 ArtifactDocument 不应被补校对稿 metadata", () => {
    const document: ArtifactDocumentV1 = {
      ...createTranscriptionDocument(),
      artifactId: "artifact-document:demo",
      metadata: {
        taskType: "report_generate",
        modalityContractKey: "web_research",
      },
    };

    expect(applyTranscriptCorrectionVersionMetadata(document)).toBe(document);
  });
});
