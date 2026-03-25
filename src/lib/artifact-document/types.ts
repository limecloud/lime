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

export interface ArtifactDocumentSource {
  id: string;
  title?: string;
  url?: string;
  note?: string;
  kind?: string;
  quote?: string;
  publishedAt?: string;
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

export type ArtifactDocumentBlock = ArtifactDocumentBlockBase;

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
