import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readNumberField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiMarkdownRenderSurface =
  | "assistant_final_text"
  | "tool_output"
  | "artifact_preview"
  | "unknown";

export type AgentUiMarkdownRenderFeature =
  | "heading"
  | "table"
  | "file_link"
  | "code_fence"
  | "cjk_wrap"
  | "mixed_width_wrap";

export type AgentUiMarkdownRenderIssueCode =
  | "missing_required_surface"
  | "common_renderer_owner_missing"
  | "missing_markdown_feature"
  | "page_text_only_snapshot"
  | "raw_markdown_only_snapshot"
  | "file_link_metadata_lost"
  | "rendered_block_type_missing"
  | "wrap_evidence_missing";

export interface AgentUiMarkdownRenderIssue {
  code: AgentUiMarkdownRenderIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMarkdownFileLinkSnapshot {
  path: string;
  line: number;
  column?: number;
  label?: string;
}

export interface AgentUiMarkdownSurfaceSnapshot {
  surface: AgentUiMarkdownRenderSurface;
  rendererOwner?: string;
  sourcePreview?: string;
  blockTypes: string[];
  fileLinks: AgentUiMarkdownFileLinkSnapshot[];
  sourceFeatures: AgentUiMarkdownRenderFeature[];
  renderedFeatures: AgentUiMarkdownRenderFeature[];
  hasRichBlocks: boolean;
  pageTextOnly: boolean;
  rawMarkdownOnly: boolean;
}

export interface AgentUiMarkdownRenderSnapshotInput {
  commonRendererOwner?: string;
  rendererOwner?: string;
  surfaces?: readonly unknown[];
  renderSurfaces?: readonly unknown[];
}

export interface AgentUiMarkdownRenderProjectionSnapshot {
  surfaces: AgentUiMarkdownSurfaceSnapshot[];
  rendererOwners: string[];
  requiredSurfacesCovered: boolean;
  commonRendererOwner: boolean;
  sourceFeaturesCovered: AgentUiMarkdownRenderFeature[];
  renderedFeaturesCovered: AgentUiMarkdownRenderFeature[];
  fileLinksPreserved: boolean;
  richSnapshotPresent: boolean;
  pageTextOnlyRejected: boolean;
  rawMarkdownOnlyRejected: boolean;
  validationIssues: AgentUiMarkdownRenderIssue[];
}

const REQUIRED_SURFACES: AgentUiMarkdownRenderSurface[] = [
  "assistant_final_text",
  "tool_output",
  "artifact_preview",
];

const REQUIRED_FEATURES: AgentUiMarkdownRenderFeature[] = [
  "heading",
  "table",
  "file_link",
  "code_fence",
  "cjk_wrap",
  "mixed_width_wrap",
];

function issue(
  code: AgentUiMarkdownRenderIssueCode,
  path: string,
  message: string,
): AgentUiMarkdownRenderIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqSorted<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values)).sort();
}

function normalizeSurface(
  value: string | undefined,
): AgentUiMarkdownRenderSurface {
  switch (value) {
    case "assistant_final_text":
    case "assistantFinalText":
    case "assistant":
    case "final_text":
    case "message":
      return "assistant_final_text";
    case "tool_output":
    case "toolOutput":
    case "tool":
      return "tool_output";
    case "artifact_preview":
    case "artifactPreview":
    case "artifact":
      return "artifact_preview";
    default:
      return "unknown";
  }
}

function blockType(value: unknown): string | undefined {
  const record = readRecord(value);
  const raw = readStringField(record, [
    "type",
    "kind",
    "blockType",
    "block_type",
  ]);
  if (!raw) return undefined;
  return raw
    .replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
    .replace(/[-\s]+/g, "_")
    .replace(/^markdown_/, "");
}

function renderedBlocks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = readRecord(value);
  if (!record) return [];
  const blocks = readArray(record.blocks);
  if (blocks.length > 0) return blocks;
  const renderedBlocksValue = readArray(record.renderedBlocks);
  if (renderedBlocksValue.length > 0) return renderedBlocksValue;
  return readArray(record.rendered_blocks);
}

function extractRenderedBlocks(record: Record<string, unknown>): unknown[] {
  const direct = renderedBlocks(record);
  const rendered =
    record.renderedSnapshot ??
    record.rendered_snapshot ??
    record.rendered ??
    record.snapshot;
  return [...direct, ...renderedBlocks(rendered)];
}

function hasCjk(value: string | undefined): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(value ?? "");
}

function hasAscii(value: string | undefined): boolean {
  return /[A-Za-z0-9]/.test(value ?? "");
}

function sourceFeatures(
  markdown: string | undefined,
): AgentUiMarkdownRenderFeature[] {
  const features: AgentUiMarkdownRenderFeature[] = [];
  if (!markdown) return features;
  if (/^#{1,6}\s+\S/m.test(markdown)) features.push("heading");
  if (/^\|.+\|\s*$/m.test(markdown) && /^\|[\s:|-]+\|\s*$/m.test(markdown)) {
    features.push("table");
  }
  if (/```[\s\S]*```/.test(markdown)) features.push("code_fence");
  if (/\[[^\]]+\]\([^)]+:\d+(?::\d+)?\)/.test(markdown)) {
    features.push("file_link");
  }
  if (hasCjk(markdown)) features.push("cjk_wrap");
  if (hasCjk(markdown) && hasAscii(markdown)) features.push("mixed_width_wrap");
  return uniqSorted(features);
}

function featureFromBlockType(
  type: string,
): AgentUiMarkdownRenderFeature | undefined {
  switch (type) {
    case "heading":
    case "title":
      return "heading";
    case "table":
      return "table";
    case "file_link":
    case "filelink":
    case "link_file":
      return "file_link";
    case "code":
    case "code_block":
    case "code_fence":
    case "fenced_code":
      return "code_fence";
    case "cjk_wrap":
      return "cjk_wrap";
    case "mixed_width_wrap":
      return "mixed_width_wrap";
    default:
      return undefined;
  }
}

function wrapRecord(value: unknown): Record<string, unknown> | undefined {
  return readRecord(value) ?? readRecord(readRecord(value)?.wrapEvidence);
}

function renderedFeatures(
  blocks: readonly unknown[],
  fileLinks: readonly AgentUiMarkdownFileLinkSnapshot[],
  surfaceRecord: Record<string, unknown>,
): AgentUiMarkdownRenderFeature[] {
  const features = blocks
    .map(blockType)
    .map((type) => (type ? featureFromBlockType(type) : undefined))
    .filter((entry): entry is AgentUiMarkdownRenderFeature => Boolean(entry));
  if (fileLinks.length > 0) features.push("file_link");
  const wrap =
    wrapRecord(surfaceRecord.wrapEvidence) ?? wrapRecord(surfaceRecord);
  if (
    readBooleanField(wrap, ["cjk", "cjkWrap", "cjk_wrap", "cjkWrapCovered"]) ===
    true
  ) {
    features.push("cjk_wrap");
  }
  if (
    readBooleanField(wrap, [
      "mixedWidth",
      "mixed_width",
      "mixedWidthWrap",
      "mixed_width_wrap",
      "mixedWidthWrapCovered",
    ]) === true
  ) {
    features.push("mixed_width_wrap");
  }
  return uniqSorted(features);
}

function fileLinkFromRecord(
  value: unknown,
): AgentUiMarkdownFileLinkSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const path = readStringField(record, [
    "path",
    "filePath",
    "file_path",
    "href",
  ]);
  const line = readNumberField(record, ["line", "lineNumber", "line_number"]);
  if (!path || line === undefined) return undefined;
  return compactProjectionFields({
    path,
    line,
    column: readNumberField(record, [
      "column",
      "columnNumber",
      "column_number",
    ]),
    label: readStringField(record, ["label", "text", "title"]),
  } satisfies AgentUiMarkdownFileLinkSnapshot);
}

function renderedFileLinks(
  record: Record<string, unknown>,
): AgentUiMarkdownFileLinkSnapshot[] {
  const rendered =
    readRecord(record.renderedSnapshot) ??
    readRecord(record.rendered_snapshot) ??
    readRecord(record.rendered) ??
    readRecord(record.snapshot);
  const values = [
    ...readArray(rendered?.fileLinks),
    ...readArray(rendered?.file_links),
    ...readArray(record.renderedFileLinks),
    ...readArray(record.rendered_file_links),
  ];
  return values
    .map(fileLinkFromRecord)
    .filter((entry): entry is AgentUiMarkdownFileLinkSnapshot =>
      Boolean(entry),
    );
}

function hasRawMarkdownOnly(
  source: readonly AgentUiMarkdownRenderFeature[],
  rendered: readonly AgentUiMarkdownRenderFeature[],
): boolean {
  return (
    (source.includes("table") && !rendered.includes("table")) ||
    (source.includes("code_fence") && !rendered.includes("code_fence"))
  );
}

function parseSurface(
  value: unknown,
  index: number,
  defaultOwner: string | undefined,
): AgentUiMarkdownSurfaceSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const surface = normalizeSurface(
    readStringField(record, ["surface", "kind", "target", "owner"]),
  );
  const source = readStringField(record, [
    "sourceMarkdown",
    "source_markdown",
    "markdown",
    "content",
    "text",
  ]);
  const blocks = extractRenderedBlocks(record);
  const fileLinks = renderedFileLinks(record);
  const sourceFeatureSet = sourceFeatures(source);
  const renderedFeatureSet = renderedFeatures(blocks, fileLinks, record);
  const pageText = readStringField(record, [
    "pageText",
    "page_text",
    "textContent",
    "text_content",
    "renderedText",
    "rendered_text",
  ]);
  const blockTypes = uniqSorted(
    blocks.map(blockType).filter((entry): entry is string => Boolean(entry)),
  );

  return compactProjectionFields({
    surface,
    rendererOwner:
      readStringField(record, [
        "rendererOwner",
        "renderer_owner",
        "renderer",
        "owner",
      ]) ?? defaultOwner,
    sourcePreview: truncateText(source, 160),
    blockTypes,
    fileLinks,
    sourceFeatures: sourceFeatureSet,
    renderedFeatures: renderedFeatureSet,
    hasRichBlocks: blocks.length > 0,
    pageTextOnly:
      Boolean(pageText) && blocks.length === 0 && fileLinks.length === 0,
    rawMarkdownOnly: hasRawMarkdownOnly(sourceFeatureSet, renderedFeatureSet),
  } satisfies AgentUiMarkdownSurfaceSnapshot);
}

function validateMarkdownSnapshot(
  snapshot: Omit<AgentUiMarkdownRenderProjectionSnapshot, "validationIssues">,
): AgentUiMarkdownRenderIssue[] {
  const issues: AgentUiMarkdownRenderIssue[] = [];
  const surfaceSet = new Set(
    snapshot.surfaces.map((surface) => surface.surface),
  );
  for (const surface of REQUIRED_SURFACES) {
    if (!surfaceSet.has(surface)) {
      issues.push(
        issue(
          "missing_required_surface",
          `$.surfaces.${surface}`,
          "Markdown renderer snapshots must cover assistant final text, tool output and artifact preview.",
        ),
      );
    }
  }
  if (!snapshot.commonRendererOwner) {
    issues.push(
      issue(
        "common_renderer_owner_missing",
        "$.rendererOwner",
        "All markdown surfaces must declare the same renderer owner.",
      ),
    );
  }
  for (const feature of REQUIRED_FEATURES) {
    if (!snapshot.sourceFeaturesCovered.includes(feature)) {
      issues.push(
        issue(
          "missing_markdown_feature",
          `$.features.${feature}`,
          "source-derived markdown snapshots must cover headings, tables, file links, code fences and CJK/mixed-width wrapping.",
        ),
      );
    }
    if (
      !snapshot.renderedFeaturesCovered.includes(feature) &&
      feature !== "cjk_wrap" &&
      feature !== "mixed_width_wrap"
    ) {
      issues.push(
        issue(
          "rendered_block_type_missing",
          `$.renderedFeatures.${feature}`,
          "Markdown source features must survive as structured rendered blocks.",
        ),
      );
    }
  }
  if (
    !snapshot.renderedFeaturesCovered.includes("cjk_wrap") ||
    !snapshot.renderedFeaturesCovered.includes("mixed_width_wrap")
  ) {
    issues.push(
      issue(
        "wrap_evidence_missing",
        "$.wrapEvidence",
        "CJK and mixed-width markdown cases need explicit wrap evidence, not plain text matching.",
      ),
    );
  }
  if (!snapshot.fileLinksPreserved) {
    issues.push(
      issue(
        "file_link_metadata_lost",
        "$.fileLinks",
        "Rendered markdown file links must preserve path and line metadata.",
      ),
    );
  }
  for (const [index, surface] of snapshot.surfaces.entries()) {
    if (surface.pageTextOnly) {
      issues.push(
        issue(
          "page_text_only_snapshot",
          `$.surfaces[${index}].pageText`,
          "pageText.includes cannot be the only markdown renderer oracle.",
        ),
      );
    }
    if (surface.rawMarkdownOnly) {
      issues.push(
        issue(
          "raw_markdown_only_snapshot",
          `$.surfaces[${index}].renderedSnapshot`,
          "Raw markdown table or fence text cannot replace rich renderer blocks.",
        ),
      );
    }
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiMarkdownRenderIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractMarkdownRenderProjectionSnapshot(
  input: AgentUiMarkdownRenderSnapshotInput,
): AgentUiMarkdownRenderProjectionSnapshot {
  const defaultOwner = definedString(
    input.commonRendererOwner ?? input.rendererOwner,
  );
  const surfaces = (input.renderSurfaces ?? input.surfaces ?? [])
    .map((entry, index) => parseSurface(entry, index, defaultOwner))
    .filter((entry): entry is AgentUiMarkdownSurfaceSnapshot => Boolean(entry));
  const rendererOwners = uniqSorted(
    surfaces
      .map((surface) => surface.rendererOwner)
      .filter((entry): entry is string => Boolean(entry)),
  );
  const sourceFeaturesCovered = uniqSorted(
    surfaces.flatMap((surface) => surface.sourceFeatures),
  );
  const renderedFeaturesCovered = uniqSorted(
    surfaces.flatMap((surface) => surface.renderedFeatures),
  );
  const fileLinks = surfaces.flatMap((surface) => surface.fileLinks);
  const partialSnapshot = {
    surfaces,
    rendererOwners,
    requiredSurfacesCovered: REQUIRED_SURFACES.every((surface) =>
      surfaces.some((entry) => entry.surface === surface),
    ),
    commonRendererOwner:
      rendererOwners.length === 1 && rendererOwners[0].length > 0,
    sourceFeaturesCovered,
    renderedFeaturesCovered,
    fileLinksPreserved: fileLinks.some((entry) => entry.path && entry.line > 0),
    richSnapshotPresent:
      surfaces.length > 0 && surfaces.every((surface) => surface.hasRichBlocks),
    pageTextOnlyRejected: !surfaces.some((surface) => surface.pageTextOnly),
    rawMarkdownOnlyRejected: !surfaces.some(
      (surface) => surface.rawMarkdownOnly,
    ),
  };

  return {
    ...partialSnapshot,
    validationIssues: validateMarkdownSnapshot(partialSnapshot),
  };
}

export function buildMarkdownRenderSnapshotProjectionEvent(
  input: AgentUiMarkdownRenderSnapshotInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractMarkdownRenderProjectionSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "markdown_render_snapshot_projection" },
      context,
    ),
    type: "state.snapshot",
    sequence: context.sequence,
    owner: "ui_projection",
    scope: "thread",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "completed",
    surface: "conversation",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      surfaces: snapshot.surfaces,
      rendererOwners: snapshot.rendererOwners,
      requiredSurfacesCovered: snapshot.requiredSurfacesCovered,
      commonRendererOwner: snapshot.commonRendererOwner,
      sourceFeaturesCovered: snapshot.sourceFeaturesCovered,
      renderedFeaturesCovered: snapshot.renderedFeaturesCovered,
      fileLinksPreserved: snapshot.fileLinksPreserved,
      richSnapshotPresent: snapshot.richSnapshotPresent,
      pageTextOnlyRejected: snapshot.pageTextOnlyRejected,
      rawMarkdownOnlyRejected: snapshot.rawMarkdownOnlyRejected,
      validationIssues: snapshot.validationIssues,
    },
    refs:
      snapshot.validationIssues.length > 0
        ? {
            diagnosticKeys: snapshot.validationIssues.map(
              (entry) => entry.code,
            ),
          }
        : {
            artifactPaths: snapshot.surfaces
              .flatMap((surface) => surface.fileLinks)
              .map((link) => link.path),
          },
  };
}
