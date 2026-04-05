import { safeInvoke } from "@/lib/dev-bridge";

const FALLBACK_SUMMARY_LENGTH = 420;

export type ThemeContextSearchMode = "web" | "social";

export interface SearchCitation {
  title: string;
  url: string;
}

export interface ThemeContextSearchResult {
  title: string;
  summary: string;
  citations: SearchCitation[];
  rawResponse: string;
  attemptsSummary?: string;
}

interface SearchThemeContextOptions {
  workspaceId: string;
  projectId?: string;
  providerType: string;
  model: string;
  query: string;
  mode: ThemeContextSearchMode;
}

interface ParsedSearchResultPayload {
  title?: string;
  summary?: string;
  citations?: SearchCitation[];
}

interface ThemeContextSearchCommandResponse {
  title?: string;
  summary?: string;
  citations?: SearchCitation[];
  rawResponse?: string;
  attemptsSummary?: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripCodeFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonObject(rawResponse: string): ParsedSearchResultPayload | null {
  const trimmed = rawResponse.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1]);
  }

  const jsonBlockMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonBlockMatch?.[0]) {
    candidates.unshift(jsonBlockMatch[0]);
  }

  for (const candidate of candidates) {
    const normalized = stripCodeFence(candidate);
    try {
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      const citationsRaw = Array.isArray(parsed.citations)
        ? parsed.citations
        : Array.isArray(parsed.sources)
          ? parsed.sources
          : [];
      const citations = citationsRaw
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const record = item as Record<string, unknown>;
          const url = typeof record.url === "string" ? record.url.trim() : "";
          const title =
            typeof record.title === "string"
              ? normalizeWhitespace(record.title)
              : typeof record.name === "string"
                ? normalizeWhitespace(record.name)
                : "";
          if (!url) {
            return null;
          }
          return {
            title: title || buildCitationTitleFromUrl(url),
            url,
          } satisfies SearchCitation;
        })
        .filter((item): item is SearchCitation => Boolean(item));

      return {
        title:
          typeof parsed.title === "string"
            ? normalizeWhitespace(parsed.title)
            : undefined,
        summary:
          typeof parsed.summary === "string"
            ? normalizeWhitespace(parsed.summary)
            : typeof parsed.content === "string"
              ? normalizeWhitespace(parsed.content)
              : undefined,
        citations,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function sanitizeUrl(url: string): string {
  return url.replace(/[),.;!?]+$/g, "").trim();
}

function buildCitationTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "来源链接";
  }
}

function extractCitationsFromText(rawResponse: string): SearchCitation[] {
  const citations: SearchCitation[] = [];
  const seenUrls = new Set<string>();

  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of rawResponse.matchAll(markdownLinkRegex)) {
    const url = sanitizeUrl(match[2] || "");
    const title = normalizeWhitespace(match[1] || "");
    if (!url || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    citations.push({
      title: title || buildCitationTitleFromUrl(url),
      url,
    });
  }

  const plainUrlRegex = /https?:\/\/[^\s)\]]+/g;
  for (const match of rawResponse.matchAll(plainUrlRegex)) {
    const url = sanitizeUrl(match[0] || "");
    if (!url || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    citations.push({
      title: buildCitationTitleFromUrl(url),
      url,
    });
  }

  return citations.slice(0, 5);
}

function buildFallbackSummary(rawResponse: string): string {
  const normalized = normalizeWhitespace(
    stripCodeFence(rawResponse)
      .replace(/"citations"\s*:\s*\[[\s\S]*?\]/g, "")
      .replace(/[{}[\]"]+/g, " "),
  );

  if (!normalized) {
    return "暂无可用摘要，请重新尝试检索。";
  }

  if (normalized.length <= FALLBACK_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, FALLBACK_SUMMARY_LENGTH)}...`;
}

function buildFallbackTitle(
  query: string,
  mode: ThemeContextSearchMode,
): string {
  const suffix = mode === "social" ? "专题搜索上下文" : "网络搜索上下文";
  return `${query.trim()} · ${suffix}`;
}

export function normalizeSearchContextResult(
  rawResponse: string,
  query: string,
  mode: ThemeContextSearchMode,
): ThemeContextSearchResult {
  const parsed = parseJsonObject(rawResponse);
  const citations =
    parsed?.citations && parsed.citations.length > 0
      ? parsed.citations.slice(0, 5)
      : extractCitationsFromText(rawResponse);

  return {
    title: parsed?.title || buildFallbackTitle(query, mode),
    summary: parsed?.summary || buildFallbackSummary(rawResponse),
    citations,
    rawResponse,
  };
}

function normalizeCommandResult(
  payload: ThemeContextSearchCommandResponse,
  query: string,
  mode: ThemeContextSearchMode,
): ThemeContextSearchResult {
  const normalizedRawResponse = payload.rawResponse?.trim() || "";
  const fallback = normalizedRawResponse
    ? normalizeSearchContextResult(normalizedRawResponse, query, mode)
    : null;

  return {
    title: normalizeWhitespace(payload.title || "") || fallback?.title || buildFallbackTitle(query, mode),
    summary:
      normalizeWhitespace(payload.summary || "") ||
      fallback?.summary ||
      buildFallbackSummary(normalizedRawResponse || query),
    citations:
      Array.isArray(payload.citations) && payload.citations.length > 0
        ? payload.citations.slice(0, 5)
        : fallback?.citations || [],
    rawResponse: normalizedRawResponse || fallback?.rawResponse || "",
    attemptsSummary: payload.attemptsSummary,
  };
}

export async function searchThemeContextWithWebSearch({
  workspaceId,
  projectId,
  providerType,
  model,
  query,
  mode,
}: SearchThemeContextOptions): Promise<ThemeContextSearchResult> {
  const trimmedWorkspaceId = workspaceId.trim();
  const trimmedProviderType = providerType.trim();
  const trimmedModel = model.trim();
  const trimmedQuery = query.trim();

  if (!trimmedWorkspaceId) {
    throw new Error("缺少 workspaceId，无法执行上下文搜索");
  }
  if (!trimmedProviderType || !trimmedModel) {
    throw new Error("当前未选择可用模型，无法执行上下文搜索");
  }
  if (!trimmedQuery) {
    throw new Error("搜索词不能为空");
  }

  const payload = await safeInvoke<ThemeContextSearchCommandResponse>(
    "aster_agent_theme_context_search",
    {
      request: {
        workspaceId: trimmedWorkspaceId,
        projectId: projectId?.trim() || undefined,
        providerType: trimmedProviderType,
        model: trimmedModel,
        query: trimmedQuery,
        mode,
      },
    },
  );

  const result = normalizeCommandResult(payload || {}, trimmedQuery, mode);
  if (!result.summary.trim()) {
    throw new Error("上下文搜索未返回可用内容，请重试");
  }
  return result;
}
