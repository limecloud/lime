import React, { memo, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookMarked,
  ChevronRight,
  ImageOff,
  Link2,
  Quote,
  Table2,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/agent/chat/components/MarkdownRenderer";
import { CodeRenderer } from "@/components/artifact/renderers/CodeRenderer";
import { cn } from "@/lib/utils";
import type {
  ArtifactDocumentBlock,
  ArtifactDocumentSource,
} from "@/lib/artifact-document";
import type { Artifact } from "@/lib/artifact/types";
import {
  normalizeStringArray,
  normalizeText,
  resolveBlockRichText,
  resolveChecklistItems,
  resolveFallbackPlainText,
  resolveFallbackRichText,
  resolveMetricItems,
  resolvePortableRichText,
  resolveRecord,
  resolveTableColumns,
  resolveTableRows,
  type ArtifactDocumentTone,
} from "./blockUtils";

interface ArtifactDocumentBlockComponentProps {
  block: ArtifactDocumentBlock;
  tone: ArtifactDocumentTone;
  sourceLookup: Map<string, ArtifactDocumentSource>;
}

interface ArtifactDocumentBlockBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
  resetKey: string;
}

interface ArtifactDocumentBlockBoundaryState {
  hasError: boolean;
}

type ArtifactDocumentBlockFallbackMode =
  | "rich_text"
  | "plain_text"
  | "placeholder"
  | "delete";

const BLOCK_FALLBACKS: Record<
  ArtifactDocumentBlock["type"],
  ArtifactDocumentBlockFallbackMode
> = {
  section_header: "rich_text",
  hero_summary: "rich_text",
  key_points: "rich_text",
  rich_text: "plain_text",
  callout: "rich_text",
  table: "rich_text",
  checklist: "rich_text",
  metric_grid: "rich_text",
  quote: "rich_text",
  citation_list: "delete",
  image: "placeholder",
  code_block: "rich_text",
  divider: "delete",
};

class ArtifactDocumentBlockBoundary extends React.Component<
  ArtifactDocumentBlockBoundaryProps,
  ArtifactDocumentBlockBoundaryState
> {
  state: ArtifactDocumentBlockBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ArtifactDocumentBlockBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: ArtifactDocumentBlockBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

function resolveCalloutToneClasses(
  tone: ArtifactDocumentTone,
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
  if (
    normalized === "critical" ||
    normalized === "danger" ||
    normalized === "error"
  ) {
    return tone === "light"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-rose-500/30 bg-rose-500/10 text-rose-100";
  }
  return tone === "light"
    ? "border-sky-200 bg-sky-50 text-sky-900"
    : "border-sky-500/30 bg-sky-500/10 text-sky-100";
}

const ArtifactRichTextSurface = memo(function ArtifactRichTextSurface({
  content,
  tone,
  title,
}: {
  content: string;
  tone: ArtifactDocumentTone;
  title?: string;
}) {
  if (!content) {
    return null;
  }

  return (
    <section
      className={cn(
        "rounded-[28px] border px-6 py-6 shadow-sm",
        tone === "light"
          ? "border-slate-200 bg-white"
          : "border-white/10 bg-white/5",
      )}
    >
      {title ? (
        <div
          className={cn(
            "mb-4 text-lg font-semibold",
            tone === "light" ? "text-slate-900" : "text-white",
          )}
        >
          {title}
        </div>
      ) : null}
      <MarkdownRenderer content={content} />
    </section>
  );
});

const ArtifactPlainTextFallback = memo(function ArtifactPlainTextFallback({
  content,
  tone,
}: {
  content: string;
  tone: ArtifactDocumentTone;
}) {
  if (!content) {
    return null;
  }

  return (
    <section
      className={cn(
        "rounded-[28px] border px-6 py-6 shadow-sm",
        tone === "light"
          ? "border-slate-200 bg-white"
          : "border-white/10 bg-white/5",
      )}
    >
      <pre
        className={cn(
          "whitespace-pre-wrap break-words text-sm leading-7 font-sans",
          tone === "light" ? "text-slate-700" : "text-slate-200",
        )}
      >
        {content}
      </pre>
    </section>
  );
});

const ArtifactImagePlaceholder = memo(function ArtifactImagePlaceholder({
  block,
  tone,
}: {
  block: ArtifactDocumentBlock;
  tone: ArtifactDocumentTone;
}) {
  const record = resolveRecord(block);
  const title = normalizeText(record?.title);
  const caption =
    normalizeText(record?.caption) ||
    normalizeText(record?.alt) ||
    "图片暂不可用，已回退为占位图。";

  return (
    <section className="space-y-3">
      {title ? (
        <h3
          className={cn(
            "text-lg font-semibold",
            tone === "light" ? "text-slate-900" : "text-white",
          )}
        >
          {title}
        </h3>
      ) : null}
      <div
        className={cn(
          "flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed px-6 py-8 text-center",
          tone === "light"
            ? "border-slate-300 bg-slate-50 text-slate-500"
            : "border-white/15 bg-white/5 text-slate-300",
        )}
      >
        <div
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-2xl border",
            tone === "light"
              ? "border-slate-200 bg-white text-slate-400"
              : "border-white/10 bg-black/20 text-slate-300",
          )}
        >
          <ImageOff className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div
            className={cn(
              "text-sm font-medium",
              tone === "light" ? "text-slate-700" : "text-white",
            )}
          >
            图片占位图
          </div>
          <div className="text-sm leading-6">{caption}</div>
        </div>
      </div>
    </section>
  );
});

const ArtifactSectionHeader = memo(function ArtifactSectionHeader({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const title = normalizeText(block.title);
  const description = normalizeText(block.description);
  if (!title && !description) {
    return null;
  }

  return (
    <section
      className={cn(
        "rounded-[28px] border px-6 py-5 shadow-sm",
        tone === "light"
          ? "border-slate-200 bg-white"
          : "border-white/10 bg-white/5",
      )}
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-500">
        <ChevronRight className="h-3.5 w-3.5" />
        <span>章节</span>
      </div>
      <div className="mt-4 space-y-3">
        {title ? (
          <h2
            className={cn(
              "text-[1.75rem] font-semibold tracking-tight",
              tone === "light" ? "text-slate-950" : "text-white",
            )}
          >
            {title}
          </h2>
        ) : null}
        {description ? (
          <p
            className={cn(
              "max-w-3xl text-sm leading-7",
              tone === "light" ? "text-slate-600" : "text-slate-300",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
    </section>
  );
});

const ArtifactHeroSummaryCard = memo(function ArtifactHeroSummaryCard({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const highlights = normalizeStringArray(block.highlights);
  const summary = normalizeText(block.summary);
  if (!summary) {
    return null;
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[32px] border px-6 py-6 shadow-sm",
        tone === "light"
          ? "border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_68%,#eef6ff_100%)]"
          : "border-white/10 bg-white/5",
      )}
    >
      <div
        className={cn(
          "grid gap-5",
          highlights.length > 0 ? "xl:grid-cols-[1.28fr_0.92fr]" : "",
        )}
      >
        <div className="space-y-3">
          {normalizeText(block.eyebrow) ? (
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500">
              {normalizeText(block.eyebrow)}
            </div>
          ) : null}
          {normalizeText(block.title) ? (
            <h2
              className={cn(
                "text-[2rem] font-semibold tracking-tight",
                tone === "light" ? "text-slate-950" : "text-white",
              )}
            >
              {normalizeText(block.title)}
            </h2>
          ) : null}
          <p
            className={cn(
              "max-w-3xl text-[15px] leading-8",
              tone === "light" ? "text-slate-700" : "text-slate-200",
            )}
          >
            {summary}
          </p>
        </div>
        {highlights.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {highlights.map((highlight, index) => (
              <div
                key={`${block.id}-highlight-${index}`}
                className={cn(
                  "rounded-2xl border px-4 py-4",
                  tone === "light"
                    ? "border-slate-200 bg-white text-slate-700"
                    : "border-white/10 bg-black/20 text-slate-200",
                )}
              >
                <div className="text-[11px] font-semibold text-slate-400">
                  要点 {String(index + 1).padStart(2, "0")}
                </div>
                <div className="mt-2 text-sm leading-6">{highlight}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
});

const ArtifactKeyPointsList = memo(function ArtifactKeyPointsList({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
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
});

const ArtifactRichTextRenderer = memo(function ArtifactRichTextRenderer({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const content = resolveBlockRichText(block);
  if (!content) {
    return null;
  }

  return (
    <ArtifactRichTextSurface
      content={content}
      tone={tone}
      title={normalizeText(block.title)}
    />
  );
});

const ArtifactCallout = memo(function ArtifactCallout({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const title = normalizeText(block.title);
  const content =
    normalizeText(block.body) ||
    normalizeText(block.content) ||
    normalizeText(block.text) ||
    resolvePortableRichText(block.content);
  if (!title && !content) {
    return null;
  }

  return (
    <section
      className={cn(
        "rounded-[28px] border px-5 py-5 shadow-sm",
        resolveCalloutToneClasses(
          tone,
          normalizeText(block.tone) || normalizeText(block.variant),
        ),
      )}
    >
      <div className="flex items-start gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/60 bg-white">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="space-y-2">
          {title ? <div className="font-semibold">{title}</div> : null}
          {content ? <div className="text-sm leading-7">{content}</div> : null}
        </div>
      </div>
    </section>
  );
});

const ArtifactStructuredTable = memo(function ArtifactStructuredTable({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const columns = resolveTableColumns(block);
  const rows = resolveTableRows(block, columns);
  if (columns.length === 0 && rows.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div
        className={cn(
          "overflow-hidden rounded-[28px] border shadow-sm",
          tone === "light"
            ? "border-slate-200 bg-white"
            : "border-white/10 bg-white/5",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-5 py-4",
            tone === "light"
              ? "border-b border-slate-200"
              : "border-b border-white/10",
          )}
        >
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
        <div className="overflow-auto">
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
                    <th
                      key={`${block.id}-head-${index}`}
                      className="px-4 py-3 font-medium"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody
              className={cn(
                tone === "light"
                  ? "bg-white text-slate-700"
                  : "bg-black/10 text-slate-200",
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
                    <td
                      key={`${block.id}-cell-${rowIndex}-${cellIndex}`}
                      className="px-4 py-3 align-top"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
});

const ArtifactChecklist = memo(function ArtifactChecklist({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
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
});

const ArtifactMetricGrid = memo(function ArtifactMetricGrid({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
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
});

const ArtifactQuote = memo(function ArtifactQuote({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const quote =
    normalizeText(block.text) ||
    normalizeText(block.quote) ||
    resolvePortableRichText(block.content);
  const attribution =
    normalizeText(block.attribution) ||
    normalizeText(block.author) ||
    normalizeText(block.source);
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
          {attribution ? (
            <div className="text-sm text-slate-500">{attribution}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
});

function resolveCitationEntries(
  block: ArtifactDocumentBlock,
  sourceLookup: Map<string, ArtifactDocumentSource>,
) {
  const items = Array.isArray(block.items) ? block.items : [];
  const resolvedItems: Array<{
    title: string;
    note?: string;
    url?: string;
  }> = [];

  items.forEach((item, index) => {
    const record = resolveRecord(item);
    const sourceId =
      normalizeText(record?.sourceId) || normalizeText(record?.source_id);
    const source = sourceId ? sourceLookup.get(sourceId) : undefined;
    const title =
      normalizeText(record?.label) ||
      normalizeText(source?.label) ||
      normalizeText(source?.locator?.url) ||
      normalizeText(source?.locator?.path) ||
      normalizeText(sourceId) ||
      `来源 ${index + 1}`;
    const note =
      normalizeText(record?.note) ||
      normalizeText(source?.snippet) ||
      normalizeText(record?.summary) ||
      normalizeText(record?.description);
    const url =
      normalizeText(source?.locator?.url) ||
      normalizeText(record?.url) ||
      normalizeText(record?.href) ||
      normalizeText(record?.link);

    if (!title && !note && !url) {
      return;
    }

    resolvedItems.push({ title, note, url });
  });

  return resolvedItems;
}

const ArtifactCitationList = memo(function ArtifactCitationList({
  block,
  tone,
  sourceLookup,
}: ArtifactDocumentBlockComponentProps) {
  const resolvedItems = useMemo(
    () => resolveCitationEntries(block, sourceLookup),
    [block, sourceLookup],
  );

  if (resolvedItems.length === 0) {
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
          {normalizeText(block.title) || "参考来源"}
        </h3>
      </div>
      <div className="space-y-3">
        {resolvedItems.map((item, index) => (
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
              {item.title}
            </div>
            {item.note ? (
              <div
                className={cn(
                  "mt-1 text-sm leading-6",
                  tone === "light" ? "text-slate-600" : "text-slate-300",
                )}
              >
                {item.note}
              </div>
            ) : null}
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span className="truncate">{item.url}</span>
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
});

const ArtifactImageBlock = memo(function ArtifactImageBlock({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const record = resolveRecord(block);
  const src =
    normalizeText(block.url) ||
    normalizeText(record?.src) ||
    normalizeText(record?.imageUrl);
  const title = normalizeText(record?.title);
  const caption = normalizeText(block.caption);
  const [hasLoadError, setHasLoadError] = useState(false);

  if (!src || hasLoadError) {
    return <ArtifactImagePlaceholder block={block} tone={tone} />;
  }

  return (
    <section className="space-y-3">
      {title ? (
        <h3
          className={cn(
            "text-lg font-semibold",
            tone === "light" ? "text-slate-900" : "text-white",
          )}
        >
          {title}
        </h3>
      ) : null}
      <div
        className={cn(
          "overflow-hidden rounded-3xl border",
          tone === "light"
            ? "border-slate-200 bg-slate-50"
            : "border-white/10 bg-white/5",
        )}
      >
        <img
          src={src}
          alt={normalizeText(block.alt) || caption || "artifact image"}
          className="max-h-[520px] w-full object-contain"
          onError={() => setHasLoadError(true)}
        />
      </div>
      {caption ? <div className="text-sm text-slate-500">{caption}</div> : null}
    </section>
  );
});

const ArtifactCodeBlockRenderer = memo(function ArtifactCodeBlockRenderer({
  block,
  tone,
}: ArtifactDocumentBlockComponentProps) {
  const record = resolveRecord(block);
  const code =
    normalizeText(block.code) ||
    normalizeText(record?.content) ||
    resolvePortableRichText(record?.content);
  const language = normalizeText(block.language) || "text";

  const artifact = useMemo<Artifact | null>(() => {
    if (!code) {
      return null;
    }

    return {
      id: `artifact-document-code-${block.id}`,
      type: "code",
      title: normalizeText(block.title) || `${block.id}.${language}`,
      content: code,
      status: "complete",
      meta: {
        language,
        filename: normalizeText(block.title) || `${block.id}.${language}`,
        filePath: `artifact-document/${block.id}.${language}`,
      },
      position: { start: 0, end: code.length },
      createdAt: 0,
      updatedAt: 0,
    };
  }, [block.id, block.title, code, language]);

  if (!artifact) {
    return null;
  }

  return (
    <section className="space-y-3">
      {normalizeText(block.title) ? (
        <div
          className={cn(
            "text-sm font-medium",
            tone === "light" ? "text-slate-900" : "text-white",
          )}
        >
          {normalizeText(block.title)}
        </div>
      ) : null}
      <div className="[&_.code-renderer]:h-auto [&_.code-renderer]:min-h-[220px] [&_.code-renderer]:rounded-[24px]">
        <CodeRenderer artifact={artifact} tone={tone} />
      </div>
    </section>
  );
});

const ArtifactDivider = memo(function ArtifactDivider({
  tone,
}: Pick<ArtifactDocumentBlockComponentProps, "tone">) {
  return (
    <div
      className={cn(
        "my-2 h-px w-full",
        tone === "light" ? "bg-slate-200" : "bg-white/10",
      )}
    />
  );
});

function renderBlockContent(
  props: ArtifactDocumentBlockComponentProps,
): React.ReactNode {
  switch (props.block.type) {
    case "section_header":
      if (
        !normalizeText(props.block.title) &&
        !normalizeText(props.block.description)
      ) {
        return null;
      }
      return <ArtifactSectionHeader {...props} />;
    case "hero_summary":
      if (!normalizeText(props.block.summary)) {
        return null;
      }
      return <ArtifactHeroSummaryCard {...props} />;
    case "key_points":
      if (normalizeStringArray(props.block.items).length === 0) {
        return null;
      }
      return <ArtifactKeyPointsList {...props} />;
    case "rich_text":
      if (!resolveBlockRichText(props.block)) {
        return null;
      }
      return <ArtifactRichTextRenderer {...props} />;
    case "callout":
      if (
        !normalizeText(props.block.title) &&
        !normalizeText(props.block.body) &&
        !normalizeText(props.block.content) &&
        !normalizeText(props.block.text) &&
        !resolvePortableRichText(props.block.content)
      ) {
        return null;
      }
      return <ArtifactCallout {...props} />;
    case "table":
      if (
        resolveTableColumns(props.block).length === 0 &&
        resolveTableRows(props.block, []).length === 0
      ) {
        return null;
      }
      return <ArtifactStructuredTable {...props} />;
    case "checklist":
      if (resolveChecklistItems(props.block).length === 0) {
        return null;
      }
      return <ArtifactChecklist {...props} />;
    case "metric_grid":
      if (resolveMetricItems(props.block).length === 0) {
        return null;
      }
      return <ArtifactMetricGrid {...props} />;
    case "quote":
      if (
        !normalizeText(props.block.text) &&
        !normalizeText(props.block.quote) &&
        !resolvePortableRichText(props.block.content)
      ) {
        return null;
      }
      return <ArtifactQuote {...props} />;
    case "citation_list":
      if (resolveCitationEntries(props.block, props.sourceLookup).length === 0) {
        return null;
      }
      return <ArtifactCitationList {...props} />;
    case "image":
      return <ArtifactImageBlock {...props} />;
    case "code_block":
      if (
        !normalizeText(props.block.code) &&
        !normalizeText(resolveRecord(props.block)?.content) &&
        !resolvePortableRichText(resolveRecord(props.block)?.content)
      ) {
        return null;
      }
      return <ArtifactCodeBlockRenderer {...props} />;
    case "divider":
      return <ArtifactDivider tone={props.tone} />;
    default:
      return null;
  }
}

function renderBlockFallback(
  block: ArtifactDocumentBlock,
  tone: ArtifactDocumentTone,
): React.ReactNode {
  switch (BLOCK_FALLBACKS[block.type]) {
    case "rich_text": {
      const content = resolveFallbackRichText(block);
      if (!content) {
        return null;
      }
      return <ArtifactRichTextSurface content={content} tone={tone} />;
    }
    case "plain_text": {
      const content = resolveFallbackPlainText(block);
      if (!content) {
        return null;
      }
      return <ArtifactPlainTextFallback content={content} tone={tone} />;
    }
    case "placeholder":
      return <ArtifactImagePlaceholder block={block} tone={tone} />;
    case "delete":
    default:
      return null;
  }
}

export const ArtifactDocumentBlockRenderer = memo(
  function ArtifactDocumentBlockRenderer(
    props: ArtifactDocumentBlockComponentProps,
  ) {
    const content = renderBlockContent(props);
    const fallback = renderBlockFallback(props.block, props.tone);

    if (content === null) {
      return fallback;
    }

    return (
      <ArtifactDocumentBlockBoundary
        fallback={fallback}
        resetKey={JSON.stringify(props.block)}
      >
        {content}
      </ArtifactDocumentBlockBoundary>
    );
  },
);
