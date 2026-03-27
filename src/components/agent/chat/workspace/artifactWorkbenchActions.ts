import {
  extractPortableText,
  resolveArtifactDocumentCurrentVersion,
  type ArtifactDocumentBlock,
  type ArtifactDocumentStatus,
  type ArtifactDocumentV1,
} from "@/lib/artifact-document";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";

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
  const items = Array.isArray(block.items) ? block.items : [];
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
    const title =
      normalizeText(record?.title) ||
      normalizeText(record?.label) ||
      normalizeText(record?.url) ||
      `来源 ${index + 1}`;
    const url =
      normalizeText(record?.url) ||
      normalizeText(record?.href) ||
      normalizeText(record?.link);
    const note =
      normalizeText(record?.note) ||
      normalizeText(record?.summary) ||
      normalizeText(record?.description);

    lines.push(`${index + 1}. ${url ? `[${title}](${url})` : title}`);
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
        normalizeText(block.quote) ||
        normalizeText(block.text) ||
        extractPortableText(block.content);
      const author = normalizeText(block.author) || normalizeText(block.source);
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
        normalizeText(source.title) ||
        normalizeText(source.url) ||
        `来源 ${index + 1}`;
      appendixLines.push(
        `${index + 1}. ${source.url ? `[${title}](${source.url})` : title}`,
      );
      if (normalizeText(source.note)) {
        appendixLines.push(`   - ${normalizeText(source.note)}`);
      }
      if (normalizeText(source.quote)) {
        appendixLines.push(`   - 摘录：${normalizeText(source.quote)}`);
      }
      if (normalizeText(source.publishedAt)) {
        appendixLines.push(`   - 时间：${normalizeText(source.publishedAt)}`);
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
