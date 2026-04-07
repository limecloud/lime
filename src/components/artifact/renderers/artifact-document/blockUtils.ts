import {
  extractPortableText,
  type ArtifactDocumentBlock,
} from "@/lib/artifact-document";

export type ArtifactDocumentTone = "dark" | "light";

export interface ResolvedChecklistItem {
  label: string;
  checked: boolean;
}

export interface ResolvedMetricItem {
  label: string;
  value: string;
  detail: string | undefined;
}

export function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

export function resolveRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function resolveBlockRichText(block: ArtifactDocumentBlock): string {
  return resolvePortableRichText(block);
}

export function resolvePortableRichText(value: unknown): string {
  const record = resolveRecord(value);

  return (
    normalizeText(
      record?.contentFormat === "markdown" ? record.content : undefined,
    ) ||
    normalizeText(record?.markdown) ||
    normalizeText(record?.text) ||
    normalizeText(record?.content) ||
    extractPortableText(record?.content) ||
    extractPortableText(record?.tiptap) ||
    extractPortableText(record?.proseMirror) ||
    ""
  );
}

export function resolveTableColumns(block: ArtifactDocumentBlock): string[] {
  if (!Array.isArray(block.columns)) {
    return [];
  }

  return block.columns
    .map((column) => {
      if (typeof column === "string") {
        return column.trim();
      }

      const record = resolveRecord(column);

      return (
        normalizeText(record?.label) ||
        normalizeText(record?.title) ||
        normalizeText(record?.key) ||
        ""
      );
    })
    .filter(Boolean);
}

export function resolveTableRows(
  block: ArtifactDocumentBlock,
  columns: string[],
): string[][] {
  if (!Array.isArray(block.rows)) {
    return [];
  }

  return block.rows
    .map((row) => {
      if (Array.isArray(row)) {
        return row.map((cell) => normalizeText(cell) || String(cell ?? ""));
      }

      const record = resolveRecord(row);
      if (!record) {
        return [];
      }

      if (Array.isArray(record.cells)) {
        return record.cells.map(
          (cell) => normalizeText(cell) || String(cell ?? ""),
        );
      }

      if (Array.isArray(record.values)) {
        return record.values.map(
          (cell) => normalizeText(cell) || String(cell ?? ""),
        );
      }

      if (columns.length > 0) {
        return columns.map((column) => normalizeText(record[column]) || "");
      }

      return Object.values(record).map(
        (cell) => normalizeText(cell) || String(cell ?? ""),
      );
    })
    .filter((row) => row.some((cell) => cell.trim().length > 0));
}

export function resolveChecklistItems(
  block: ArtifactDocumentBlock,
): ResolvedChecklistItem[] {
  if (!Array.isArray(block.items)) {
    return [];
  }

  return block.items
    .map((item) => {
      if (typeof item === "string") {
        return { label: item.trim(), checked: false };
      }

      const record = resolveRecord(item);
      const label =
        normalizeText(record?.label) ||
        normalizeText(record?.text) ||
        normalizeText(record?.content);
      if (!label) {
        return null;
      }

      return {
        label,
        checked:
          normalizeText(record?.state) === "done" ||
          record?.checked === true ||
          record?.done === true,
      };
    })
    .filter((item): item is ResolvedChecklistItem => item !== null);
}

export function resolveMetricItems(
  block: ArtifactDocumentBlock,
): ResolvedMetricItem[] {
  const items = Array.isArray(block.metrics)
    ? block.metrics
    : Array.isArray(block.items)
      ? block.items
      : [];

  return items
    .map((item) => {
      const record = resolveRecord(item);
      if (!record) {
        return null;
      }

      const label =
        normalizeText(record.label) ||
        normalizeText(record.title) ||
        normalizeText(record.name);
      const value =
        normalizeText(record.value) ||
        normalizeText(record.metric) ||
        normalizeText(record.summary);
      if (!label || !value) {
        return null;
      }

      return {
        label,
        value,
        detail:
          normalizeText(record.note) ||
          normalizeText(record.detail) ||
          normalizeText(record.description) ||
          normalizeText(record.trend),
      };
    })
    .filter((item): item is ResolvedMetricItem => item !== null);
}

function escapeMarkdownCell(value: string): string {
  return value.split("|").join("\\|").split("\n").join("<br />");
}

function joinMarkdownSections(parts: Array<string | undefined>): string | null {
  const content = parts.filter(Boolean).join("\n\n").trim();
  return content ? content : null;
}

function buildMarkdownTable(
  columns: string[],
  rows: string[][],
): string | null {
  if (columns.length === 0 && rows.length === 0) {
    return null;
  }

  if (columns.length === 0) {
    const listRows = rows
      .map((row, index) => {
        const content = row.join(" | ").trim();
        return content ? `${index + 1}. ${content}` : null;
      })
      .filter((row): row is string => Boolean(row));

    return listRows.length > 0 ? listRows.join("\n") : null;
  }

  const header = `| ${columns.map(escapeMarkdownCell).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const normalizedRow = columns.map((_, index) =>
      escapeMarkdownCell(row[index] || ""),
    );
    return `| ${normalizedRow.join(" | ")} |`;
  });

  return [header, separator, ...body].join("\n");
}

export function resolveFallbackRichText(
  block: ArtifactDocumentBlock,
): string | null {
  const record = resolveRecord(block);
  const directContent = resolvePortableRichText(block) || undefined;

  switch (block.type) {
    case "section_header":
      return joinMarkdownSections([
        normalizeText(block.title)
          ? `## ${normalizeText(block.title)}`
          : undefined,
        normalizeText(block.description),
        directContent,
      ]);
    case "hero_summary": {
      const highlights = normalizeStringArray(block.highlights);
      return joinMarkdownSections([
        normalizeText(block.eyebrow),
        normalizeText(block.title)
          ? `## ${normalizeText(block.title)}`
          : undefined,
        normalizeText(block.summary),
        highlights.length > 0
          ? highlights.map((item) => `- ${item}`).join("\n")
          : undefined,
        directContent,
      ]);
    }
    case "key_points": {
      const items = normalizeStringArray(block.items);
      return joinMarkdownSections([
        normalizeText(block.title)
          ? `### ${normalizeText(block.title)}`
          : undefined,
        items.length > 0
          ? items.map((item) => `- ${item}`).join("\n")
          : undefined,
        directContent,
      ]);
    }
    case "callout":
      return joinMarkdownSections([
        normalizeText(block.title)
          ? `### ${normalizeText(block.title)}`
          : undefined,
        normalizeText(block.body) ||
          normalizeText(block.content) ||
          normalizeText(block.text),
        directContent,
      ]);
    case "table": {
      const columns = resolveTableColumns(block);
      const rows = resolveTableRows(block, columns);
      return joinMarkdownSections([
        normalizeText(block.title)
          ? `### ${normalizeText(block.title)}`
          : undefined,
        buildMarkdownTable(columns, rows) || directContent,
      ]);
    }
    case "checklist": {
      const items = resolveChecklistItems(block);
      return joinMarkdownSections([
        normalizeText(block.title)
          ? `### ${normalizeText(block.title)}`
          : undefined,
        items.length > 0
          ? items
              .map((item) => `- [${item.checked ? "x" : " "}] ${item.label}`)
              .join("\n")
          : undefined,
        directContent,
      ]);
    }
    case "metric_grid": {
      const items = resolveMetricItems(block);
      return joinMarkdownSections([
        normalizeText(block.title)
          ? `### ${normalizeText(block.title)}`
          : undefined,
        items.length > 0
          ? items
              .map((item) =>
                [`- **${item.label}**: ${item.value}`, item.detail]
                  .filter(Boolean)
                  .join(" "),
              )
              .join("\n")
          : undefined,
        directContent,
      ]);
    }
    case "quote": {
      const quote =
        normalizeText(block.text) ||
        normalizeText(block.quote) ||
        directContent;
      const attribution =
        normalizeText(block.attribution) ||
        normalizeText(block.author) ||
        normalizeText(block.source);
      if (!quote) {
        return null;
      }
      return attribution ? `> ${quote}\n>\n> - ${attribution}` : `> ${quote}`;
    }
    case "image":
      return joinMarkdownSections([
        normalizeText(record?.title)
          ? `### ${normalizeText(record?.title)}`
          : undefined,
        normalizeText(block.caption),
        normalizeText(block.alt),
        normalizeText(block.url)
          ? `图片地址：${normalizeText(block.url)}`
          : undefined,
        directContent,
      ]);
    case "code_block": {
      const code =
        normalizeText(block.code) ||
        normalizeText(record?.content) ||
        directContent;
      if (!code) {
        return null;
      }
      const language = normalizeText(block.language) || "";
      return joinMarkdownSections([
        normalizeText(block.title)
          ? `### ${normalizeText(block.title)}`
          : undefined,
        `\`\`\`${language}\n${code}\n\`\`\``,
      ]);
    }
    case "rich_text":
      return directContent || null;
    case "citation_list":
    case "divider":
      return directContent || null;
    default:
      return directContent || null;
  }
}

export function resolveFallbackPlainText(
  block: ArtifactDocumentBlock,
): string | null {
  return resolveBlockRichText(block) || resolveFallbackRichText(block);
}
