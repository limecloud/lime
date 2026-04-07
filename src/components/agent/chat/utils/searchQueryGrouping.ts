export interface SearchQuerySemantic {
  key: string;
  label: string;
}

export interface SearchQuerySemanticSummary extends SearchQuerySemantic {
  count: number;
}

const CJK_RE = /[\u4e00-\u9fff]/;
const ZH_DATE_RE = /\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日/;
const EN_DATE_RE =
  /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b|\b\d{4}-\d{1,2}-\d{1,2}\b/i;
const HEADLINE_RE = /头条|要闻|快讯|headlines?|roundup|briefing|digest|brief/i;

export function classifySearchQuerySemantic(
  query?: string | null,
): SearchQuerySemantic {
  const normalized = query?.trim() || "";
  const hasCjk = CJK_RE.test(normalized);
  const hasZhDate = ZH_DATE_RE.test(normalized);
  const hasEnDate = EN_DATE_RE.test(normalized);
  const hasHeadlineHint = HEADLINE_RE.test(normalized);

  if (hasHeadlineHint) {
    return { key: "headlines", label: "头条检索" };
  }
  if (hasCjk && hasZhDate) {
    return { key: "zh_date", label: "中文日期检索" };
  }
  if (!hasCjk && hasEnDate) {
    return { key: "en_date", label: "英文日期检索" };
  }
  if (hasCjk) {
    return { key: "zh_general", label: "中文检索" };
  }
  return { key: "en_general", label: "英文检索" };
}

export function summarizeSearchQuerySemantics(
  queries: Array<string | null | undefined>,
): SearchQuerySemanticSummary[] {
  const counts = new Map<string, SearchQuerySemanticSummary>();

  for (const query of queries) {
    const semantic = classifySearchQuerySemantic(query);
    const existing = counts.get(semantic.key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(semantic.key, { ...semantic, count: 1 });
  }

  return Array.from(counts.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}
