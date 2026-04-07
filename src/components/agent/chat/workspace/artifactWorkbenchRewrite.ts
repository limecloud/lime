import {
  parseArtifactOperationCandidateString,
  type ArtifactDocumentBlock,
  type ArtifactDocumentOperation,
  type ArtifactOperationCandidateEnvelope,
  type ArtifactDocumentSource,
  type ArtifactDocumentV1,
} from "@/lib/artifact-document";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import type {
  EditableArtifactBlockDraft,
  EditableArtifactBlockEntry,
} from "./artifactWorkbenchEditableDraft";
import type { ArtifactTimelineLink } from "../utils/artifactTimelineNavigation";
import { DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION } from "./artifactWorkbenchRewriteConfig";
import {
  parseChecklistDraftItems,
  parseMetricDraftItems,
  parseTableDraftColumns,
  parseTableDraftRows,
  resolveEditableArtifactDraft,
} from "./artifactWorkbenchEditableDraft";

export interface ArtifactBlockRewriteRunPayload {
  artifact: Artifact;
  document: ArtifactDocumentV1;
  entry: EditableArtifactBlockEntry;
  draft: EditableArtifactBlockDraft;
  timelineLink?: ArtifactTimelineLink | null;
  instruction?: string;
}

export interface ArtifactBlockRewriteRequest {
  prompt: string;
  requestMetadata: {
    artifact: {
      artifact_mode: "rewrite";
      artifact_stage: "rewrite";
      artifact_kind: ArtifactDocumentV1["kind"];
      artifact_request_id: string;
      artifact_target_block_id: string;
      artifact_rewrite_instruction: string;
      source_policy: "required" | "preferred";
      workbench_surface: "right_panel";
    };
  };
}

export interface ArtifactBlockRewriteSuggestion {
  block: ArtifactDocumentBlock;
  draft: EditableArtifactBlockDraft;
  summary?: string;
}

export interface ArtifactBlockRewriteCompletion {
  rawContent: string;
  suggestion: ArtifactBlockRewriteSuggestion | null;
  warning?: string;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactText(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function parseRewriteCandidateFromContent(
  rawContent: string,
): ArtifactOperationCandidateEnvelope | null {
  const direct = parseArtifactOperationCandidateString(rawContent);
  if (direct) {
    return direct;
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null = fencePattern.exec(rawContent);
  while (match) {
    const candidate = parseArtifactOperationCandidateString(match[1] || "");
    if (candidate) {
      return candidate;
    }
    match = fencePattern.exec(rawContent);
  }

  return null;
}

function resolveRewriteBlockFromOps(
  ops: ArtifactDocumentOperation[],
  targetBlockId: string,
): {
  block: ArtifactDocumentBlock | null;
  summary?: string;
} {
  const upsertOp =
    ops.find(
      (
        op,
      ): op is Extract<
        ArtifactDocumentOperation,
        { op: "artifact.upsert_block" }
      > => op.op === "artifact.upsert_block" && op.block.id === targetBlockId,
    ) ||
    ops.find(
      (
        op,
      ): op is Extract<
        ArtifactDocumentOperation,
        { op: "artifact.upsert_block" }
      > => op.op === "artifact.upsert_block",
    ) ||
    null;

  const finalizeOp = ops.find(
    (
      op,
    ): op is Extract<
      ArtifactDocumentOperation,
      { op: "artifact.finalize_version" }
    > => op.op === "artifact.finalize_version",
  );

  return {
    block: upsertOp?.block || null,
    summary: normalizeText(finalizeOp?.summary),
  };
}

export function resolveArtifactBlockRewriteCompletion(
  payload: ArtifactBlockRewriteRunPayload,
  rawContent: string,
): ArtifactBlockRewriteCompletion {
  const candidate = parseRewriteCandidateFromContent(rawContent);
  if (!candidate) {
    return {
      rawContent,
      suggestion: null,
      warning:
        "改写已完成，但当前返回内容未命中结构化 rewrite patch，暂时不能直接回填到草稿。",
    };
  }

  let block: ArtifactDocumentBlock | null = null;
  let targetBlockId: string | null = null;
  let summary: string | undefined;

  switch (candidate.type) {
    case "artifact_rewrite_patch":
      block = candidate.block;
      targetBlockId = candidate.targetBlockId;
      summary = normalizeText(candidate.summary);
      break;
    case "artifact.block.upsert":
      block = candidate.block;
      targetBlockId = candidate.block.id;
      break;
    case "artifact_ops": {
      const resolved = resolveRewriteBlockFromOps(
        candidate.ops,
        payload.entry.blockId,
      );
      block = resolved.block;
      targetBlockId = resolved.block?.id || null;
      summary = resolved.summary;
      break;
    }
    default:
      return {
        rawContent,
        suggestion: null,
        warning:
          "改写已完成，但当前返回的是状态型结果，不包含可直接回填的 block 内容。",
      };
  }

  if (!block || !targetBlockId) {
    return {
      rawContent,
      suggestion: null,
      warning: "改写已完成，但当前返回结果没有包含可回填的目标 block。",
    };
  }

  if (
    targetBlockId !== payload.entry.blockId ||
    block.id !== payload.entry.blockId
  ) {
    return {
      rawContent,
      suggestion: null,
      warning: "改写已完成，但当前返回 block 与所选目标不一致，暂不自动回填。",
    };
  }

  const draft = resolveEditableArtifactDraft(block);
  if (!draft) {
    return {
      rawContent,
      suggestion: null,
      warning: "改写已完成，但返回的 block 类型当前编辑面还不支持直接回填。",
    };
  }

  if (draft.editorKind !== payload.entry.editorKind) {
    return {
      rawContent,
      suggestion: null,
      warning:
        "改写已完成，但返回内容的编辑类型与当前 block 不一致，暂不自动回填。",
    };
  }

  return {
    rawContent,
    suggestion: {
      block,
      draft,
      summary,
    },
  };
}

function resolveArtifactRequestId(
  artifact: Artifact,
  document: ArtifactDocumentV1,
): string | null {
  const artifactMetaRequestId = normalizeText(artifact.meta.artifactRequestId);
  if (artifactMetaRequestId) {
    return artifactMetaRequestId;
  }

  const artifactId = normalizeText(document.artifactId);
  if (!artifactId) {
    return null;
  }

  return artifactId.startsWith("artifact-document:")
    ? artifactId.slice("artifact-document:".length)
    : artifactId;
}

function resolveTargetBlock(
  document: ArtifactDocumentV1,
  blockId: string,
): ArtifactDocumentBlock {
  const block = document.blocks.find((item) => item.id === blockId);
  if (!block) {
    throw new Error("当前选中的 block 已不存在，无法发起 AI 改写");
  }
  return block;
}

function resolveDraftPayload(
  draft: EditableArtifactBlockDraft,
): Record<string, unknown> {
  switch (draft.editorKind) {
    case "rich_text":
      return {
        editorKind: draft.editorKind,
        markdown: draft.markdown.trim(),
      };
    case "section_header":
      return {
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        description: draft.description.trim(),
      };
    case "hero_summary":
      return {
        editorKind: draft.editorKind,
        eyebrow: draft.eyebrow.trim(),
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        highlights: draft.highlights
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      };
    case "callout":
      return {
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        tone: draft.tone.trim(),
      };
    case "key_points":
      return {
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        items: draft.items
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      };
    case "table": {
      const columns = parseTableDraftColumns(draft.columns);
      return {
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        columns,
        rows: parseTableDraftRows(draft.rows, columns.length),
      };
    }
    case "checklist":
      return {
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        items: parseChecklistDraftItems(draft.items, "rewrite"),
      };
    case "metric_grid":
      return {
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        metrics: parseMetricDraftItems(draft.metrics, "rewrite"),
      };
    case "quote":
      return {
        editorKind: draft.editorKind,
        text: draft.text.trim(),
        attribution: draft.attribution.trim(),
      };
    case "code_block":
      return {
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        language: draft.language.trim(),
        code: draft.code,
      };
    default:
      throw new Error("当前 block draft 类型暂不支持 AI 改写");
  }
}

function resolveBlockOutlineLabel(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(block.title) ||
    normalizeText(block.summary) ||
    normalizeText(block.body) ||
    normalizeText(block.text) ||
    normalizeText(block.caption) ||
    normalizeText(block.code) ||
    block.id
  );
}

function resolveOutlineWindow(
  document: ArtifactDocumentV1,
  targetBlockId: string,
): Array<Record<string, unknown>> {
  const targetIndex = document.blocks.findIndex(
    (block) => block.id === targetBlockId,
  );
  const start = Math.max(0, targetIndex - 2);
  const end = Math.min(document.blocks.length, targetIndex + 3);

  return document.blocks.slice(start, end).map((block, offset) => ({
    index: start + offset + 1,
    id: block.id,
    type: block.type,
    label: compactText(resolveBlockOutlineLabel(block), 80),
    sourceIds: Array.isArray(block.sourceIds) ? block.sourceIds : [],
  }));
}

function resolveRelevantSources(
  block: ArtifactDocumentBlock,
  sources: ArtifactDocumentSource[],
): ArtifactDocumentSource[] {
  const sourceIds = Array.isArray(block.sourceIds) ? block.sourceIds : [];
  if (sourceIds.length === 0) {
    return [];
  }

  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  return sourceIds
    .map((sourceId) => sourceMap.get(sourceId))
    .filter((source): source is ArtifactDocumentSource => Boolean(source));
}

function serializeSourceForPrompt(source: ArtifactDocumentSource) {
  return {
    id: source.id,
    type: source.type,
    label: source.label,
    reliability: source.reliability,
    locator: source.locator,
    snippet: normalizeText(source.snippet),
  };
}

function buildRewritePrompt(input: {
  artifact: Artifact;
  document: ArtifactDocumentV1;
  entry: EditableArtifactBlockEntry;
  draft: EditableArtifactBlockDraft;
  targetBlock: ArtifactDocumentBlock;
  timelineLink?: ArtifactTimelineLink | null;
  instruction: string;
  sourcePolicy: "required" | "preferred";
}): string {
  const {
    artifact,
    document,
    entry,
    draft,
    targetBlock,
    timelineLink,
    instruction,
    sourcePolicy,
  } = input;
  const artifactPath = resolveArtifactProtocolFilePath(artifact);
  const outlineWindow = resolveOutlineWindow(document, entry.blockId);
  const relevantSources = resolveRelevantSources(
    targetBlock,
    document.sources,
  ).map(serializeSourceForPrompt);

  const sections = [
    "你正在执行 Lime Artifact Workbench 的局部改写任务。",
    "请只改写当前一个 block，并返回符合 Artifact rewrite 合同的结构化结果。",
    "",
    "当前文档",
    `- 标题：${document.title}`,
    `- kind：${document.kind}`,
    `- artifactId：${document.artifactId}`,
    `- 文件：${artifactPath}`,
    `- source_policy：${sourcePolicy}`,
    "",
    "目标 block",
    `- id：${entry.blockId}`,
    `- type：${targetBlock.type}`,
    `- 标签：${entry.label}`,
    `- 说明：${entry.detail || "无"}`,
    `- 请尽量保持 block type 不变：${targetBlock.type}`,
    "",
    "改写指令",
    `- ${instruction}`,
    "- 优先最小改动，不要重写整篇文档，不要顺手改其他 block。",
    "- 如果当前信息不足，只做稳妥改写，不要编造新的事实或来源。",
    "",
    "当前编辑稿（这是最新输入，即使它还没保存）",
    "```json",
    JSON.stringify(resolveDraftPayload(draft), null, 2),
    "```",
    "",
    "目标 block 的当前快照",
    "```json",
    JSON.stringify(targetBlock, null, 2),
    "```",
    "",
    "相邻结构提要",
    "```json",
    JSON.stringify(outlineWindow, null, 2),
    "```",
  ];

  if (relevantSources.length > 0) {
    sections.push(
      "",
      "当前 block 绑定的来源",
      "```json",
      JSON.stringify(relevantSources, null, 2),
      "```",
    );
  }

  if (timelineLink) {
    sections.push(
      "",
      "最近关联过程",
      "```json",
      JSON.stringify(
        {
          itemId: timelineLink.itemId,
          label: timelineLink.label,
          filePath: timelineLink.filePath,
          sequence: timelineLink.sequence,
        },
        null,
        2,
      ),
      "```",
    );
  }

  return sections.join("\n");
}

export function buildArtifactBlockRewriteRequest(
  payload: ArtifactBlockRewriteRunPayload,
): ArtifactBlockRewriteRequest {
  const requestId = resolveArtifactRequestId(
    payload.artifact,
    payload.document,
  );
  if (!requestId) {
    throw new Error("当前 Artifact 缺少 request id，暂时无法发起局部改写");
  }

  const targetBlock = resolveTargetBlock(
    payload.document,
    payload.entry.blockId,
  );
  const instruction =
    normalizeText(payload.instruction) ||
    DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION;
  const sourcePolicy =
    payload.document.sources.length > 0 ? "required" : "preferred";

  return {
    prompt: buildRewritePrompt({
      artifact: payload.artifact,
      document: payload.document,
      entry: payload.entry,
      draft: payload.draft,
      targetBlock,
      timelineLink: payload.timelineLink,
      instruction,
      sourcePolicy,
    }),
    requestMetadata: {
      artifact: {
        artifact_mode: "rewrite",
        artifact_stage: "rewrite",
        artifact_kind: payload.document.kind,
        artifact_request_id: requestId,
        artifact_target_block_id: payload.entry.blockId,
        artifact_rewrite_instruction: instruction,
        source_policy: sourcePolicy,
        workbench_surface: "right_panel",
      },
    },
  };
}
