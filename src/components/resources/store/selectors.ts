import type { ResourceItem } from "../services/types";
import type { ResourcesStore } from "./action";
import type { ResourceSortDirection, ResourceSortField } from "./initialState";

const createCachedSelector = <T>(
  selector: (state: ResourcesStore) => T,
): ((state: ResourcesStore) => T) => {
  let lastState: ResourcesStore | null = null;
  let lastResult: T;

  return (state: ResourcesStore): T => {
    if (lastState === state) {
      return lastResult;
    }

    const result = selector(state);
    lastState = state;
    lastResult = result;
    return result;
  };
};

const compareBySortField = (
  a: ResourceItem,
  b: ResourceItem,
  field: ResourceSortField,
  direction: ResourceSortDirection,
): number => {
  let compareValue = 0;

  if (field === "name") {
    compareValue = a.name.localeCompare(b.name, "zh-CN");
  } else if (field === "createdAt") {
    compareValue = a.createdAt - b.createdAt;
  } else {
    compareValue = a.updatedAt - b.updatedAt;
  }

  return direction === "asc" ? compareValue : -compareValue;
};

const matchSearch = (item: ResourceItem, keyword: string): boolean => {
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
};

const matchFolder = (item: ResourceItem, folderId: string | null): boolean => {
  if (item.kind === "file") {
    return folderId === null;
  }
  return (item.parentId ?? null) === folderId;
};

const sortResources = (
  resources: ResourceItem[],
  field: ResourceSortField,
  direction: ResourceSortDirection,
): ResourceItem[] => {
  return [...resources].sort((a, b) => {
    // 文件夹优先
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    return compareBySortField(a, b, field, direction);
  });
};

export const resourcesSelectors = {
  canNavigateUp: (state: ResourcesStore) => state.currentFolderId !== null,

  currentFolder: (state: ResourcesStore) =>
    state.currentFolderId
      ? (state.items.find((item) => item.id === state.currentFolderId) ?? null)
      : null,

  folderBreadcrumbs: createCachedSelector((state: ResourcesStore) => {
    const folderMap = new Map(
      state.items
        .filter((item) => item.kind === "folder")
        .map((item) => [item.id, item]),
    );
    const breadcrumbs: ResourceItem[] = [];
    let pointer = state.currentFolderId;

    while (pointer) {
      const folder = folderMap.get(pointer);
      if (!folder) break;
      breadcrumbs.push(folder);
      pointer = folder.parentId;
    }

    return breadcrumbs.reverse();
  }),

  visibleItems: createCachedSelector((state: ResourcesStore) => {
    const scopedItems = state.items.filter((item) =>
      matchFolder(item, state.currentFolderId),
    );
    const searchedItems = scopedItems.filter((item) =>
      matchSearch(item, state.searchQuery),
    );
    return sortResources(searchedItems, state.sortField, state.sortDirection);
  }),
};
