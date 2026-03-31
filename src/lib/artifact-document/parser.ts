import {
  ARTIFACT_DOCUMENT_SCHEMA_VERSION,
  type ArtifactDocumentBlock,
  type ArtifactDocumentBlockType,
  type ArtifactDocumentKind,
  type ArtifactDocumentMeta,
  type ArtifactDocumentSourceLink,
  type ArtifactDocumentSource,
  type ArtifactDocumentVersionDiff,
  type ArtifactDocumentStatus,
  type ArtifactDocumentVersionSummary,
  type ArtifactDocumentV1,
} from "./types";

const ARTIFACT_DOCUMENT_BLOCK_TYPES = new Set<ArtifactDocumentBlockType>([
  "section_header",
  "hero_summary",
  "key_points",
  "rich_text",
  "callout",
  "table",
  "checklist",
  "metric_grid",
  "quote",
  "citation_list",
  "image",
  "code_block",
  "divider",
]);

const ARTIFACT_DOCUMENT_KINDS = new Set<ArtifactDocumentKind>([
  "report",
  "roadmap",
  "prd",
  "brief",
  "analysis",
  "comparison",
  "plan",
  "table_report",
]);

const ARTIFACT_DOCUMENT_STATUSES = new Set<ArtifactDocumentStatus>([
  "draft",
  "streaming",
  "ready",
  "failed",
  "archived",
]);

const ARTIFACT_DOCUMENT_SOURCE_TYPES = new Set<ArtifactDocumentSource["type"]>([
  "web",
  "file",
  "tool",
  "message",
  "search_result",
]);

const ARTIFACT_DOCUMENT_SOURCE_RELIABILITY_VALUES = new Set<
  NonNullable<ArtifactDocumentSource["reliability"]>
>(["primary", "secondary", "derived"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));

  return items.length > 0 ? items : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function stripOptionalJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) {
    return trimmed;
  }

  return lines.slice(1, -1).join("\n").trim();
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "artifact-document";
}

function normalizeArtifactKind(value: unknown): ArtifactDocumentKind {
  const normalized = normalizeText(value)?.toLowerCase() as
    | ArtifactDocumentKind
    | undefined;
  if (normalized && ARTIFACT_DOCUMENT_KINDS.has(normalized)) {
    return normalized;
  }
  return "analysis";
}

function normalizeArtifactStatus(value: unknown): ArtifactDocumentStatus {
  const normalized = normalizeText(value)?.toLowerCase() as
    | ArtifactDocumentStatus
    | undefined;
  if (normalized && ARTIFACT_DOCUMENT_STATUSES.has(normalized)) {
    return normalized;
  }
  return "ready";
}

function extractTextFromPortableNode(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFromPortableNode(item));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const text = normalizeText(record.text);
  if (text) {
    return [text];
  }

  const lines = extractTextFromPortableNode(record.content);
  if (lines.length > 0) {
    return lines;
  }

  return [];
}

export function extractPortableText(value: unknown): string {
  return extractTextFromPortableNode(value)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeArtifactSourceReliability(
  value: unknown,
): ArtifactDocumentSource["reliability"] | undefined {
  const normalized = normalizeText(value)?.toLowerCase() as
    | ArtifactDocumentSource["reliability"]
    | undefined;
  if (normalized && ARTIFACT_DOCUMENT_SOURCE_RELIABILITY_VALUES.has(normalized)) {
    return normalized;
  }
  return undefined;
}

function normalizeArtifactSourceLocator(
  record: Record<string, unknown>,
): ArtifactDocumentSource["locator"] | undefined {
  const existing = asRecord(record.locator) || {};
  const url =
    normalizeText(existing.url) ||
    normalizeText(record.url) ||
    normalizeText(record.href) ||
    normalizeText(record.link);
  const path = normalizeText(existing.path) || normalizeText(record.path);
  const lineStart =
    normalizeNumber(existing.lineStart) || normalizeNumber(record.lineStart);
  const lineEnd = normalizeNumber(existing.lineEnd) || normalizeNumber(record.lineEnd);
  const toolCallId =
    normalizeText(existing.toolCallId) ||
    normalizeText(record.toolCallId) ||
    normalizeText(record.tool_call_id);
  const messageId =
    normalizeText(existing.messageId) ||
    normalizeText(record.messageId) ||
    normalizeText(record.message_id);

  if (!url && !path && !lineStart && !lineEnd && !toolCallId && !messageId) {
    return undefined;
  }

  return {
    ...existing,
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(lineStart !== undefined ? { lineStart } : {}),
    ...(lineEnd !== undefined ? { lineEnd } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(messageId ? { messageId } : {}),
  };
}

function resolveSourceLocatorHint(
  locator: ArtifactDocumentSource["locator"] | undefined,
): string | undefined {
  return locator?.url || locator?.path;
}

function normalizeArtifactSourceType(
  value: unknown,
  locator: ArtifactDocumentSource["locator"] | undefined,
  id: string,
): ArtifactDocumentSource["type"] {
  const normalized = normalizeText(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "browser") {
    return "web";
  }
  if (normalized === "search" || normalized === "searchresult") {
    return "search_result";
  }
  if (normalized && ARTIFACT_DOCUMENT_SOURCE_TYPES.has(normalized as ArtifactDocumentSource["type"])) {
    return normalized as ArtifactDocumentSource["type"];
  }

  const normalizedId = id.toLowerCase();
  if (normalizedId.startsWith("file:")) {
    return "file";
  }
  if (normalizedId.startsWith("tool:")) {
    return "tool";
  }
  if (normalizedId.startsWith("message:")) {
    return "message";
  }
  if (normalizedId.startsWith("search:")) {
    return "search_result";
  }
  if (locator?.toolCallId) {
    return "tool";
  }
  if (locator?.messageId) {
    return "message";
  }
  if (locator?.path) {
    return "file";
  }
  if (locator?.url) {
    return "web";
  }
  return "message";
}

function normalizeSource(
  value: unknown,
  index: number,
): ArtifactDocumentSource | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = normalizeText(record.id) || `source-${index + 1}`;
  const locator = normalizeArtifactSourceLocator(record);
  const label =
    normalizeText(record.label) ||
    normalizeText(record.title) ||
    resolveSourceLocatorHint(locator) ||
    id;
  const snippet =
    normalizeText(record.snippet) ||
    normalizeText(record.note) ||
    normalizeText(record.summary) ||
    normalizeText(record.description) ||
    normalizeText(record.quote);
  const reliability = normalizeArtifactSourceReliability(record.reliability);
  const type = normalizeArtifactSourceType(
    record.type || record.kind,
    locator,
    id,
  );

  if (!label && !snippet && !locator) {
    return null;
  }

  return {
    ...record,
    id,
    type,
    label,
    ...(locator ? { locator } : {}),
    ...(snippet ? { snippet } : {}),
    ...(reliability ? { reliability } : {}),
  };
}

function normalizeVersionSummary(
  value: unknown,
  index: number,
  artifactId: string,
): ArtifactDocumentVersionSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const versionNo = normalizeNumber(record.versionNo) || normalizeNumber(record.version_no);
  if (!versionNo || versionNo <= 0) {
    return null;
  }

  const id = normalizeText(record.id) || `${artifactId}:v${versionNo}`;
  const createdBy = normalizeText(record.createdBy) || normalizeText(record.created_by);
  const createdAt = normalizeText(record.createdAt) || normalizeText(record.created_at);
  const snapshotPath =
    normalizeText(record.snapshotPath) || normalizeText(record.snapshot_path);

  return {
    ...record,
    id,
    artifactId:
      normalizeText(record.artifactId) ||
      normalizeText(record.artifact_id) ||
      artifactId,
    versionNo,
    ...(normalizeText(record.summary) ? { summary: normalizeText(record.summary) } : {}),
    ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
    ...(normalizeText(record.kind)
      ? { kind: normalizeArtifactKind(record.kind) }
      : {}),
    ...(normalizeText(record.status)
      ? { status: normalizeArtifactStatus(record.status) }
      : {}),
    ...(createdBy ? { createdBy: createdBy as "agent" | "user" | "automation" } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
  };
}

function normalizeSourceLink(
  value: unknown,
  index: number,
  artifactId: string,
): ArtifactDocumentSourceLink | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const blockId = normalizeText(record.blockId) || normalizeText(record.block_id);
  const sourceRef = normalizeText(record.sourceRef) || normalizeText(record.source_ref);
  if (!blockId || !sourceRef) {
    return null;
  }

  const locatorValue = record.locator;
  const locator =
    typeof locatorValue === "string" && locatorValue.trim()
      ? locatorValue.trim()
      : asRecord(locatorValue) || undefined;

  return {
    ...record,
    artifactId:
      normalizeText(record.artifactId) ||
      normalizeText(record.artifact_id) ||
      artifactId,
    blockId,
    ...(normalizeText(record.sourceId) || normalizeText(record.source_id)
      ? {
          sourceId:
            normalizeText(record.sourceId) || normalizeText(record.source_id),
        }
      : {}),
    sourceType:
      normalizeText(record.sourceType) ||
      normalizeText(record.source_type) ||
      "unknown",
    sourceRef,
    ...(normalizeText(record.label) ? { label: normalizeText(record.label) } : {}),
    ...(locator ? { locator } : {}),
  };
}

function normalizeVersionDiff(
  value: unknown,
): ArtifactDocumentVersionDiff | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const changedBlocks = Array.isArray(record.changedBlocks)
    ? record.changedBlocks
        .map((item) => {
          const entry = asRecord(item);
          const changeType = normalizeText(entry?.changeType);
          const blockId = normalizeText(entry?.blockId);
          if (!entry || !changeType || !blockId) {
            return null;
          }

          return {
            ...entry,
            blockId,
            changeType: changeType as ArtifactDocumentVersionDiff["changedBlocks"][number]["changeType"],
            ...(normalizeText(entry.beforeType)
              ? {
                  beforeType: normalizeText(
                    entry.beforeType,
                  ) as ArtifactDocumentBlockType,
                }
              : {}),
            ...(normalizeText(entry.afterType)
              ? {
                  afterType: normalizeText(
                    entry.afterType,
                  ) as ArtifactDocumentBlockType,
                }
              : {}),
            ...(normalizeNumber(entry.beforeIndex) !== undefined
              ? { beforeIndex: normalizeNumber(entry.beforeIndex) }
              : {}),
            ...(normalizeNumber(entry.afterIndex) !== undefined
              ? { afterIndex: normalizeNumber(entry.afterIndex) }
              : {}),
            ...(normalizeText(entry.beforeText)
              ? { beforeText: normalizeText(entry.beforeText) }
              : {}),
            ...(normalizeText(entry.afterText)
              ? { afterText: normalizeText(entry.afterText) }
              : {}),
            ...(normalizeText(entry.summary)
              ? { summary: normalizeText(entry.summary) }
              : {}),
          };
        })
        .filter(
          (
            item,
          ): item is ArtifactDocumentVersionDiff["changedBlocks"][number] =>
            item !== null,
        )
    : [];

  if (changedBlocks.length === 0) {
    return null;
  }

  return {
    ...record,
    ...(normalizeText(record.baseVersionId)
      ? { baseVersionId: normalizeText(record.baseVersionId) }
      : {}),
    ...(normalizeNumber(record.baseVersionNo) !== undefined
      ? { baseVersionNo: normalizeNumber(record.baseVersionNo) }
      : {}),
    ...(normalizeText(record.targetVersionId)
      ? { targetVersionId: normalizeText(record.targetVersionId) }
      : {}),
    ...(normalizeNumber(record.targetVersionNo) !== undefined
      ? { targetVersionNo: normalizeNumber(record.targetVersionNo) }
      : {}),
    ...(normalizeNumber(record.addedCount) !== undefined
      ? { addedCount: normalizeNumber(record.addedCount) }
      : {}),
    ...(normalizeNumber(record.removedCount) !== undefined
      ? { removedCount: normalizeNumber(record.removedCount) }
      : {}),
    ...(normalizeNumber(record.updatedCount) !== undefined
      ? { updatedCount: normalizeNumber(record.updatedCount) }
      : {}),
    ...(normalizeNumber(record.movedCount) !== undefined
      ? { movedCount: normalizeNumber(record.movedCount) }
      : {}),
    changedBlocks,
  };
}

function buildFallbackRichTextBlock(
  block: Record<string, unknown>,
  index: number,
): ArtifactDocumentBlock | null {
  const content =
    normalizeText(block.text) ||
    normalizeText(block.content) ||
    extractPortableText(block.content) ||
    JSON.stringify(block, null, 2);

  if (!content) {
    return null;
  }

  return {
    id: normalizeText(block.id) || `block-${index + 1}`,
    type: "rich_text",
    contentFormat: "markdown",
    content,
    markdown: content,
    originalType: normalizeText(block.type) || "unknown",
  };
}

function resolveRichTextBlockContent(
  record: Record<string, unknown>,
): Pick<ArtifactDocumentBlock & { type: "rich_text" }, "contentFormat" | "content" | "markdown" | "tiptap" | "proseMirror"> | null {
  const declaredFormat = normalizeText(record.contentFormat)?.toLowerCase();
  if (declaredFormat === "prosemirror_json" && record.content !== undefined) {
    return {
      contentFormat: "prosemirror_json",
      content: record.content,
      proseMirror: record.content,
    };
  }
  if (record.proseMirror !== undefined || record.tiptap !== undefined) {
    const content = record.proseMirror ?? record.tiptap;
    return {
      contentFormat: "prosemirror_json",
      content,
      ...(record.tiptap !== undefined ? { tiptap: record.tiptap } : {}),
      ...(record.proseMirror !== undefined ? { proseMirror: record.proseMirror } : {}),
    };
  }

  const markdown =
    normalizeText(record.markdown) ||
    normalizeText(record.text) ||
    normalizeText(record.content) ||
    extractPortableText(record.content);
  if (!markdown) {
    return null;
  }

  return {
    contentFormat: "markdown",
    content: markdown,
    markdown,
  };
}

function normalizeCalloutTone(value: unknown): "info" | "success" | "warning" | "danger" | "neutral" {
  const normalized = normalizeText(value)?.toLowerCase();
  switch (normalized) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
    case "error":
    case "critical":
      return "danger";
    case "neutral":
      return "neutral";
    default:
      return "info";
  }
}

function normalizeTableColumns(record: Record<string, unknown>): string[] {
  const columns = Array.isArray(record.columns)
    ? record.columns
    : Array.isArray(record.headers)
      ? record.headers
      : [];
  return columns
    .map((column) =>
      typeof column === "string"
        ? column.trim()
        : normalizeText(asRecord(column)?.label) ||
          normalizeText(asRecord(column)?.title) ||
          normalizeText(asRecord(column)?.key) ||
          "",
    )
    .filter(Boolean);
}

function normalizeTableRows(
  record: Record<string, unknown>,
  columns: string[],
): string[][] {
  if (!Array.isArray(record.rows)) {
    return [];
  }

  return record.rows
    .map((row) => {
      if (Array.isArray(row)) {
        return row.map((cell) => normalizeText(cell) || String(cell ?? ""));
      }

      const rowRecord = asRecord(row);
      if (!rowRecord) {
        return null;
      }

      if (columns.length > 0) {
        return columns.map((column) => normalizeText(rowRecord[column]) || "");
      }

      return Object.values(rowRecord).map((cell) => normalizeText(cell) || String(cell ?? ""));
    })
    .filter((row): row is string[] => Boolean(row));
}

function normalizeChecklistItems(record: Record<string, unknown>): Array<{
  id: string;
  text: string;
  state: "todo" | "doing" | "done";
}> {
  if (!Array.isArray(record.items)) {
    return [];
  }

  return record.items
    .map((item, index) => {
      if (typeof item === "string") {
        const text = item.trim();
        if (!text) {
          return null;
        }
        return {
          id: `check-${index + 1}`,
          text,
          state: "todo" as const,
        };
      }

      const itemRecord = asRecord(item);
      const text =
        normalizeText(itemRecord?.text) ||
        normalizeText(itemRecord?.label) ||
        normalizeText(itemRecord?.title) ||
        normalizeText(itemRecord?.content);
      if (!itemRecord || !text) {
        return null;
      }

      const explicitState = normalizeText(itemRecord.state)?.toLowerCase();
      const state =
        explicitState === "doing" || explicitState === "done" || explicitState === "todo"
          ? explicitState
          : itemRecord.checked === true ||
              itemRecord.done === true ||
              itemRecord.completed === true
            ? "done"
            : "todo";

      return {
        id: normalizeText(itemRecord.id) || `check-${index + 1}`,
        text,
        state,
      };
    })
    .filter(
      (
        item,
      ): item is { id: string; text: string; state: "todo" | "doing" | "done" } =>
        item !== null,
    );
}

function normalizeMetricItems(record: Record<string, unknown>): Array<{
  id: string;
  label: string;
  value: string;
  note?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}> {
  const items = Array.isArray(record.metrics)
    ? record.metrics
    : Array.isArray(record.items)
      ? record.items
      : [];

  return items
    .map((item, index) => {
      const itemRecord = asRecord(item);
      if (!itemRecord) {
        return null;
      }

      const label =
        normalizeText(itemRecord.label) ||
        normalizeText(itemRecord.title) ||
        `指标 ${index + 1}`;
      const value =
        normalizeText(itemRecord.value) ||
        normalizeText(itemRecord.metric) ||
        normalizeText(itemRecord.score);
      if (!value) {
        return null;
      }

      const tone = normalizeText(itemRecord.tone)?.toLowerCase();
      return {
        id: normalizeText(itemRecord.id) || `metric-${index + 1}`,
        label,
        value,
        ...(normalizeText(itemRecord.note) ||
        normalizeText(itemRecord.detail) ||
        normalizeText(itemRecord.description) ||
        normalizeText(itemRecord.trend)
          ? {
              note:
                normalizeText(itemRecord.note) ||
                normalizeText(itemRecord.detail) ||
                normalizeText(itemRecord.description) ||
                normalizeText(itemRecord.trend),
            }
          : {}),
        ...(tone === "neutral" || tone === "success" || tone === "warning" || tone === "danger"
          ? { tone }
          : {}),
      };
    })
    .filter(
      (
        item,
      ): item is {
        id: string;
        label: string;
        value: string;
        note?: string;
        tone?: "neutral" | "success" | "warning" | "danger";
      } => item !== null,
    );
}

function resolveCitationSourceId(
  itemRecord: Record<string, unknown>,
  sources: ArtifactDocumentSource[],
): string | undefined {
  const directId = normalizeText(itemRecord.sourceId) || normalizeText(itemRecord.source_id);
  if (directId) {
    return directId;
  }

  const url =
    normalizeText(itemRecord.url) ||
    normalizeText(itemRecord.href) ||
    normalizeText(itemRecord.link);
  if (url) {
    const matchedByUrl = sources.find((source) => source.locator?.url === url);
    if (matchedByUrl) {
      return matchedByUrl.id;
    }
  }

  const label = normalizeText(itemRecord.label) || normalizeText(itemRecord.title);
  if (label) {
    const matchedByLabel = sources.find((source) => source.label === label);
    if (matchedByLabel) {
      return matchedByLabel.id;
    }
  }

  const fallbackId = normalizeText(itemRecord.id);
  if (fallbackId) {
    return fallbackId;
  }

  return url || label;
}

function normalizeCitationItems(
  record: Record<string, unknown>,
  sources: ArtifactDocumentSource[],
): Array<{ sourceId: string; note?: string }> {
  if (!Array.isArray(record.items)) {
    return [];
  }

  return record.items
    .map((item) => {
      const itemRecord = asRecord(item);
      if (!itemRecord) {
        return null;
      }

      const sourceId = resolveCitationSourceId(itemRecord, sources);
      if (!sourceId) {
        return null;
      }

      return {
        sourceId,
        ...(normalizeText(itemRecord.note) ||
        normalizeText(itemRecord.summary) ||
        normalizeText(itemRecord.description)
          ? {
              note:
                normalizeText(itemRecord.note) ||
                normalizeText(itemRecord.summary) ||
                normalizeText(itemRecord.description),
            }
          : {}),
      };
    })
    .filter((item): item is { sourceId: string; note?: string } => item !== null);
}

function normalizeBlock(
  value: unknown,
  index: number,
  sources: ArtifactDocumentSource[],
): ArtifactDocumentBlock | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const type = normalizeText(record.type)?.toLowerCase() as
    | ArtifactDocumentBlockType
    | undefined;

  if (!type || !ARTIFACT_DOCUMENT_BLOCK_TYPES.has(type)) {
    return buildFallbackRichTextBlock(record, index);
  }

  const base = {
    ...record,
    id: normalizeText(record.id) || `block-${index + 1}`,
    type,
    sectionId:
      normalizeText(record.sectionId) || normalizeText(record.section_id),
    hidden: record.hidden === true,
    sourceIds:
      normalizeStringArray(record.sourceIds) ||
      normalizeStringArray(record.source_ids),
  };

  switch (type) {
    case "section_header": {
      const title = normalizeText(record.title);
      if (!title) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        title,
        ...(normalizeText(record.description)
          ? { description: normalizeText(record.description) }
          : {}),
      };
    }
    case "hero_summary": {
      const summary =
        normalizeText(record.summary) ||
        normalizeText(record.text) ||
        extractPortableText(record.content);
      if (!summary) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        summary,
        ...(normalizeText(record.eyebrow)
          ? { eyebrow: normalizeText(record.eyebrow) }
          : {}),
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
        ...(normalizeStringArray(record.highlights)
          ? { highlights: normalizeStringArray(record.highlights) }
          : {}),
      };
    }
    case "key_points": {
      const items = normalizeStringArray(record.items);
      if (!items || items.length === 0) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        items,
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
      };
    }
    case "rich_text": {
      const richText = resolveRichTextBlockContent(record);
      if (!richText) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        ...richText,
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
      };
    }
    case "callout": {
      const body =
        normalizeText(record.body) ||
        normalizeText(record.content) ||
        normalizeText(record.text) ||
        extractPortableText(record.content);
      if (!body && !normalizeText(record.title)) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        tone: normalizeCalloutTone(record.tone || record.variant),
        body: body || "",
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
        ...(body ? { content: body, text: body } : {}),
      };
    }
    case "table": {
      const columns = normalizeTableColumns(record);
      const rows = normalizeTableRows(record, columns);
      if (columns.length === 0 && rows.length === 0) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        columns,
        rows,
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
      };
    }
    case "checklist": {
      const items = normalizeChecklistItems(record);
      if (items.length === 0) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        items,
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
      };
    }
    case "metric_grid": {
      const metrics = normalizeMetricItems(record);
      if (metrics.length === 0) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        metrics,
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
      };
    }
    case "quote": {
      const text =
        normalizeText(record.text) ||
        normalizeText(record.quote) ||
        extractPortableText(record.content);
      if (!text) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        text,
        ...(normalizeText(record.attribution) ||
        normalizeText(record.author) ||
        normalizeText(record.source)
          ? {
              attribution:
                normalizeText(record.attribution) ||
                normalizeText(record.author) ||
                normalizeText(record.source),
            }
          : {}),
      };
    }
    case "citation_list": {
      const items = normalizeCitationItems(record, sources);
      if (items.length === 0) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        items,
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
      };
    }
    case "image": {
      const url =
        normalizeText(record.url) ||
        normalizeText(record.src) ||
        normalizeText(record.imageUrl);
      if (!url) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        url,
        ...(normalizeText(record.alt) ? { alt: normalizeText(record.alt) } : {}),
        ...(normalizeText(record.caption)
          ? { caption: normalizeText(record.caption) }
          : {}),
      };
    }
    case "code_block": {
      const code =
        normalizeText(record.code) ||
        normalizeText(record.content) ||
        extractPortableText(record.content);
      if (!code) {
        return buildFallbackRichTextBlock(record, index);
      }
      return {
        ...base,
        type,
        code,
        ...(normalizeText(record.language)
          ? { language: normalizeText(record.language) }
          : {}),
        ...(normalizeText(record.title) ? { title: normalizeText(record.title) } : {}),
      };
    }
    case "divider":
      return {
        ...base,
        type,
      };
    default:
      return buildFallbackRichTextBlock(record, index);
  }
}

function deriveSourceLinks(
  artifactId: string,
  blocks: ArtifactDocumentBlock[],
  sources: ArtifactDocumentSource[],
): ArtifactDocumentSourceLink[] {
  const sourceMap = new Map<string, ArtifactDocumentSource>();
  for (const source of sources) {
    sourceMap.set(source.id, source);
  }

  const links: ArtifactDocumentSourceLink[] = [];
  for (const block of blocks) {
    for (const sourceId of block.sourceIds || []) {
      const source = sourceMap.get(sourceId);
      if (!source) {
        continue;
      }

      links.push({
        artifactId,
        blockId: block.id,
        sourceId,
        sourceType: source.type,
        sourceRef:
          source.locator?.url ||
          source.locator?.path ||
          source.locator?.toolCallId ||
          source.locator?.messageId ||
          source.id,
        ...(source.label ? { label: source.label } : {}),
        ...(source.locator
          ? {
              locator:
                source.locator.url || source.locator.path
                  ? source.locator.url || source.locator.path
                  : source.locator,
            }
          : {}),
      });
    }
  }

  return links;
}

function normalizeMetadata(
  value: unknown,
  artifactId: string,
  blocks: ArtifactDocumentBlock[],
  sources: ArtifactDocumentSource[],
): ArtifactDocumentMeta {
  const record = asRecord(value) || {};
  const rawVersionHistory =
    record.versionHistory || record.version_history || record.artifactVersions;
  const versionHistory = Array.isArray(rawVersionHistory)
    ? rawVersionHistory
        .map((item, index) => normalizeVersionSummary(item, index, artifactId))
        .filter(
          (item): item is ArtifactDocumentVersionSummary => item !== null,
        )
        .sort((left, right) => right.versionNo - left.versionNo)
    : [];
  const rawSourceLinks =
    record.sourceLinks || record.source_links || record.artifactSourceLinks;
  const sourceLinks = Array.isArray(rawSourceLinks)
    ? rawSourceLinks
        .map((item, index) => normalizeSourceLink(item, index, artifactId))
        .filter((item): item is ArtifactDocumentSourceLink => item !== null)
    : deriveSourceLinks(artifactId, blocks, sources);
  const versionDiff = normalizeVersionDiff(
    record.currentVersionDiff || record.current_version_diff || record.artifactVersionDiff,
  );

  return {
    ...record,
    ...(normalizeText(record.theme) ? { theme: normalizeText(record.theme) } : {}),
    ...(normalizeText(record.audience)
      ? { audience: normalizeText(record.audience) }
      : {}),
    ...(normalizeText(record.intent) ? { intent: normalizeText(record.intent) } : {}),
    ...(normalizeText(record.generatedBy) || normalizeText(record.generated_by)
      ? {
          generatedBy: (normalizeText(record.generatedBy) ||
            normalizeText(record.generated_by)) as "agent" | "user" | "automation",
        }
      : {}),
    ...(normalizeText(record.currentVersionId) ||
    normalizeText(record.current_version_id)
      ? {
          currentVersionId:
            normalizeText(record.currentVersionId) ||
            normalizeText(record.current_version_id),
        }
      : {}),
    ...(normalizeNumber(record.currentVersionNo) ||
    normalizeNumber(record.current_version_no)
      ? {
          currentVersionNo:
            normalizeNumber(record.currentVersionNo) ||
            normalizeNumber(record.current_version_no),
        }
      : {}),
    ...(versionHistory.length > 0 ? { versionHistory } : {}),
    ...(sourceLinks.length > 0 ? { sourceLinks } : {}),
    ...(versionDiff ? { currentVersionDiff: versionDiff } : {}),
  };
}

export function parseArtifactDocumentValue(
  value: unknown,
): ArtifactDocumentV1 | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  if (record.schemaVersion !== ARTIFACT_DOCUMENT_SCHEMA_VERSION) {
    return null;
  }

  const title = normalizeText(record.title);
  if (!title) {
    return null;
  }

  const sourceValues = Array.isArray(record.sources) ? record.sources : [];
  const sources = sourceValues
    .map((source, index) => normalizeSource(source, index))
    .filter((source): source is ArtifactDocumentSource => Boolean(source));
  const blockValues = Array.isArray(record.blocks) ? record.blocks : [];
  const blocks = blockValues
    .map((block, index) => normalizeBlock(block, index, sources))
    .filter((block): block is ArtifactDocumentBlock => Boolean(block))
    .filter((block) => block.hidden !== true);

  if (blocks.length === 0) {
    return null;
  }
  const artifactId =
    normalizeText(record.artifactId) || `artifact-document:${slugify(title)}`;
  const metadata = normalizeMetadata(record.metadata, artifactId, blocks, sources);

  return {
    schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
    artifactId,
    workspaceId:
      normalizeText(record.workspaceId) || normalizeText(record.workspace_id),
    threadId: normalizeText(record.threadId) || normalizeText(record.thread_id),
    turnId: normalizeText(record.turnId) || normalizeText(record.turn_id),
    kind: normalizeArtifactKind(record.kind),
    title,
    status: normalizeArtifactStatus(record.status),
    language: normalizeText(record.language) || "zh-CN",
    summary: normalizeText(record.summary),
    blocks,
    sources,
    metadata: metadata as ArtifactDocumentMeta,
  };
}

export function parseArtifactDocumentString(
  raw: string,
): ArtifactDocumentV1 | null {
  const trimmed = stripOptionalJsonFence(raw);
  if (!trimmed) {
    return null;
  }

  try {
    return parseArtifactDocumentValue(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

export function hasArtifactDocumentMetadata(
  metadata?: Record<string, unknown>,
): boolean {
  if (!metadata) {
    return false;
  }

  const directSchema =
    normalizeText(metadata.artifactSchema) ||
    normalizeText(metadata.artifact_schema) ||
    normalizeText(metadata.schemaVersion);
  if (directSchema === ARTIFACT_DOCUMENT_SCHEMA_VERSION) {
    return true;
  }

  return Boolean(parseArtifactDocumentValue(metadata.artifactDocument));
}

export function resolveArtifactDocumentPayload(input: {
  content?: string;
  metadata?: Record<string, unknown>;
  previous?: ArtifactDocumentV1 | null;
}): ArtifactDocumentV1 | null {
  const fromContent =
    typeof input.content === "string"
      ? parseArtifactDocumentString(input.content)
      : null;
  if (fromContent) {
    return fromContent;
  }

  const fromMetadata = parseArtifactDocumentValue(input.metadata?.artifactDocument);
  if (fromMetadata) {
    return fromMetadata;
  }

  if (hasArtifactDocumentMetadata(input.metadata)) {
    return input.previous || null;
  }

  return input.previous || null;
}

function resolvePreviewFromBlocks(document: ArtifactDocumentV1): string | undefined {
  for (const block of document.blocks) {
    if (block.type === "hero_summary") {
      const summary = normalizeText(block.summary);
      if (summary) {
        return summary;
      }
    }

    if (block.type === "key_points") {
      const items = Array.isArray(block.items)
        ? block.items
            .map((item) =>
              typeof item === "string"
                ? item.trim()
                : normalizeText(asRecord(item)?.text) ||
                  normalizeText(asRecord(item)?.label),
            )
            .filter((item): item is string => Boolean(item))
        : [];
      if (items.length > 0) {
        return items.join("；");
      }
    }

    if (block.type === "rich_text") {
      const richText =
        normalizeText(block.markdown) ||
        normalizeText(block.text) ||
        normalizeText(block.content) ||
        extractPortableText(block.content) ||
        extractPortableText(block.tiptap) ||
        extractPortableText(block.proseMirror);
      if (richText) {
        return richText;
      }
    }
  }

  return undefined;
}

export function resolveArtifactDocumentPreviewText(
  document: ArtifactDocumentV1,
): string | undefined {
  return document.summary || resolvePreviewFromBlocks(document) || document.title;
}

export function resolveArtifactDocumentVersionHistory(
  document: ArtifactDocumentV1,
): ArtifactDocumentVersionSummary[] {
  return [...(document.metadata.versionHistory || [])].sort(
    (left, right) => right.versionNo - left.versionNo,
  );
}

export function resolveArtifactDocumentCurrentVersion(
  document: ArtifactDocumentV1,
): ArtifactDocumentVersionSummary | null {
  const versionHistory = resolveArtifactDocumentVersionHistory(document);
  const explicitId = normalizeText(document.metadata.currentVersionId);
  if (explicitId) {
    const matched = versionHistory.find((version) => version.id === explicitId);
    if (matched) {
      return matched;
    }
  }

  const explicitVersionNo = document.metadata.currentVersionNo;
  if (typeof explicitVersionNo === "number") {
    const matched = versionHistory.find(
      (version) => version.versionNo === explicitVersionNo,
    );
    if (matched) {
      return matched;
    }

    return {
      id: explicitId || `${document.artifactId}:v${explicitVersionNo}`,
      artifactId: document.artifactId,
      versionNo: explicitVersionNo,
      summary: document.summary,
      title: document.title,
      kind: document.kind,
      status: document.status,
      createdBy: document.metadata.generatedBy,
    };
  }

  return versionHistory[0] || null;
}

export function resolveArtifactDocumentCurrentVersionDiff(
  document: ArtifactDocumentV1,
): ArtifactDocumentVersionDiff | null {
  return document.metadata.currentVersionDiff || null;
}

export function resolveArtifactDocumentSourceLinks(
  document: ArtifactDocumentV1,
): ArtifactDocumentSourceLink[] {
  if ((document.metadata.sourceLinks || []).length > 0) {
    return document.metadata.sourceLinks || [];
  }

  return deriveSourceLinks(document.artifactId, document.blocks, document.sources);
}
