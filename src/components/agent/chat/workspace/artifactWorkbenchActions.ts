import {
  extractPortableText,
  resolveArtifactDocumentCurrentVersion,
  resolveArtifactDocumentVersionHistory,
  type ArtifactDocumentBlock,
  type ArtifactDocumentBlockDiffEntry,
  type ArtifactDocumentVersionDiff,
  type ArtifactDocumentStatus,
  type ArtifactDocumentVersionSummary,
  type ArtifactDocumentV1,
} from "@/lib/artifact-document";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import { marked } from "marked";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .trim();

  return sanitized || "artifact";
}

function stripKnownArtifactExtensions(value: string): string {
  return value
    .replace(/\.artifact\.json$/i, "")
    .replace(/\.markdown$/i, "")
    .replace(/\.md$/i, "")
    .replace(/\.json$/i, "")
    .replace(/\.txt$/i, "");
}

function resolveExportBaseName(
  artifact: Artifact,
  document: ArtifactDocumentV1,
): string {
  const filePath = resolveArtifactProtocolFilePath(artifact);
  const filename =
    normalizeText(artifact.meta.filename) ||
    normalizeText(filePath.split(/[\\/]/).pop()) ||
    normalizeText(document.title) ||
    normalizeText(artifact.title) ||
    "artifact";

  return sanitizeFilename(stripKnownArtifactExtensions(filename));
}

function resolveChecklistItems(
  block: ArtifactDocumentBlock,
): Array<{ label: string; checked: boolean }> {
  const items = Array.isArray(block.items) ? block.items : [];

  return items
    .map((item) => {
      if (typeof item === "string") {
        const label = item.trim();
        return label ? { label, checked: false } : null;
      }

      const record = asRecord(item);
      const label =
        normalizeText(record?.label) ||
        normalizeText(record?.text) ||
        normalizeText(record?.title);
      if (!label) {
        return null;
      }

      return {
        label,
        checked:
          normalizeText(record?.state) === "done" ||
          Boolean(record?.checked) ||
          Boolean(record?.done) ||
          Boolean(record?.completed),
      };
    })
    .filter((item): item is { label: string; checked: boolean } =>
      Boolean(item),
    );
}

function resolveMetricItems(
  block: ArtifactDocumentBlock,
): Array<{ label: string; value: string; detail?: string }> {
  const items = Array.isArray(block.metrics)
    ? block.metrics
    : Array.isArray(block.items)
      ? block.items
      : [];
  const resolvedItems: Array<{
    label: string;
    value: string;
    detail?: string;
  }> = [];

  items.forEach((item) => {
    const record = asRecord(item);
    if (!record) {
      return;
    }

    const label =
      normalizeText(record.label) || normalizeText(record.title) || "指标";
    const value =
      normalizeText(record.value) ||
      normalizeText(record.metric) ||
      normalizeText(record.score);
    if (!value) {
      return;
    }

    resolvedItems.push({
      label,
      value,
      detail:
        normalizeText(record.note) ||
        normalizeText(record.detail) ||
        normalizeText(record.description) ||
        normalizeText(record.trend),
    });
  });

  return resolvedItems;
}

function resolveTableColumns(block: ArtifactDocumentBlock): string[] {
  if (Array.isArray(block.columns)) {
    return block.columns
      .map((column) =>
        typeof column === "string"
          ? column.trim()
          : normalizeText(asRecord(column)?.label) ||
            normalizeText(asRecord(column)?.title) ||
            "",
      )
      .filter(Boolean);
  }

  if (Array.isArray(block.headers)) {
    return block.headers
      .map((header) => (typeof header === "string" ? header.trim() : ""))
      .filter(Boolean);
  }

  return [];
}

function resolveTableRows(
  block: ArtifactDocumentBlock,
  columns: string[],
): string[][] {
  if (!Array.isArray(block.rows)) {
    return [];
  }

  return block.rows
    .map((row) => {
      if (Array.isArray(row)) {
        return row.map((cell) => normalizeText(cell) || "");
      }

      const record = asRecord(row);
      if (!record) {
        return null;
      }

      if (columns.length > 0) {
        return columns.map((column) => normalizeText(record[column]) || "");
      }

      return Object.values(record).map((value) => normalizeText(value) || "");
    })
    .filter((row): row is string[] => Boolean(row));
}

function resolveBlockText(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(
      block.contentFormat === "markdown" ? block.content : undefined,
    ) ||
    normalizeText(block.body) ||
    normalizeText(block.markdown) ||
    normalizeText(block.text) ||
    normalizeText(block.content) ||
    normalizeText(block.summary) ||
    extractPortableText(block.content) ||
    extractPortableText(block.tiptap) ||
    extractPortableText(block.proseMirror) ||
    ""
  );
}

function resolveChecklistPreview(block: ArtifactDocumentBlock): string {
  return resolveChecklistItems(block)
    .map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.label}`)
    .join("\n");
}

function resolveMetricPreview(block: ArtifactDocumentBlock): string {
  return resolveMetricItems(block)
    .map((item) => [item.label, item.value, item.detail].filter(Boolean).join(": "))
    .join("\n");
}

function resolveTablePreview(block: ArtifactDocumentBlock): string {
  const columns = resolveTableColumns(block);
  const rows = resolveTableRows(block, columns);
  return [
    columns.join(" | "),
    ...rows.map((row) => row.join(" | ")),
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveBlockPreviewText(block: ArtifactDocumentBlock): string {
  const textParts = [
    normalizeText(block.title),
    normalizeText(block.description),
    normalizeText(block.eyebrow),
    normalizeText(block.summary),
    resolveBlockText(block),
    normalizeStringArray(block.highlights).join("\n"),
    normalizeStringArray(block.items).join("\n"),
  ];

  if (block.type === "checklist") {
    textParts.push(resolveChecklistPreview(block));
  }

  if (block.type === "metric_grid") {
    textParts.push(resolveMetricPreview(block));
  }

  if (block.type === "table") {
    textParts.push(resolveTablePreview(block));
  }

  if (block.type === "code_block") {
    textParts.push(normalizeText(block.code));
  }

  if (block.type === "quote") {
    textParts.push(normalizeText(block.quote));
  }

  return textParts.filter(Boolean).join("\n").trim();
}

function serializeBlockForComparison(block: ArtifactDocumentBlock): string {
  return JSON.stringify(block);
}

function summarizeChangedBlock(
  changeType: ArtifactDocumentBlockDiffEntry["changeType"],
  blockId: string,
): string {
  switch (changeType) {
    case "added":
      return `新增 ${blockId}`;
    case "removed":
      return `删除 ${blockId}`;
    case "moved":
      return `移动 ${blockId}`;
    case "updated":
    default:
      return `更新 ${blockId}`;
  }
}

export function buildArtifactDocumentVersionDiff(
  previousDocument: ArtifactDocumentV1,
  nextDocument: ArtifactDocumentV1,
): ArtifactDocumentVersionDiff {
  const previousBlocks = previousDocument.blocks || [];
  const nextBlocks = nextDocument.blocks || [];
  const previousMap = new Map(previousBlocks.map((block, index) => [block.id, { block, index }]));
  const nextMap = new Map(nextBlocks.map((block, index) => [block.id, { block, index }]));
  const changedBlocks: ArtifactDocumentBlockDiffEntry[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let updatedCount = 0;
  let movedCount = 0;

  nextBlocks.forEach((block, nextIndex) => {
    const previousEntry = previousMap.get(block.id);
    if (!previousEntry) {
      addedCount += 1;
      changedBlocks.push({
        blockId: block.id,
        changeType: "added",
        afterType: block.type,
        afterIndex: nextIndex,
        afterText: resolveBlockPreviewText(block),
        summary: summarizeChangedBlock("added", block.id),
      });
      return;
    }

    const previousBlock = previousEntry.block;
    const previousIndex = previousEntry.index;
    const isMoved = previousIndex !== nextIndex;
    const isUpdated =
      serializeBlockForComparison(previousBlock) !== serializeBlockForComparison(block);

    if (!isMoved && !isUpdated) {
      return;
    }

    const changeType = isUpdated ? "updated" : "moved";
    if (changeType === "updated") {
      updatedCount += 1;
    } else {
      movedCount += 1;
    }

    changedBlocks.push({
      blockId: block.id,
      changeType,
      beforeType: previousBlock.type,
      afterType: block.type,
      beforeIndex: previousIndex,
      afterIndex: nextIndex,
      beforeText: resolveBlockPreviewText(previousBlock),
      afterText: resolveBlockPreviewText(block),
      summary: summarizeChangedBlock(changeType, block.id),
    });
  });

  previousBlocks.forEach((block, previousIndex) => {
    if (nextMap.has(block.id)) {
      return;
    }

    removedCount += 1;
    changedBlocks.push({
      blockId: block.id,
      changeType: "removed",
      beforeType: block.type,
      beforeIndex: previousIndex,
      beforeText: resolveBlockPreviewText(block),
      summary: summarizeChangedBlock("removed", block.id),
    });
  });

  return {
    changedBlocks,
    ...(addedCount > 0 ? { addedCount } : {}),
    ...(removedCount > 0 ? { removedCount } : {}),
    ...(updatedCount > 0 ? { updatedCount } : {}),
    ...(movedCount > 0 ? { movedCount } : {}),
  };
}

function resolveNextVersionNo(document: ArtifactDocumentV1): number {
  const versionHistory = resolveArtifactDocumentVersionHistory(document);
  const maxVersionNo = versionHistory.reduce(
    (max, version) => Math.max(max, version.versionNo || 0),
    0,
  );
  const currentVersionNo =
    resolveArtifactDocumentCurrentVersion(document)?.versionNo ||
    document.metadata.currentVersionNo ||
    0;

  return Math.max(maxVersionNo, currentVersionNo) + 1;
}

function resolveVersionSummaryText(
  diff: ArtifactDocumentVersionDiff,
  explicitSummary?: string,
): string | undefined {
  if (normalizeText(explicitSummary)) {
    return normalizeText(explicitSummary);
  }

  if (diff.changedBlocks.length === 1) {
    return diff.changedBlocks[0]?.summary;
  }

  if (diff.changedBlocks.length > 1) {
    return `更新 ${diff.changedBlocks.length} 个 block`;
  }

  return undefined;
}

export function createArtifactDocumentNextVersion(
  previousDocument: ArtifactDocumentV1,
  nextDocument: ArtifactDocumentV1,
  options: {
    summary?: string;
    createdBy?: ArtifactDocumentVersionSummary["createdBy"];
  } = {},
): ArtifactDocumentV1 {
  const diff = buildArtifactDocumentVersionDiff(previousDocument, nextDocument);
  if (diff.changedBlocks.length === 0) {
    return nextDocument;
  }

  const currentVersion = resolveArtifactDocumentCurrentVersion(previousDocument);
  const nextVersionNo = resolveNextVersionNo(previousDocument);
  const nextVersionId = `${nextDocument.artifactId}:v${nextVersionNo}`;
  const createdAt = new Date().toISOString();
  const nextVersionSummary: ArtifactDocumentVersionSummary = {
    id: nextVersionId,
    artifactId: nextDocument.artifactId,
    versionNo: nextVersionNo,
    title: nextDocument.title,
    summary: resolveVersionSummaryText(diff, options.summary),
    kind: nextDocument.kind,
    status: nextDocument.status,
    createdBy: options.createdBy || "user",
    createdAt,
  };
  const nextVersionHistory = [
    ...resolveArtifactDocumentVersionHistory(previousDocument).filter(
      (version) => version.id !== nextVersionId,
    ),
    nextVersionSummary,
  ];

  return {
    ...nextDocument,
    metadata: {
      ...nextDocument.metadata,
      currentVersionId: nextVersionId,
      currentVersionNo: nextVersionNo,
      currentVersionDiff: {
        ...diff,
        ...(currentVersion?.id ? { baseVersionId: currentVersion.id } : {}),
        ...(currentVersion?.versionNo
          ? { baseVersionNo: currentVersion.versionNo }
          : {}),
        targetVersionId: nextVersionId,
        targetVersionNo: nextVersionNo,
      },
      versionHistory: nextVersionHistory,
    },
  };
}

function renderTableMarkdown(block: ArtifactDocumentBlock): string | null {
  const columns = resolveTableColumns(block);
  const rows = resolveTableRows(block, columns);
  if (columns.length === 0 && rows.length === 0) {
    return null;
  }

  const headings =
    columns.length > 0
      ? columns
      : rows[0]?.map((_, index) => `列 ${index + 1}`) || [];
  const bodyRows = rows;
  const lines: string[] = [];

  if (normalizeText(block.title)) {
    lines.push(`### ${normalizeText(block.title)}`);
    lines.push("");
  }

  lines.push(`| ${headings.join(" | ")} |`);
  lines.push(`| ${headings.map(() => "---").join(" | ")} |`);
  bodyRows.forEach((row) => {
    const paddedRow = headings.map((_, index) => row[index] || "");
    lines.push(`| ${paddedRow.join(" | ")} |`);
  });

  return lines.join("\n");
}

function renderCitationListMarkdown(
  block: ArtifactDocumentBlock,
): string | null {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) {
    return null;
  }

  const lines: string[] = [];
  if (normalizeText(block.title)) {
    lines.push(`### ${normalizeText(block.title)}`);
    lines.push("");
  }

  items.forEach((item, index) => {
    const record = asRecord(item);
    const title = normalizeText(record?.sourceId) || `来源 ${index + 1}`;
    const note =
      normalizeText(record?.note) ||
      normalizeText(record?.summary) ||
      normalizeText(record?.description);

    lines.push(`${index + 1}. ${title}`);
    if (note) {
      lines.push(`   - ${note}`);
    }
  });

  return lines.join("\n");
}

function renderBlockMarkdown(block: ArtifactDocumentBlock): string | null {
  switch (block.type) {
    case "section_header": {
      const title = normalizeText(block.title) || "未命名章节";
      const description = normalizeText(block.description);
      return [title ? `## ${title}` : null, description || null]
        .filter(Boolean)
        .join("\n\n");
    }
    case "hero_summary": {
      const eyebrow = normalizeText(block.eyebrow);
      const title = normalizeText(block.title);
      const summary = normalizeText(block.summary);
      const highlights = normalizeStringArray(block.highlights);
      const lines: string[] = [];

      if (eyebrow) {
        lines.push(`> ${eyebrow}`);
        lines.push("");
      }
      if (title) {
        lines.push(`## ${title}`);
      }
      if (summary) {
        if (lines.length > 0) {
          lines.push("");
        }
        lines.push(summary);
      }
      if (highlights.length > 0) {
        if (lines.length > 0) {
          lines.push("");
        }
        highlights.forEach((item) => lines.push(`- ${item}`));
      }

      return lines.join("\n");
    }
    case "key_points": {
      const items = normalizeStringArray(block.items);
      if (items.length === 0) {
        return null;
      }
      const title = normalizeText(block.title);
      return [
        title ? `### ${title}` : null,
        title ? "" : null,
        ...items.map((item) => `- ${item}`),
      ]
        .filter((item): item is string => item !== null)
        .join("\n");
    }
    case "rich_text": {
      const content = resolveBlockText(block);
      return content || null;
    }
    case "callout": {
      const title = normalizeText(block.title);
      const content = resolveBlockText(block);
      const lines = [title ? `**${title}**` : null, content || null].filter(
        Boolean,
      ) as string[];
      if (lines.length === 0) {
        return null;
      }
      return lines
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "table":
      return renderTableMarkdown(block);
    case "checklist": {
      const items = resolveChecklistItems(block);
      if (items.length === 0) {
        return null;
      }
      const title = normalizeText(block.title);
      return [
        title ? `### ${title}` : null,
        title ? "" : null,
        ...items.map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`),
      ]
        .filter((item): item is string => item !== null)
        .join("\n");
    }
    case "metric_grid": {
      const items = resolveMetricItems(block);
      if (items.length === 0) {
        return null;
      }
      const title = normalizeText(block.title);
      return [
        title ? `### ${title}` : null,
        title ? "" : null,
        ...items.map((item) =>
          item.detail
            ? `- **${item.label}**：${item.value}（${item.detail}）`
            : `- **${item.label}**：${item.value}`,
        ),
      ]
        .filter((item): item is string => item !== null)
        .join("\n");
    }
    case "quote": {
      const quote =
        normalizeText(block.text) ||
        normalizeText(block.quote) ||
        extractPortableText(block.content);
      const author =
        normalizeText(block.attribution) ||
        normalizeText(block.author) ||
        normalizeText(block.source);
      if (!quote) {
        return null;
      }

      return [
        ...quote.split("\n").map((line) => `> ${line}`),
        ...(author ? [">", `> — ${author}`] : []),
      ].join("\n");
    }
    case "citation_list":
      return renderCitationListMarkdown(block);
    case "image": {
      const src =
        normalizeText(block.url) ||
        normalizeText(block.src) ||
        normalizeText(block.imageUrl);
      if (!src) {
        return null;
      }

      const title = normalizeText(block.title);
      const alt =
        normalizeText(block.alt) ||
        normalizeText(block.caption) ||
        title ||
        "artifact image";
      const caption = normalizeText(block.caption);
      return [
        title ? `### ${title}` : null,
        title ? "" : null,
        `![${alt}](${src})`,
        caption ? "" : null,
        caption ? `_${caption}_` : null,
      ]
        .filter((item): item is string => item !== null)
        .join("\n");
    }
    case "code_block": {
      const code =
        normalizeText(block.code) ||
        normalizeText(block.content) ||
        extractPortableText(block.content);
      if (!code) {
        return null;
      }

      const title = normalizeText(block.title);
      const language = normalizeText(block.language) || "";
      return [
        title ? `### ${title}` : null,
        title ? "" : null,
        `\`\`\`${language}`,
        code,
        "```",
      ]
        .filter((item): item is string => item !== null)
        .join("\n");
    }
    case "divider":
      return "---";
    default:
      return resolveBlockText(block) || null;
  }
}

export function resolveArtifactWorkbenchJsonFilename(
  artifact: Artifact,
  document: ArtifactDocumentV1,
): string {
  return `${resolveExportBaseName(artifact, document)}.artifact.json`;
}

export function resolveArtifactWorkbenchMarkdownFilename(
  artifact: Artifact,
  document: ArtifactDocumentV1,
): string {
  return `${resolveExportBaseName(artifact, document)}.md`;
}

export function resolveArtifactWorkbenchHtmlFilename(
  artifact: Artifact,
  document: ArtifactDocumentV1,
): string {
  return `${resolveExportBaseName(artifact, document)}.html`;
}

export function serializeArtifactDocumentToMarkdown(
  document: ArtifactDocumentV1,
): string {
  const sections: string[] = [`# ${document.title}`];

  if (normalizeText(document.summary)) {
    sections.push(normalizeText(document.summary)!);
  }

  document.blocks.forEach((block) => {
    const nextSection = renderBlockMarkdown(block);
    if (nextSection) {
      sections.push(nextSection);
    }
  });

  if (document.sources.length > 0) {
    const appendixLines = ["## 来源"];
    document.sources.forEach((source, index) => {
      const title =
        normalizeText(source.label) ||
        normalizeText(source.locator?.url) ||
        normalizeText(source.locator?.path) ||
        `来源 ${index + 1}`;
      const linkTarget = normalizeText(source.locator?.url);
      appendixLines.push(
        `${index + 1}. ${linkTarget ? `[${title}](${linkTarget})` : title}`,
      );
      if (normalizeText(source.snippet)) {
        appendixLines.push(`   - ${normalizeText(source.snippet)}`);
      }
      if (normalizeText(source.locator?.path)) {
        appendixLines.push(`   - 路径：${normalizeText(source.locator?.path)}`);
      }
    });
    sections.push(appendixLines.join("\n"));
  }

  return sections
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function serializeArtifactDocumentToHtml(
  document: ArtifactDocumentV1,
): string {
  const markdown = serializeArtifactDocumentToMarkdown(document);
  const bodyHtml = (
    marked.parse(markdown, {
      async: false,
      breaks: true,
    }) as string
  ).trim();
  const escapedTitle = escapeHtml(document.title);
  const escapedLanguage = escapeHtml(document.language || "zh-CN");
  const escapedSummary = normalizeText(document.summary)
    ? escapeHtml(normalizeText(document.summary)!)
    : "";

  return [
    "<!doctype html>",
    `<html lang="${escapedLanguage}">`,
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapedTitle}</title>`,
    escapedSummary
      ? `  <meta name="description" content="${escapedSummary}" />`
      : null,
    "  <style>",
    "    :root {",
    "      color-scheme: light;",
    "      --artifact-bg: #f4efe6;",
    "      --artifact-paper: #fffdf8;",
    "      --artifact-ink: #1f2937;",
    "      --artifact-muted: #5b6472;",
    "      --artifact-line: #e7dcc9;",
    "      --artifact-accent: #a94f2d;",
    "      --artifact-callout: #fff4e2;",
    "      --artifact-code: #f4f0e8;",
    "    }",
    "    * { box-sizing: border-box; }",
    "    html, body { margin: 0; padding: 0; }",
    "    body {",
    '      font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;',
    "      background:",
    "        radial-gradient(circle at top, rgba(169, 79, 45, 0.12), transparent 32%),",
    "        linear-gradient(180deg, #f6f1e8 0%, var(--artifact-bg) 100%);",
    "      color: var(--artifact-ink);",
    "      line-height: 1.75;",
    "      padding: 40px 20px 64px;",
    "    }",
    "    main {",
    "      max-width: 860px;",
    "      margin: 0 auto;",
    "      background: var(--artifact-paper);",
    "      border: 1px solid rgba(169, 79, 45, 0.12);",
    "      border-radius: 28px;",
    "      box-shadow: 0 24px 80px rgba(60, 41, 24, 0.08);",
    "      padding: 48px 56px;",
    "    }",
    "    h1, h2, h3, h4, h5, h6 {",
    '      font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif;',
    "      line-height: 1.25;",
    "      color: #171717;",
    "      margin: 1.6em 0 0.72em;",
    "    }",
    "    h1 { font-size: 2.4rem; margin-top: 0; }",
    "    h2 { font-size: 1.7rem; padding-bottom: 0.28em; border-bottom: 1px solid var(--artifact-line); }",
    "    h3 { font-size: 1.24rem; }",
    "    p, ul, ol, blockquote, table, pre { margin: 1em 0; }",
    "    ul, ol { padding-left: 1.4rem; }",
    "    li + li { margin-top: 0.4rem; }",
    "    a { color: var(--artifact-accent); }",
    "    blockquote {",
    "      margin-inline: 0;",
    "      padding: 1rem 1.1rem;",
    "      border-left: 4px solid rgba(169, 79, 45, 0.35);",
    "      background: var(--artifact-callout);",
    "      color: var(--artifact-muted);",
    "      border-radius: 0 18px 18px 0;",
    "    }",
    "    table {",
    "      width: 100%;",
    "      border-collapse: collapse;",
    "      font-size: 0.96rem;",
    "      overflow: hidden;",
    "      border-radius: 18px;",
    "      border: 1px solid var(--artifact-line);",
    "    }",
    "    thead { background: #f1e8d9; }",
    "    th, td {",
    "      padding: 0.85rem 0.95rem;",
    "      border-bottom: 1px solid var(--artifact-line);",
    "      text-align: left;",
    "      vertical-align: top;",
    "    }",
    "    tr:last-child td { border-bottom: none; }",
    "    code {",
    '      font-family: "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", monospace;',
    "      background: var(--artifact-code);",
    "      padding: 0.16rem 0.4rem;",
    "      border-radius: 8px;",
    "      font-size: 0.92em;",
    "    }",
    "    pre {",
    "      background: #1f2937;",
    "      color: #f9fafb;",
    "      padding: 1rem 1.1rem;",
    "      border-radius: 18px;",
    "      overflow-x: auto;",
    "    }",
    "    pre code { background: transparent; color: inherit; padding: 0; }",
    "    hr { border: none; border-top: 1px solid var(--artifact-line); margin: 2rem 0; }",
    "    img { max-width: 100%; border-radius: 18px; }",
    "    @media (max-width: 720px) {",
    "      body { padding: 20px 12px 32px; }",
    "      main { padding: 28px 20px; border-radius: 22px; }",
    "      h1 { font-size: 1.9rem; }",
    "      h2 { font-size: 1.45rem; }",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    `    ${bodyHtml}`,
    "  </main>",
    "</body>",
    "</html>",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function updateArtifactDocumentStatus(
  document: ArtifactDocumentV1,
  status: ArtifactDocumentStatus,
): ArtifactDocumentV1 {
  const currentVersion = resolveArtifactDocumentCurrentVersion(document);
  const nextVersionHistory = Array.isArray(document.metadata.versionHistory)
    ? document.metadata.versionHistory.map((version) => {
        if (!currentVersion) {
          return version;
        }

        const matchesCurrentVersion =
          version.id === currentVersion.id ||
          version.versionNo === currentVersion.versionNo;
        if (!matchesCurrentVersion) {
          return version;
        }

        return {
          ...version,
          status,
        };
      })
    : document.metadata.versionHistory;

  return {
    ...document,
    status,
    metadata: {
      ...document.metadata,
      ...(nextVersionHistory ? { versionHistory: nextVersionHistory } : {}),
    },
  };
}
