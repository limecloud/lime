import React, { memo, useMemo } from "react";
import {
  AlertTriangle,
  BookMarked,
  ChevronRight,
  FileStack,
  Files,
  Flag,
  Info,
  Link2,
  Quote,
  Table2,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/agent/chat/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import {
  extractPortableText,
  type ArtifactDocumentBlock,
  type ArtifactDocumentSource,
  type ArtifactDocumentV1,
} from "@/lib/artifact-document";

interface ArtifactDocumentRendererProps {
  document: ArtifactDocumentV1;
  tone?: "dark" | "light";
}

interface ResolvedMetricItem {
  label: string;
  value: string;
  detail: string | undefined;
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

function resolveRichText(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(block.markdown) ||
    normalizeText(block.text) ||
    normalizeText(block.content) ||
    extractPortableText(block.content) ||
    extractPortableText(block.tiptap) ||
    extractPortableText(block.proseMirror) ||
    ""
  );
}

function resolveCalloutToneClasses(
  tone: "dark" | "light",
  variant: string | undefined,
): string {
  const normalized = variant?.trim().toLowerCase();
  if (normalized === "warning") {
    return tone === "light"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }
  if (normalized === "success") {
    return tone === "light"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  }
  if (normalized === "critical" || normalized === "error") {
    return tone === "light"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-rose-500/30 bg-rose-500/10 text-rose-100";
  }
  return tone === "light"
    ? "border-sky-200 bg-sky-50 text-sky-900"
    : "border-sky-500/30 bg-sky-500/10 text-sky-100";
}

function resolveTableColumns(block: ArtifactDocumentBlock): string[] {
  if (!Array.isArray(block.columns)) {
    return [];
  }

  return block.columns
    .map((column) => {
      if (typeof column === "string") {
        return column.trim();
      }

      const record =
        column && typeof column === "object" && !Array.isArray(column)
          ? (column as Record<string, unknown>)
          : null;

      return (
        normalizeText(record?.label) ||
        normalizeText(record?.title) ||
        normalizeText(record?.key) ||
        ""
      );
    })
    .filter(Boolean);
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
        return row.map((cell) => normalizeText(cell) || String(cell ?? ""));
      }

      const record =
        row && typeof row === "object" && !Array.isArray(row)
          ? (row as Record<string, unknown>)
          : null;
      if (!record) {
        return [];
      }

      if (Array.isArray(record.cells)) {
        return record.cells.map((cell) => normalizeText(cell) || String(cell ?? ""));
      }

      if (Array.isArray(record.values)) {
        return record.values.map((cell) => normalizeText(cell) || String(cell ?? ""));
      }

      if (columns.length > 0) {
        return columns.map((column) => normalizeText(record[column]) || "");
      }

      return Object.values(record).map((cell) => normalizeText(cell) || String(cell ?? ""));
    })
    .filter((row) => row.some((cell) => cell.trim().length > 0));
}

function resolveChecklistItems(block: ArtifactDocumentBlock) {
  if (!Array.isArray(block.items)) {
    return [];
  }

  return block.items
    .map((item) => {
      if (typeof item === "string") {
        return { label: item.trim(), checked: false };
      }

      const record =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const label =
        normalizeText(record?.label) ||
        normalizeText(record?.text) ||
        normalizeText(record?.content);
      if (!label) {
        return null;
      }

      return {
        label,
        checked: record?.checked === true || record?.done === true,
      };
    })
    .filter(
      (
        item,
      ): item is {
        label: string;
        checked: boolean;
      } => Boolean(item),
    );
}

function resolveMetricItems(block: ArtifactDocumentBlock) {
  const items = Array.isArray(block.items)
    ? block.items
    : Array.isArray(block.metrics)
      ? block.metrics
      : [];

  return items
    .map((item) => {
      const record =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
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
          normalizeText(record.detail) ||
          normalizeText(record.description) ||
          normalizeText(record.trend),
      };
    })
    .filter((item): item is ResolvedMetricItem => item !== null);
}

function renderBlock(
  block: ArtifactDocumentBlock,
  tone: "dark" | "light",
): React.ReactNode {
  switch (block.type) {
    case "section_header":
      return (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
            <ChevronRight className="h-3.5 w-3.5" />
            <span>Section</span>
          </div>
          <h2
            className={cn(
              "text-2xl font-semibold tracking-tight",
              tone === "light" ? "text-slate-950" : "text-white",
            )}
          >
            {normalizeText(block.title) || "未命名章节"}
          </h2>
          {normalizeText(block.description) ? (
            <p
              className={cn(
                "text-sm leading-7",
                tone === "light" ? "text-slate-600" : "text-slate-300",
              )}
            >
              {normalizeText(block.description)}
            </p>
          ) : null}
        </section>
      );
    case "hero_summary": {
      const highlights = normalizeStringArray(block.highlights);
      return (
        <section
          className={cn(
            "rounded-3xl border px-6 py-5 shadow-sm",
            tone === "light"
              ? "border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]"
              : "border-white/10 bg-white/5",
          )}
        >
          <div className="space-y-3">
            {normalizeText(block.eyebrow) ? (
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                {normalizeText(block.eyebrow)}
              </div>
            ) : null}
            {normalizeText(block.title) ? (
              <h2
                className={cn(
                  "text-3xl font-semibold tracking-tight",
                  tone === "light" ? "text-slate-950" : "text-white",
                )}
              >
                {normalizeText(block.title)}
              </h2>
            ) : null}
            <p
              className={cn(
                "text-base leading-8",
                tone === "light" ? "text-slate-700" : "text-slate-200",
              )}
            >
              {normalizeText(block.summary) || "暂无摘要"}
            </p>
            {highlights.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {highlights.map((highlight, index) => (
                  <div
                    key={`${block.id}-highlight-${index}`}
                    className={cn(
                      "rounded-2xl border px-4 py-3 text-sm leading-6",
                      tone === "light"
                        ? "border-slate-200 bg-slate-50 text-slate-700"
                        : "border-white/10 bg-black/20 text-slate-200",
                    )}
                  >
                    {highlight}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      );
    }
    case "key_points": {
      const items = normalizeStringArray(block.items);
      if (items.length === 0) {
        return null;
      }
      return (
        <section className="space-y-4">
          {normalizeText(block.title) ? (
            <h3
              className={cn(
                "text-lg font-semibold",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {normalizeText(block.title)}
            </h3>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item, index) => (
              <div
                key={`${block.id}-point-${index}`}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm leading-6",
                  tone === "light"
                    ? "border-slate-200 bg-white text-slate-700"
                    : "border-white/10 bg-white/5 text-slate-200",
                )}
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      );
    }
    case "rich_text": {
      const richText = resolveRichText(block);
      if (!richText) {
        return null;
      }
      return <MarkdownRenderer content={richText} />;
    }
    case "callout": {
      const title = normalizeText(block.title);
      const content =
        normalizeText(block.content) ||
        normalizeText(block.text) ||
        extractPortableText(block.content);
      if (!title && !content) {
        return null;
      }
      return (
        <section
          className={cn(
            "rounded-2xl border px-5 py-4",
            resolveCalloutToneClasses(
              tone,
              normalizeText(block.tone) || normalizeText(block.variant),
            ),
          )}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              {title ? <div className="font-semibold">{title}</div> : null}
              {content ? <div className="text-sm leading-7">{content}</div> : null}
            </div>
          </div>
        </section>
      );
    }
    case "table": {
      const columns = resolveTableColumns(block);
      const rows = resolveTableRows(block, columns);
      if (columns.length === 0 && rows.length === 0) {
        return null;
      }
      return (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Table2 className="h-4 w-4 text-slate-400" />
            <h3
              className={cn(
                "text-lg font-semibold",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {normalizeText(block.title) || "表格"}
            </h3>
          </div>
          <div
            className={cn(
              "overflow-auto rounded-2xl border",
              tone === "light" ? "border-slate-200" : "border-white/10",
            )}
          >
            <table className="min-w-full text-left text-sm">
              {columns.length > 0 ? (
                <thead
                  className={cn(
                    tone === "light"
                      ? "bg-slate-50 text-slate-700"
                      : "bg-white/5 text-slate-200",
                  )}
                >
                  <tr>
                    {columns.map((column, index) => (
                      <th key={`${block.id}-head-${index}`} className="px-4 py-3 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
              ) : null}
              <tbody
                className={cn(
                  tone === "light" ? "bg-white text-slate-700" : "bg-black/10 text-slate-200",
                )}
              >
                {rows.map((row, rowIndex) => (
                  <tr
                    key={`${block.id}-row-${rowIndex}`}
                    className={cn(
                      tone === "light"
                        ? "border-t border-slate-200"
                        : "border-t border-white/10",
                    )}
                  >
                    {row.map((cell, cellIndex) => (
                      <td key={`${block.id}-cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }
    case "checklist": {
      const items = resolveChecklistItems(block);
      if (items.length === 0) {
        return null;
      }
      return (
        <section className="space-y-4">
          {normalizeText(block.title) ? (
            <h3
              className={cn(
                "text-lg font-semibold",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {normalizeText(block.title)}
            </h3>
          ) : null}
          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={`${block.id}-check-${index}`}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border px-4 py-3",
                  tone === "light"
                    ? "border-slate-200 bg-white text-slate-700"
                    : "border-white/10 bg-white/5 text-slate-200",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 h-5 w-5 rounded-full border text-center text-[11px] font-semibold leading-5",
                    item.checked
                      ? tone === "light"
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-emerald-400 bg-emerald-400 text-slate-950"
                      : tone === "light"
                        ? "border-slate-300 bg-slate-50 text-slate-400"
                        : "border-white/20 bg-transparent text-slate-500",
                  )}
                >
                  {item.checked ? "✓" : ""}
                </div>
                <div className="text-sm leading-6">{item.label}</div>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case "metric_grid": {
      const items = resolveMetricItems(block);
      if (items.length === 0) {
        return null;
      }
      return (
        <section className="space-y-4">
          {normalizeText(block.title) ? (
            <h3
              className={cn(
                "text-lg font-semibold",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {normalizeText(block.title)}
            </h3>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item, index) => (
              <div
                key={`${block.id}-metric-${index}`}
                className={cn(
                  "rounded-2xl border px-4 py-4",
                  tone === "light"
                    ? "border-slate-200 bg-white"
                    : "border-white/10 bg-white/5",
                )}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {item.label}
                </div>
                <div
                  className={cn(
                    "mt-3 text-2xl font-semibold tracking-tight",
                    tone === "light" ? "text-slate-950" : "text-white",
                  )}
                >
                  {item.value}
                </div>
                {item.detail ? (
                  <div
                    className={cn(
                      "mt-2 text-sm leading-6",
                      tone === "light" ? "text-slate-600" : "text-slate-300",
                    )}
                  >
                    {item.detail}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      );
    }
    case "quote": {
      const quote =
        normalizeText(block.quote) ||
        normalizeText(block.text) ||
        extractPortableText(block.content);
      if (!quote) {
        return null;
      }
      return (
        <section
          className={cn(
            "rounded-2xl border px-5 py-5",
            tone === "light"
              ? "border-slate-200 bg-slate-50"
              : "border-white/10 bg-white/5",
          )}
        >
          <div className="flex items-start gap-3">
            <Quote className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
            <div className="space-y-3">
              <blockquote
                className={cn(
                  "text-base leading-8",
                  tone === "light" ? "text-slate-700" : "text-slate-200",
                )}
              >
                {quote}
              </blockquote>
              {normalizeText(block.author) || normalizeText(block.source) ? (
                <div className="text-sm text-slate-500">
                  {normalizeText(block.author) || normalizeText(block.source)}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      );
    }
    case "citation_list": {
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length === 0) {
        return null;
      }
      return (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 text-slate-400" />
            <h3
              className={cn(
                "text-lg font-semibold",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {normalizeText(block.title) || "引用与来源"}
            </h3>
          </div>
          <div className="space-y-3">
            {items.map((item, index) => {
              const record =
                item && typeof item === "object" && !Array.isArray(item)
                  ? (item as Record<string, unknown>)
                  : null;
              const title =
                normalizeText(record?.title) ||
                normalizeText(record?.label) ||
                normalizeText(record?.url) ||
                `来源 ${index + 1}`;
              const note =
                normalizeText(record?.note) ||
                normalizeText(record?.summary) ||
                normalizeText(record?.description);
              const url =
                normalizeText(record?.url) ||
                normalizeText(record?.href) ||
                normalizeText(record?.link);

              return (
                <div
                  key={`${block.id}-citation-${index}`}
                  className={cn(
                    "rounded-2xl border px-4 py-3",
                    tone === "light"
                      ? "border-slate-200 bg-white"
                      : "border-white/10 bg-white/5",
                  )}
                >
                  <div
                    className={cn(
                      "text-sm font-medium",
                      tone === "light" ? "text-slate-900" : "text-white",
                    )}
                  >
                    {title}
                  </div>
                  {note ? (
                    <div
                      className={cn(
                        "mt-1 text-sm leading-6",
                        tone === "light" ? "text-slate-600" : "text-slate-300",
                      )}
                    >
                      {note}
                    </div>
                  ) : null}
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      <span className="truncate">{url}</span>
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      );
    }
    case "image": {
      const src =
        normalizeText(block.url) ||
        normalizeText(block.src) ||
        normalizeText(block.imageUrl);
      if (!src) {
        return null;
      }
      return (
        <section className="space-y-3">
          {normalizeText(block.title) ? (
            <h3
              className={cn(
                "text-lg font-semibold",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {normalizeText(block.title)}
            </h3>
          ) : null}
          <div
            className={cn(
              "overflow-hidden rounded-3xl border",
              tone === "light" ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/5",
            )}
          >
            <img
              src={src}
              alt={normalizeText(block.alt) || normalizeText(block.caption) || "artifact image"}
              className="max-h-[520px] w-full object-contain"
            />
          </div>
          {normalizeText(block.caption) ? (
            <div className="text-sm text-slate-500">{normalizeText(block.caption)}</div>
          ) : null}
        </section>
      );
    }
    case "code_block": {
      const code =
        normalizeText(block.code) ||
        normalizeText(block.content) ||
        extractPortableText(block.content);
      if (!code) {
        return null;
      }
      return (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Files className="h-4 w-4 text-slate-400" />
            <div
              className={cn(
                "text-sm font-medium",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {normalizeText(block.title) ||
                normalizeText(block.language) ||
                "代码片段"}
            </div>
          </div>
          <pre
            className={cn(
              "overflow-auto rounded-2xl border px-4 py-4 text-sm leading-6",
              tone === "light"
                ? "border-slate-200 bg-slate-950 text-slate-100"
                : "border-white/10 bg-slate-950 text-slate-100",
            )}
          >
            <code>{code}</code>
          </pre>
        </section>
      );
    }
    case "divider":
      return (
        <div
          className={cn(
            "my-2 h-px w-full",
            tone === "light" ? "bg-slate-200" : "bg-white/10",
          )}
        />
      );
    default:
      return null;
  }
}

const SourceAppendix = memo(function SourceAppendix({
  sources,
  tone = "light",
}: {
  sources: ArtifactDocumentSource[];
  tone?: "dark" | "light";
}) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <section
      className={cn(
        "rounded-3xl border px-5 py-5",
        tone === "light"
          ? "border-slate-200 bg-slate-50"
          : "border-white/10 bg-white/5",
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        <FileStack className="h-4 w-4 text-slate-400" />
        <h3
          className={cn(
            "text-lg font-semibold",
            tone === "light" ? "text-slate-900" : "text-white",
          )}
        >
          Sources
        </h3>
      </div>
      <div className="space-y-3">
        {sources.map((source) => (
          <div
            key={source.id}
            className={cn(
              "rounded-2xl border px-4 py-3",
              tone === "light"
                ? "border-slate-200 bg-white"
                : "border-white/10 bg-black/20",
            )}
          >
            <div
              className={cn(
                "text-sm font-medium",
                tone === "light" ? "text-slate-900" : "text-white",
              )}
            >
              {source.title || source.url || source.id}
            </div>
            {source.note ? (
              <div
                className={cn(
                  "mt-1 text-sm leading-6",
                  tone === "light" ? "text-slate-600" : "text-slate-300",
                )}
              >
                {source.note}
              </div>
            ) : null}
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span className="truncate">{source.url}</span>
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
});

export const ArtifactDocumentRenderer: React.FC<ArtifactDocumentRendererProps> = memo(
  ({ document, tone = "light" }) => {
    const visibleBlocks = useMemo(
      () => document.blocks.filter((block) => block.hidden !== true),
      [document.blocks],
    );

    return (
      <div
        data-testid="artifact-document-renderer"
        className={cn(
          "h-full overflow-auto px-5 py-6",
          tone === "light" ? "bg-background" : "bg-[#1e2227]",
        )}
      >
        <article className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          <header
            className={cn(
              "rounded-3xl border px-6 py-5 shadow-sm",
              tone === "light"
                ? "border-slate-200 bg-white"
                : "border-white/10 bg-white/5",
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              <span>{document.kind}</span>
              <span>•</span>
              <span>{document.status === "failed" ? "草稿" : document.status}</span>
              {document.metadata.theme ? (
                <>
                  <span>•</span>
                  <span>{document.metadata.theme}</span>
                </>
              ) : null}
            </div>
            <h1
              className={cn(
                "mt-3 text-3xl font-semibold tracking-tight",
                tone === "light" ? "text-slate-950" : "text-white",
              )}
            >
              {document.title}
            </h1>
            {document.summary ? (
              <p
                className={cn(
                  "mt-3 text-base leading-8",
                  tone === "light" ? "text-slate-600" : "text-slate-300",
                )}
              >
                {document.summary}
              </p>
            ) : null}
            {(document.metadata.audience || document.metadata.intent) ? (
              <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-500">
                {document.metadata.audience ? (
                  <span className="inline-flex items-center gap-1">
                    <Flag className="h-3.5 w-3.5" />
                    面向 {String(document.metadata.audience)}
                  </span>
                ) : null}
                {document.metadata.intent ? (
                  <span>目标 {String(document.metadata.intent)}</span>
                ) : null}
              </div>
            ) : null}
          </header>

          {document.status === "failed" ? (
            <section
              className={cn(
                "rounded-2xl border px-5 py-4",
                tone === "light"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-100",
              )}
            >
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-sm leading-7">
                  模型未能生成结构化文档，以下为原始内容。你可以基于此内容继续对话或重新生成。
                </div>
              </div>
            </section>
          ) : null}

          {visibleBlocks.map((block) => (
            <div
              key={block.id}
              id={`artifact-block-${block.id}`}
              data-artifact-block-id={block.id}
              data-artifact-block-type={block.type}
              className="scroll-mt-6"
            >
              {renderBlock(block, tone)}
            </div>
          ))}

          <SourceAppendix sources={document.sources} tone={tone} />
        </article>
      </div>
    );
  },
);

ArtifactDocumentRenderer.displayName = "ArtifactDocumentRenderer";
