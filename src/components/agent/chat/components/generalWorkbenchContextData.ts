export interface GeneralWorkbenchContextItem {
  id: string;
  name: string;
  source: "material" | "content" | "search";
  searchMode?: "web" | "social";
  query?: string;
  previewText?: string;
  citations?: Array<{ title: string; url: string }>;
  createdAt?: number;
  active: boolean;
}

export interface GeneralWorkbenchContextBudget {
  activeCount: number;
  activeCountLimit: number;
  estimatedTokens: number;
  tokenLimit: number;
}

export function buildGeneralWorkbenchActiveContextItems(
  contextItems: GeneralWorkbenchContextItem[],
): GeneralWorkbenchContextItem[] {
  return contextItems.filter((item) => item.active);
}

export function buildGeneralWorkbenchSearchContextItems(
  contextItems: GeneralWorkbenchContextItem[],
): GeneralWorkbenchContextItem[] {
  return contextItems.filter((item) => item.source === "search");
}

export function buildGeneralWorkbenchOrderedContextItems(
  contextItems: GeneralWorkbenchContextItem[],
): GeneralWorkbenchContextItem[] {
  return [...contextItems].sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    if (left.source !== right.source) {
      return left.source === "search" ? -1 : 1;
    }
    const createdDelta = (right.createdAt || 0) - (left.createdAt || 0);
    if (createdDelta !== 0) {
      return createdDelta;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });
}

export function resolveGeneralWorkbenchLatestSearchLabel(
  searchContextItems: GeneralWorkbenchContextItem[],
): string {
  if (searchContextItems.length === 0) {
    return "尚未联网检索";
  }

  const createdAt = searchContextItems[0]?.createdAt;
  if (!createdAt || !Number.isFinite(createdAt)) {
    return `已生成 ${searchContextItems.length} 条结果`;
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return `已生成 ${searchContextItems.length} 条结果`;
  }

  return `最近检索 ${date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function resolveGeneralWorkbenchSelectedSearchResult(
  searchContextItems: GeneralWorkbenchContextItem[],
  selectedSearchResultId: string | null,
): GeneralWorkbenchContextItem | null {
  if (!selectedSearchResultId) {
    return null;
  }
  return (
    searchContextItems.find((item) => item.id === selectedSearchResultId) ||
    null
  );
}
