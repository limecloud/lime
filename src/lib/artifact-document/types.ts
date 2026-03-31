export const ARTIFACT_DOCUMENT_SCHEMA_VERSION = "artifact_document.v1";

export type ArtifactDocumentKind =
  | "report"
  | "roadmap"
  | "prd"
  | "brief"
  | "analysis"
  | "comparison"
  | "plan"
  | "table_report";

export type ArtifactDocumentStatus =
  | "draft"
  | "streaming"
  | "ready"
  | "failed"
  | "archived";

export type ArtifactDocumentBlockType =
  | "section_header"
  | "hero_summary"
  | "key_points"
  | "rich_text"
  | "callout"
  | "table"
  | "checklist"
  | "metric_grid"
  | "quote"
  | "citation_list"
  | "image"
  | "code_block"
  | "divider";

export type ArtifactDocumentSourceType =
  | "web"
  | "file"
  | "tool"
  | "message"
  | "search_result";

export type ArtifactDocumentSourceReliability =
  | "primary"
  | "secondary"
  | "derived";

export interface ArtifactDocumentSourceLocator {
  url?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  toolCallId?: string;
  messageId?: string;
  [key: string]: unknown;
}

export interface ArtifactDocumentSource {
  id: string;
  type: ArtifactDocumentSourceType;
  label: string;
  locator?: ArtifactDocumentSourceLocator;
  snippet?: string;
  reliability?: ArtifactDocumentSourceReliability;
  [key: string]: unknown;
}

export interface ArtifactDocumentVersionSummary {
  id: string;
  artifactId: string;
  versionNo: number;
  summary?: string;
  title?: string;
  kind?: ArtifactDocumentKind;
  status?: ArtifactDocumentStatus;
  createdBy?: "agent" | "user" | "automation";
  createdAt?: string;
  snapshotPath?: string;
  [key: string]: unknown;
}

export interface ArtifactDocumentSourceLink {
  artifactId: string;
  blockId: string;
  sourceId?: string;
  sourceType: string;
  sourceRef: string;
  label?: string;
  locator?: string | Record<string, unknown>;
  [key: string]: unknown;
}

export type ArtifactDocumentOperationName =
  | "artifact.create"
  | "artifact.set_meta"
  | "artifact.upsert_block"
  | "artifact.reorder_blocks"
  | "artifact.remove_block"
  | "artifact.attach_source"
  | "artifact.finalize_version"
  | "artifact.fail";

export interface ArtifactCreateOperation {
  op: "artifact.create";
  document?: Partial<ArtifactDocumentV1>;
  title?: string;
  kind?: ArtifactDocumentKind;
  status?: ArtifactDocumentStatus;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactSetMetaOperation {
  op: "artifact.set_meta";
  title?: string;
  kind?: ArtifactDocumentKind;
  status?: ArtifactDocumentStatus;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactUpsertBlockOperation {
  op: "artifact.upsert_block";
  block: ArtifactDocumentBlock;
  beforeBlockId?: string;
  afterBlockId?: string;
}

export interface ArtifactReorderBlocksOperation {
  op: "artifact.reorder_blocks";
  blockIds: string[];
}

export interface ArtifactRemoveBlockOperation {
  op: "artifact.remove_block";
  blockId: string;
}

export interface ArtifactAttachSourceOperation {
  op: "artifact.attach_source";
  blockId: string;
  source: ArtifactDocumentSource;
  sourceLink?: Partial<ArtifactDocumentSourceLink>;
}

export interface ArtifactFinalizeVersionOperation {
  op: "artifact.finalize_version";
  summary?: string;
  status?: ArtifactDocumentStatus;
}

export interface ArtifactFailOperation {
  op: "artifact.fail";
  reason: string;
}

export type ArtifactDocumentOperation =
  | ArtifactCreateOperation
  | ArtifactSetMetaOperation
  | ArtifactUpsertBlockOperation
  | ArtifactReorderBlocksOperation
  | ArtifactRemoveBlockOperation
  | ArtifactAttachSourceOperation
  | ArtifactFinalizeVersionOperation
  | ArtifactFailOperation;

export interface ArtifactOpsEnvelope {
  type: "artifact_ops";
  artifactId?: string;
  ops: ArtifactDocumentOperation[];
}

export interface ArtifactRewritePatchEnvelope {
  type: "artifact_rewrite_patch";
  artifactId: string;
  targetBlockId: string;
  block: ArtifactDocumentBlock;
  source?: ArtifactDocumentSource;
  sources?: ArtifactDocumentSource[];
  summary?: string;
  status?: ArtifactDocumentStatus;
}

export type ArtifactDocumentIncrementalEnvelopeType =
  | "artifact.begin"
  | "artifact.meta.patch"
  | "artifact.source.upsert"
  | "artifact.block.upsert"
  | "artifact.block.remove"
  | "artifact.complete"
  | "artifact.fail";

export interface ArtifactBeginEnvelope {
  type: "artifact.begin";
  artifactId: string;
  kind: ArtifactDocumentKind;
  title: string;
}

export interface ArtifactMetaPatchEnvelope {
  type: "artifact.meta.patch";
  artifactId: string;
  patch: Record<string, unknown>;
}

export interface ArtifactSourceUpsertEnvelope {
  type: "artifact.source.upsert";
  artifactId: string;
  source: ArtifactDocumentSource;
}

export interface ArtifactBlockUpsertEnvelope {
  type: "artifact.block.upsert";
  artifactId: string;
  block: ArtifactDocumentBlock;
}

export interface ArtifactBlockRemoveEnvelope {
  type: "artifact.block.remove";
  artifactId: string;
  blockId: string;
}

export interface ArtifactCompleteEnvelope {
  type: "artifact.complete";
  artifactId: string;
  summary?: string;
}

export interface ArtifactIncrementalFailEnvelope {
  type: "artifact.fail";
  artifactId: string;
  reason: string;
}

export type ArtifactDocumentIncrementalEnvelope =
  | ArtifactBeginEnvelope
  | ArtifactMetaPatchEnvelope
  | ArtifactSourceUpsertEnvelope
  | ArtifactBlockUpsertEnvelope
  | ArtifactBlockRemoveEnvelope
  | ArtifactCompleteEnvelope
  | ArtifactIncrementalFailEnvelope;

export type ArtifactOperationCandidateEnvelope =
  | ArtifactDocumentIncrementalEnvelope
  | ArtifactRewritePatchEnvelope
  | ArtifactOpsEnvelope;

export type ArtifactDocumentBlockChangeType =
  | "added"
  | "removed"
  | "updated"
  | "moved";

export interface ArtifactDocumentBlockDiffEntry {
  blockId: string;
  changeType: ArtifactDocumentBlockChangeType;
  beforeType?: ArtifactDocumentBlockType;
  afterType?: ArtifactDocumentBlockType;
  beforeIndex?: number;
  afterIndex?: number;
  beforeText?: string;
  afterText?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface ArtifactDocumentVersionDiff {
  baseVersionId?: string;
  baseVersionNo?: number;
  targetVersionId?: string;
  targetVersionNo?: number;
  addedCount?: number;
  removedCount?: number;
  updatedCount?: number;
  movedCount?: number;
  changedBlocks: ArtifactDocumentBlockDiffEntry[];
  [key: string]: unknown;
}

export interface ArtifactDocumentMeta {
  theme?: string;
  audience?: string;
  intent?: string;
  generatedBy?: "agent" | "user" | "automation";
  currentVersionId?: string;
  currentVersionNo?: number;
  versionHistory?: ArtifactDocumentVersionSummary[];
  sourceLinks?: ArtifactDocumentSourceLink[];
  currentVersionDiff?: ArtifactDocumentVersionDiff;
  rendererHints?: {
    density?: "comfortable" | "compact";
    defaultExpandedSections?: string[];
    [key: string]: unknown;
  };
  sourceRunBinding?: {
    threadId?: string;
    turnId?: string;
    itemIds?: string[];
    [key: string]: unknown;
  };
  exportHints?: {
    preferredFormats?: Array<"md" | "html" | "pdf" | "json">;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ArtifactDocumentBlockBase {
  id: string;
  type: ArtifactDocumentBlockType;
  sectionId?: string;
  hidden?: boolean;
  sourceIds?: string[];
  [key: string]: unknown;
}

export interface ArtifactSectionHeaderBlock extends ArtifactDocumentBlockBase {
  type: "section_header";
  title: string;
  description?: string;
}

export interface ArtifactHeroSummaryBlock extends ArtifactDocumentBlockBase {
  type: "hero_summary";
  eyebrow?: string;
  title?: string;
  summary: string;
  highlights?: string[];
}

export interface ArtifactKeyPointsBlock extends ArtifactDocumentBlockBase {
  type: "key_points";
  title?: string;
  items: string[];
}

export interface ArtifactRichTextBlock extends ArtifactDocumentBlockBase {
  type: "rich_text";
  contentFormat: "prosemirror_json" | "markdown";
  content: unknown;
  markdown?: string;
  text?: string;
  tiptap?: unknown;
  proseMirror?: unknown;
  originalType?: string;
}

export interface ArtifactCalloutBlock extends ArtifactDocumentBlockBase {
  type: "callout";
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  title?: string;
  body: string;
  content?: string;
  text?: string;
  variant?: string;
}

export interface ArtifactTableBlock extends ArtifactDocumentBlockBase {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface ArtifactChecklistItem {
  id: string;
  text: string;
  state: "todo" | "doing" | "done";
  [key: string]: unknown;
}

export interface ArtifactChecklistBlock extends ArtifactDocumentBlockBase {
  type: "checklist";
  title?: string;
  items: ArtifactChecklistItem[];
}

export interface ArtifactMetricGridItem {
  id: string;
  label: string;
  value: string;
  note?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  [key: string]: unknown;
}

export interface ArtifactMetricGridBlock extends ArtifactDocumentBlockBase {
  type: "metric_grid";
  title?: string;
  metrics: ArtifactMetricGridItem[];
}

export interface ArtifactQuoteBlock extends ArtifactDocumentBlockBase {
  type: "quote";
  text: string;
  attribution?: string;
  quote?: string;
  author?: string;
  source?: string;
}

export interface ArtifactCitationListItem {
  sourceId: string;
  note?: string;
  [key: string]: unknown;
}

export interface ArtifactCitationListBlock extends ArtifactDocumentBlockBase {
  type: "citation_list";
  title?: string;
  items: ArtifactCitationListItem[];
}

export interface ArtifactImageBlock extends ArtifactDocumentBlockBase {
  type: "image";
  url: string;
  alt?: string;
  caption?: string;
}

export interface ArtifactCodeBlock extends ArtifactDocumentBlockBase {
  type: "code_block";
  language?: string;
  title?: string;
  code: string;
}

export interface ArtifactDividerBlock extends ArtifactDocumentBlockBase {
  type: "divider";
}

export type ArtifactDocumentBlock =
  | ArtifactSectionHeaderBlock
  | ArtifactHeroSummaryBlock
  | ArtifactKeyPointsBlock
  | ArtifactRichTextBlock
  | ArtifactCalloutBlock
  | ArtifactTableBlock
  | ArtifactChecklistBlock
  | ArtifactMetricGridBlock
  | ArtifactQuoteBlock
  | ArtifactCitationListBlock
  | ArtifactImageBlock
  | ArtifactCodeBlock
  | ArtifactDividerBlock;

export interface ArtifactDocumentV1 {
  schemaVersion: typeof ARTIFACT_DOCUMENT_SCHEMA_VERSION;
  artifactId: string;
  workspaceId?: string;
  threadId?: string;
  turnId?: string;
  kind: ArtifactDocumentKind;
  title: string;
  status: ArtifactDocumentStatus;
  language: string;
  summary?: string;
  blocks: ArtifactDocumentBlock[];
  sources: ArtifactDocumentSource[];
  metadata: ArtifactDocumentMeta;
}
