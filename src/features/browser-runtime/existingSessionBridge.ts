import type { ChromeBridgePageInfo } from "@/lib/webview-api";

export type ExistingSessionTabRecord = {
  id: string;
  index: number;
  title: string;
  url: string;
  active: boolean;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseExistingSessionTabs(
  data: unknown,
): ExistingSessionTabRecord[] {
  let rawTabs: unknown[] = [];

  if (isObjectRecord(data) && Array.isArray(data.tabs)) {
    rawTabs = data.tabs;
  } else if (
    isObjectRecord(data) &&
    isObjectRecord(data.data) &&
    Array.isArray(data.data.tabs)
  ) {
    rawTabs = data.data.tabs;
  }

  return rawTabs
    .map((item) => {
      if (!isObjectRecord(item)) {
        return null;
      }
      const idValue = item.id;
      if (
        typeof idValue !== "string" &&
        typeof idValue !== "number" &&
        typeof idValue !== "bigint"
      ) {
        return null;
      }
      return {
        id: String(idValue),
        index: typeof item.index === "number" ? item.index : 0,
        title: typeof item.title === "string" ? item.title : "",
        url: typeof item.url === "string" ? item.url : "",
        active: item.active === true,
      };
    })
    .filter((item): item is ExistingSessionTabRecord => item !== null)
    .sort((left, right) => left.index - right.index);
}

export function parseExistingSessionPageInfo(
  data: unknown,
): ChromeBridgePageInfo | null {
  let candidate = data;

  if (isObjectRecord(data) && isObjectRecord(data.page_info)) {
    candidate = data.page_info;
  } else if (
    isObjectRecord(data) &&
    isObjectRecord(data.data) &&
    isObjectRecord(data.data.page_info)
  ) {
    candidate = data.data.page_info;
  }

  if (!isObjectRecord(candidate)) {
    return null;
  }

  const markdown =
    typeof candidate.markdown === "string" ? candidate.markdown : "";
  const updatedAt =
    typeof candidate.updated_at === "string" ? candidate.updated_at : "";

  if (!markdown && !updatedAt) {
    return null;
  }

  return {
    title: typeof candidate.title === "string" ? candidate.title : "",
    url: typeof candidate.url === "string" ? candidate.url : "",
    markdown,
    updated_at: updatedAt,
  };
}

export function shouldReplaceExistingSessionPageInfo(
  current: ChromeBridgePageInfo | null,
  next: ChromeBridgePageInfo,
) {
  if (!current) {
    return true;
  }

  const nextTime = Date.parse(next.updated_at);
  const currentTime = Date.parse(current.updated_at);

  if (Number.isFinite(nextTime) && Number.isFinite(currentTime)) {
    return nextTime >= currentTime;
  }

  if (!current.updated_at && next.updated_at) {
    return true;
  }

  if (current.updated_at && !next.updated_at) {
    return false;
  }

  return (
    next.title !== current.title ||
    next.url !== current.url ||
    next.markdown !== current.markdown
  );
}

export function getExistingSessionTabLabel(
  tab: ExistingSessionTabRecord,
): string {
  return tab.title || tab.url || `标签页 ${tab.index + 1}`;
}
