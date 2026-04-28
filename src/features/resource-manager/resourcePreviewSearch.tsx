import type { ReactNode } from "react";

interface HighlightedPreviewTextOptions {
  activeIndex?: number;
  matchIndexOffset?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizePreviewSearchQuery(value: string): string {
  return value.trim();
}

export function countPreviewSearchMatches(
  content: string,
  query: string,
): number {
  const normalizedQuery = normalizePreviewSearchQuery(query);
  if (!normalizedQuery) return 0;

  const pattern = new RegExp(escapeRegExp(normalizedQuery), "gi");
  return Array.from(content.matchAll(pattern)).length;
}

export function renderHighlightedPreviewText(
  content: string,
  query: string,
  options: HighlightedPreviewTextOptions = {},
): ReactNode {
  const normalizedQuery = normalizePreviewSearchQuery(query);
  if (!normalizedQuery) return content;

  const pattern = new RegExp(escapeRegExp(normalizedQuery), "gi");
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;
  const matchIndexOffset = options.matchIndexOffset ?? 0;

  for (const match of content.matchAll(pattern)) {
    const matchText = match[0];
    const index = match.index ?? 0;
    const globalMatchIndex = matchIndexOffset + matchIndex;
    const isActive = globalMatchIndex === options.activeIndex;
    if (index > lastIndex) {
      nodes.push(content.slice(lastIndex, index));
    }
    nodes.push(
      <mark
        key={`${index}-${matchIndex}`}
        data-testid="resource-preview-search-hit"
        data-resource-preview-search-active={isActive ? "true" : undefined}
        className={
          isActive
            ? "rounded bg-[#13c95b] px-0.5 text-white ring-2 ring-[#13c95b]/25"
            : "rounded bg-yellow-200 px-0.5 text-slate-950"
        }
      >
        {matchText}
      </mark>,
    );
    lastIndex = index + matchText.length;
    matchIndex += 1;
  }

  if (matchIndex === 0) return content;
  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }
  return nodes;
}
