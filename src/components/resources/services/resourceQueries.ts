import type { ResourceItem } from "./types";

export type ResourceViewCategory =
  | "all"
  | "document"
  | "image"
  | "audio"
  | "video";

export type ResourceSortField = "updatedAt" | "createdAt" | "name";

export type ResourceSortDirection = "asc" | "desc";

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "ico",
  "heic",
]);

const audioExtensions = new Set(["mp3", "wav", "aac", "m4a", "ogg", "flac"]);

const videoExtensions = new Set(["mp4", "mov", "avi", "mkv", "webm", "flv"]);

function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  if (index < 0 || index === filename.length - 1) {
    return "";
  }
  return filename.slice(index + 1).toLowerCase();
}

function matchFolderScope(
  item: ResourceItem,
  currentFolderId: string | null,
): boolean {
  if (item.kind === "file") {
    return currentFolderId === null;
  }
  return (item.parentId ?? null) === currentFolderId;
}

export function getResourceMediaType(
  item: ResourceItem,
): "image" | "audio" | "video" | null {
  if (item.kind !== "file") return null;

  const normalizedMimeType = item.mimeType?.toLowerCase() ?? "";
  if (normalizedMimeType.startsWith("image/")) return "image";
  if (normalizedMimeType.startsWith("audio/")) return "audio";
  if (normalizedMimeType.startsWith("video/")) return "video";

  const normalizedFileType = item.fileType?.toLowerCase() ?? "";
  if (normalizedFileType === "image") return "image";
  if (normalizedFileType === "audio") return "audio";
  if (normalizedFileType === "video") return "video";

  const extension = getFileExtension(item.filePath || item.name);
  if (imageExtensions.has(extension)) return "image";
  if (audioExtensions.has(extension)) return "audio";
  if (videoExtensions.has(extension)) return "video";

  return null;
}

export function matchResourceCategory(
  item: ResourceItem,
  category: ResourceViewCategory,
): boolean {
  if (category === "all") return true;

  const mediaType = getResourceMediaType(item);
  if (category === "image") return mediaType === "image";
  if (category === "audio") return mediaType === "audio";
  if (category === "video") return mediaType === "video";

  if (item.kind === "document") return true;
  if (item.kind !== "file") return false;
  return mediaType === null;
}

export function matchResourceSearch(
  item: ResourceItem,
  keyword: string,
): boolean {
  if (!keyword) return true;

  const normalizedKeyword = keyword.toLowerCase();
  if (item.name.toLowerCase().includes(normalizedKeyword)) {
    return true;
  }

  if (item.description?.toLowerCase().includes(normalizedKeyword)) {
    return true;
  }

  if (item.tags?.some((tag) => tag.toLowerCase().includes(normalizedKeyword))) {
    return true;
  }

  return false;
}

export function compareResourcesBySortField(
  a: ResourceItem,
  b: ResourceItem,
  field: ResourceSortField,
  direction: ResourceSortDirection,
): number {
  let compareValue = 0;

  if (field === "name") {
    compareValue = a.name.localeCompare(b.name, "zh-CN");
  } else if (field === "createdAt") {
    compareValue = a.createdAt - b.createdAt;
  } else {
    compareValue = a.updatedAt - b.updatedAt;
  }

  return direction === "asc" ? compareValue : -compareValue;
}

export function sortResources(
  resources: ResourceItem[],
  field: ResourceSortField,
  direction: ResourceSortDirection,
  options?: { foldersFirst?: boolean },
): ResourceItem[] {
  const foldersFirst = options?.foldersFirst ?? false;

  return [...resources].sort((a, b) => {
    if (foldersFirst) {
      if (a.kind === "folder" && b.kind !== "folder") return -1;
      if (a.kind !== "folder" && b.kind === "folder") return 1;
    }

    return compareResourcesBySortField(a, b, field, direction);
  });
}

export function getFolderScopedResources(
  items: ResourceItem[],
  currentFolderId: string | null,
  searchQuery: string,
  sortField: ResourceSortField,
  sortDirection: ResourceSortDirection,
): ResourceItem[] {
  const scopedItems = items.filter((item) =>
    matchFolderScope(item, currentFolderId),
  );
  const searchedItems = scopedItems.filter((item) =>
    matchResourceSearch(item, searchQuery),
  );
  return sortResources(searchedItems, sortField, sortDirection, {
    foldersFirst: true,
  });
}

export function getCurrentFolder(
  items: ResourceItem[],
  currentFolderId: string | null,
): ResourceItem | null {
  if (!currentFolderId) {
    return null;
  }

  return items.find((item) => item.id === currentFolderId) ?? null;
}

export function getFolderBreadcrumbs(
  items: ResourceItem[],
  currentFolderId: string | null,
): ResourceItem[] {
  const folderMap = new Map(
    items
      .filter((item) => item.kind === "folder")
      .map((item) => [item.id, item]),
  );
  const breadcrumbs: ResourceItem[] = [];
  let pointer = currentFolderId;

  while (pointer) {
    const folder = folderMap.get(pointer);
    if (!folder) break;
    breadcrumbs.push(folder);
    pointer = folder.parentId;
  }

  return breadcrumbs.reverse();
}

export function canNavigateResourceFolderUp(
  currentFolderId: string | null,
): boolean {
  return currentFolderId !== null;
}

export function getCategoryScopedResources(
  items: ResourceItem[],
  category: ResourceViewCategory,
  searchQuery: string,
  sortField: ResourceSortField,
  sortDirection: ResourceSortDirection,
): ResourceItem[] {
  const filteredByCategory = items.filter((item) =>
    matchResourceCategory(item, category),
  );
  const searchedItems = filteredByCategory.filter((item) =>
    matchResourceSearch(item, searchQuery),
  );
  return sortResources(searchedItems, sortField, sortDirection);
}

export function getCategoryCounts(
  items: ResourceItem[],
): Record<ResourceViewCategory, number> {
  const counts: Record<ResourceViewCategory, number> = {
    all: items.length,
    document: 0,
    image: 0,
    audio: 0,
    video: 0,
  };

  for (const item of items) {
    if (matchResourceCategory(item, "document")) {
      counts.document += 1;
    }
    if (matchResourceCategory(item, "image")) {
      counts.image += 1;
    }
    if (matchResourceCategory(item, "audio")) {
      counts.audio += 1;
    }
    if (matchResourceCategory(item, "video")) {
      counts.video += 1;
    }
  }

  return counts;
}
