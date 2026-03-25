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

function normalizeSource(
  value: unknown,
  index: number,
): ArtifactDocumentSource | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = normalizeText(record.id) || `source-${index + 1}`;
  const title = normalizeText(record.title);
  const url =
    normalizeText(record.url) ||
    normalizeText(record.href) ||
    normalizeText(record.link);
  const note =
    normalizeText(record.note) ||
    normalizeText(record.summary) ||
    normalizeText(record.description);
  const kind = normalizeText(record.kind);
  const quote = normalizeText(record.quote);
  const publishedAt =
    normalizeText(record.publishedAt) || normalizeText(record.published_at);

  if (!title && !url && !note && !quote) {
    return null;
  }

  return {
    ...record,
    id,
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(note ? { note } : {}),
    ...(kind ? { kind } : {}),
    ...(quote ? { quote } : {}),
    ...(publishedAt ? { publishedAt } : {}),
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
    text: content,
    originalType: normalizeText(block.type) || "unknown",
  };
}

function normalizeBlock(value: unknown, index: number): ArtifactDocumentBlock | null {
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

  return {
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
}

function inferSourceType(source: ArtifactDocumentSource): string {
  const kind = normalizeText(source.kind)?.toLowerCase();
  if (kind) {
    return kind;
  }

  const url = normalizeText(source.url)?.toLowerCase();
  if (url?.startsWith("http://") || url?.startsWith("https://")) {
    return "web";
  }
  if (url?.startsWith("file://")) {
    return "file";
  }

  return "unknown";
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
        sourceType: inferSourceType(source),
        sourceRef: source.url || source.id,
        ...(source.title ? { label: source.title } : {}),
        ...(source.url ? { locator: source.url } : {}),
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

  const blockValues = Array.isArray(record.blocks) ? record.blocks : [];
  const blocks = blockValues
    .map((block, index) => normalizeBlock(block, index))
    .filter((block): block is ArtifactDocumentBlock => Boolean(block))
    .filter((block) => block.hidden !== true);

  if (blocks.length === 0) {
    return null;
  }

  const sourceValues = Array.isArray(record.sources) ? record.sources : [];
  const sources = sourceValues
    .map((source, index) => normalizeSource(source, index))
    .filter((source): source is ArtifactDocumentSource => Boolean(source));
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
