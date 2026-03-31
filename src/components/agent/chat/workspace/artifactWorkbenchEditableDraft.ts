import {
  extractPortableText,
  type ArtifactChecklistItem,
  type ArtifactDocumentBlock,
  type ArtifactMetricGridItem,
} from "@/lib/artifact-document";

export interface EditableArtifactBlockEntry {
  blockId: string;
  label: string;
  detail?: string;
  editorKind: EditableArtifactBlockDraft["editorKind"];
  draft: EditableArtifactBlockDraft;
}

export type EditableArtifactBlockDraft =
  | {
      editorKind: "rich_text";
      markdown: string;
    }
  | {
      editorKind: "section_header";
      title: string;
      description: string;
    }
  | {
      editorKind: "hero_summary";
      eyebrow: string;
      title: string;
      summary: string;
      highlights: string;
    }
  | {
      editorKind: "callout";
      title: string;
      body: string;
      tone: string;
    }
  | {
      editorKind: "key_points";
      title: string;
      items: string;
    }
  | {
      editorKind: "table";
      title: string;
      columns: string;
      rows: string;
    }
  | {
      editorKind: "checklist";
      title: string;
      items: string;
    }
  | {
      editorKind: "metric_grid";
      title: string;
      metrics: string;
    }
  | {
      editorKind: "quote";
      text: string;
      attribution: string;
    }
  | {
      editorKind: "code_block";
      title: string;
      language: string;
      code: string;
    };

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

export function resolveRichTextContent(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(block.contentFormat === "markdown" ? block.content : undefined) ||
    normalizeText(block.markdown) ||
    normalizeText(block.text) ||
    normalizeText(block.content) ||
    extractPortableText(block.content) ||
    extractPortableText(block.tiptap) ||
    extractPortableText(block.proseMirror) ||
    ""
  );
}

export function resolveCalloutContent(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(block.body) ||
    normalizeText(block.content) ||
    normalizeText(block.text) ||
    extractPortableText(block.content) ||
    ""
  );
}

export function normalizeHighlightsDraft(value: string): string {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

function splitDraftLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPipeCells(value: string): string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 || index < array.length - 1);
}

function normalizeChecklistDraftState(
  value: string,
): ArtifactChecklistItem["state"] {
  switch (value.trim().toLowerCase()) {
    case "done":
      return "done";
    case "doing":
      return "doing";
    default:
      return "todo";
  }
}

function resolveChecklistDraftLine(
  line: string,
): { state: ArtifactChecklistItem["state"]; text: string } | null {
  const normalized = line.trim();
  if (!normalized) {
    return null;
  }

  const pipeCells = splitPipeCells(normalized);
  if (pipeCells.length >= 2) {
    const [state, ...textParts] = pipeCells;
    const text = textParts.join(" | ").trim();
    if (!text) {
      return null;
    }
    return {
      state: normalizeChecklistDraftState(state),
      text,
    };
  }

  const stateMatch = normalized.match(/^(todo|doing|done)\s*[:：-]\s*(.+)$/i);
  if (stateMatch) {
    return {
      state: normalizeChecklistDraftState(stateMatch[1]),
      text: stateMatch[2].trim(),
    };
  }

  const checkboxMatch = normalized.match(/^\[( |x)\]\s*(.+)$/i);
  if (checkboxMatch) {
    return {
      state: checkboxMatch[1].trim().toLowerCase() === "x" ? "done" : "todo",
      text: checkboxMatch[2].trim(),
    };
  }

  return {
    state: "todo",
    text: normalized,
  };
}

export function resolveChecklistDraftValue(block: ArtifactDocumentBlock): string {
  if (!Array.isArray(block.items)) {
    return "";
  }

  return block.items
    .map((item) => {
      if (typeof item === "string") {
        return `todo | ${item.trim()}`;
      }

      const label =
        normalizeText(item.text) ||
        normalizeText((item as { label?: string }).label) ||
        "";
      if (!label) {
        return null;
      }
      return `${normalizeChecklistDraftState(item.state || "todo")} | ${label}`;
    })
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

export function parseChecklistDraftItems(
  value: string,
  fallbackPrefix: string,
  existingItems: ArtifactChecklistItem[] = [],
): ArtifactChecklistItem[] {
  return splitDraftLines(value)
    .map((line, index) => {
      const resolved = resolveChecklistDraftLine(line);
      if (!resolved) {
        return null;
      }

      return {
        id: existingItems[index]?.id || `${fallbackPrefix}-${index + 1}`,
        text: resolved.text,
        state: resolved.state,
      };
    })
    .filter((item): item is ArtifactChecklistItem => Boolean(item));
}

function normalizeMetricDraftTone(
  value: string | undefined,
): ArtifactMetricGridItem["tone"] | undefined {
  switch (value?.trim().toLowerCase()) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
      return "danger";
    case "neutral":
      return "neutral";
    default:
      return undefined;
  }
}

export function resolveMetricDraftValue(block: ArtifactDocumentBlock): string {
  const items = Array.isArray(block.metrics)
    ? block.metrics
    : Array.isArray(block.items)
      ? block.items
      : [];

  return items
    .map((item) => {
      const label =
        normalizeText((item as { label?: string }).label) ||
        normalizeText((item as { title?: string }).title) ||
        "";
      const value =
        normalizeText((item as { value?: string }).value) ||
        normalizeText((item as { metric?: string }).metric) ||
        normalizeText((item as { score?: string }).score) ||
        "";
      if (!label || !value) {
        return null;
      }

      return [
        label,
        value,
        normalizeText((item as { note?: string }).note) ||
          normalizeText((item as { detail?: string }).detail) ||
          normalizeText((item as { description?: string }).description) ||
          "",
        normalizeText((item as { tone?: string }).tone) || "",
      ]
        .filter((part, index, array) => part || index < array.length - 1)
        .join(" | ");
    })
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

export function parseMetricDraftItems(
  value: string,
  fallbackPrefix: string,
  existingItems: ArtifactMetricGridItem[] = [],
): ArtifactMetricGridItem[] {
  const items: ArtifactMetricGridItem[] = [];

  splitDraftLines(value).forEach((line, index) => {
    const [label = "", metricValue = "", note = "", tone = ""] =
      splitPipeCells(line);
    const normalizedLabel = label.trim();
    const normalizedValue = metricValue.trim();
    if (!normalizedLabel || !normalizedValue) {
      return;
    }

    items.push({
      id: existingItems[index]?.id || `${fallbackPrefix}-${index + 1}`,
      label: normalizedLabel,
      value: normalizedValue,
      note: note.trim() || undefined,
      tone:
        normalizeMetricDraftTone(tone) || existingItems[index]?.tone || undefined,
    });
  });

  return items;
}

export function resolveTableColumnsDraftValue(block: ArtifactDocumentBlock): string {
  return Array.isArray(block.columns) ? block.columns.join(" | ") : "";
}

export function resolveTableRowsDraftValue(block: ArtifactDocumentBlock): string {
  if (!Array.isArray(block.rows)) {
    return "";
  }

  return block.rows
    .map((row) =>
      Array.isArray(row)
        ? row.map((cell) => normalizeText(cell) || "").join(" | ")
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

export function parseTableDraftColumns(value: string): string[] {
  const lines = splitDraftLines(value);
  if (lines.length === 0) {
    return [];
  }

  if (lines.length === 1) {
    return splitPipeCells(lines[0]);
  }

  return lines;
}

export function parseTableDraftRows(value: string, columnCount: number): string[][] {
  return splitDraftLines(value).map((line) => {
    const cells = splitPipeCells(line);
    if (columnCount <= 0) {
      return cells;
    }

    return Array.from({ length: columnCount }, (_, index) => cells[index] || "");
  });
}

export function resolveCodeBlockContent(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(block.code) ||
    normalizeText(block.content) ||
    extractPortableText(block.content) ||
    ""
  );
}

export function resolveEditableCalloutTone(value: string): NonNullable<
  Extract<ArtifactDocumentBlock, { type: "callout" }>["tone"]
> {
  switch (value) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "danger":
    case "critical":
    case "error":
      return "danger";
    case "neutral":
      return "neutral";
    default:
      return "info";
  }
}

export function resolveEditableArtifactDraft(
  block: ArtifactDocumentBlock,
): EditableArtifactBlockDraft | null {
  switch (block.type) {
    case "rich_text":
      return {
        editorKind: "rich_text",
        markdown: resolveRichTextContent(block),
      };
    case "section_header":
      return {
        editorKind: "section_header",
        title: normalizeText(block.title) || "",
        description: normalizeText(block.description) || "",
      };
    case "hero_summary":
      return {
        editorKind: "hero_summary",
        eyebrow: normalizeText(block.eyebrow) || "",
        title: normalizeText(block.title) || "",
        summary: normalizeText(block.summary) || "",
        highlights: normalizeStringArray(block.highlights).join("\n"),
      };
    case "callout":
      return {
        editorKind: "callout",
        title: normalizeText(block.title) || "",
        body: resolveCalloutContent(block),
        tone: normalizeText(block.tone) || normalizeText(block.variant) || "",
      };
    case "key_points":
      return {
        editorKind: "key_points",
        title: normalizeText(block.title) || "",
        items: normalizeStringArray(block.items).join("\n"),
      };
    case "table":
      return {
        editorKind: "table",
        title: normalizeText(block.title) || "",
        columns: resolveTableColumnsDraftValue(block),
        rows: resolveTableRowsDraftValue(block),
      };
    case "checklist":
      return {
        editorKind: "checklist",
        title: normalizeText(block.title) || "",
        items: resolveChecklistDraftValue(block),
      };
    case "metric_grid":
      return {
        editorKind: "metric_grid",
        title: normalizeText(block.title) || "",
        metrics: resolveMetricDraftValue(block),
      };
    case "quote":
      return {
        editorKind: "quote",
        text: normalizeText(block.text) || normalizeText(block.quote) || "",
        attribution:
          normalizeText(block.attribution) ||
          normalizeText(block.author) ||
          normalizeText(block.source) ||
          "",
      };
    case "code_block":
      return {
        editorKind: "code_block",
        title: normalizeText(block.title) || "",
        language: normalizeText(block.language) || "",
        code: resolveCodeBlockContent(block),
      };
    default:
      return null;
  }
}
