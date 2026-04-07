export interface SearchResultPreviewItem {
  id: string;
  title: string;
  url: string;
  hostname: string;
  snippet?: string;
}

const URL_PATTERN_SOURCE = String.raw`\bhttps?:\/\/[^\s<>"'\`]+`;
const URL_TRAILING_PUNCTUATION = /[),.;!?]+$/;
const SEARCH_MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export const SEARCH_RESULT_LIST_LIMIT = 10;

function createUrlPattern(): RegExp {
  return new RegExp(URL_PATTERN_SOURCE, "gi");
}

function normalizeUrlCandidate(rawUrl: string): {
  url: string;
  trailing: string;
} {
  const normalized = rawUrl.replace(URL_TRAILING_PUNCTUATION, "");
  return {
    url: normalized || rawUrl,
    trailing: rawUrl.slice((normalized || rawUrl).length),
  };
}

function findFirstUrl(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const match = value.match(createUrlPattern());
    if (!match || match.length === 0) {
      continue;
    }
    return normalizeUrlCandidate(match[0]).url;
  }
  return undefined;
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .replace(/^[\s>*•·\-–—\d().:：\]]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getHostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractSearchResultFromRecord(
  record: Record<string, unknown>,
  index: number,
): SearchResultPreviewItem | null {
  const url =
    (typeof record.url === "string" && record.url.trim()) ||
    (typeof record.link === "string" && record.link.trim()) ||
    (typeof record.href === "string" && record.href.trim()) ||
    (typeof record.sourceUrl === "string" && record.sourceUrl.trim()) ||
    (typeof record.source_url === "string" && record.source_url.trim()) ||
    "";
  if (!url) {
    return null;
  }

  const title =
    (typeof record.title === "string" && normalizeSearchText(record.title)) ||
    (typeof record.name === "string" && normalizeSearchText(record.name)) ||
    (typeof record.headline === "string" &&
      normalizeSearchText(record.headline)) ||
    getHostnameFromUrl(url);
  const snippet =
    (typeof record.summary === "string" &&
      normalizeSearchText(record.summary)) ||
    (typeof record.snippet === "string" &&
      normalizeSearchText(record.snippet)) ||
    (typeof record.description === "string" &&
      normalizeSearchText(record.description)) ||
    (typeof record.content === "string" &&
      normalizeSearchText(record.content)) ||
    (typeof record.preview === "string" &&
      normalizeSearchText(record.preview)) ||
    (typeof record.text === "string" && normalizeSearchText(record.text)) ||
    undefined;

  return {
    id: `search-record-${index}-${url}`,
    title,
    url,
    hostname: getHostnameFromUrl(url),
    snippet: snippet || undefined,
  };
}

function parseSearchResultRecords(rawText: string): SearchResultPreviewItem[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  const candidates = [trimmed];
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1]);
  }

  const seenUrls = new Set<string>();
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const queue: unknown[] = [parsed];
      const entries: SearchResultPreviewItem[] = [];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }

        if (Array.isArray(current)) {
          queue.push(...current);
          continue;
        }

        if (typeof current !== "object") {
          continue;
        }

        const record = current as Record<string, unknown>;
        const extracted = extractSearchResultFromRecord(record, entries.length);
        if (extracted && !seenUrls.has(extracted.url)) {
          seenUrls.add(extracted.url);
          entries.push(extracted);
          if (entries.length >= SEARCH_RESULT_LIST_LIMIT) {
            return entries;
          }
        }

        for (const key of [
          "results",
          "items",
          "sources",
          "citations",
          "data",
        ]) {
          const nested = record[key];
          if (nested) {
            queue.push(nested);
          }
        }
      }

      if (entries.length > 0) {
        return entries;
      }
    } catch {
      continue;
    }
  }

  return [];
}

function parseSearchResultText(rawText: string): SearchResultPreviewItem[] {
  const normalizedText = rawText.trim();
  if (!normalizedText) {
    return [];
  }

  const entries: SearchResultPreviewItem[] = [];
  const seenUrls = new Set<string>();

  for (const match of normalizedText.matchAll(SEARCH_MARKDOWN_LINK_RE)) {
    const url = normalizeUrlCandidate(match[2] || "").url;
    if (!url || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    entries.push({
      id: `search-markdown-${entries.length}-${url}`,
      title: normalizeSearchText(match[1] || "") || getHostnameFromUrl(url),
      url,
      hostname: getHostnameFromUrl(url),
    });
    if (entries.length >= SEARCH_RESULT_LIST_LIMIT) {
      return entries;
    }
  }

  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index];
    const url = findFirstUrl(currentLine);
    if (!url || seenUrls.has(url)) {
      continue;
    }

    let title = normalizeSearchText(currentLine.replace(url, ""));
    if (!title && index > 0) {
      const previousLine = normalizeSearchText(lines[index - 1] || "");
      if (previousLine && !findFirstUrl(previousLine)) {
        title = previousLine;
      }
    }

    const snippetLines: string[] = [];
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = normalizeSearchText(lines[nextIndex] || "");
      if (!nextLine || findFirstUrl(nextLine)) {
        break;
      }
      snippetLines.push(nextLine);
      if (snippetLines.length >= 2 || snippetLines.join(" ").length >= 180) {
        break;
      }
    }

    seenUrls.add(url);
    entries.push({
      id: `search-text-${entries.length}-${url}`,
      title: title || getHostnameFromUrl(url),
      url,
      hostname: getHostnameFromUrl(url),
      snippet: snippetLines.join(" ").trim() || undefined,
    });

    if (entries.length >= SEARCH_RESULT_LIST_LIMIT) {
      break;
    }
  }

  if (entries.length > 0) {
    return entries;
  }

  for (const match of normalizedText.matchAll(createUrlPattern())) {
    const url = normalizeUrlCandidate(match[0] || "").url;
    if (!url || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    entries.push({
      id: `search-url-${entries.length}-${url}`,
      title: getHostnameFromUrl(url),
      url,
      hostname: getHostnameFromUrl(url),
    });
    if (entries.length >= SEARCH_RESULT_LIST_LIMIT) {
      break;
    }
  }

  return entries;
}

export function resolveSearchResultPreviewItemsFromText(
  rawText?: string | null,
): SearchResultPreviewItem[] {
  const normalizedText = rawText?.trim();
  if (!normalizedText) {
    return [];
  }

  const structuredEntries = parseSearchResultRecords(normalizedText);
  if (structuredEntries.length > 0) {
    return structuredEntries;
  }

  return parseSearchResultText(normalizedText);
}

export function isUnifiedWebSearchToolName(toolName: string): boolean {
  return (
    toolName
      .replace(/[\s_-]+/g, "")
      .trim()
      .toLowerCase() === "websearch"
  );
}
