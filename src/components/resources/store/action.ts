import { create } from "zustand";
import { toast } from "sonner";
import {
  createDocumentResource,
  createFolderResource,
  deleteSingleResource,
  fetchProjectResources,
  moveContentResource,
  renameResource,
  uploadFileResource,
} from "../services/resourceAdapter";
import type { ResourceItem } from "../services/types";
import {
  initialState,
  type ResourceSortDirection,
  type ResourceSortField,
  type ResourcesState,
} from "./initialState";

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const collectContentTreeForDelete = (
  items: ResourceItem[],
  root: ResourceItem,
): ResourceItem[] => {
  const result: ResourceItem[] = [];

  const visit = (node: ResourceItem) => {
    const children = items.filter(
      (item) => item.sourceType === "content" && item.parentId === node.id,
    );
    for (const child of children) {
      visit(child);
    }
    result.push(node);
  };

  visit(root);
  return result;
};

export interface ResourcesActions {
  setProjectId: (projectId: string | null) => void;
  loadResources: () => Promise<void>;
  refresh: () => Promise<void>;
  setCurrentFolderId: (folderId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setSortField: (field: ResourceSortField) => void;
  setSortDirection: (direction: ResourceSortDirection) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelectedId: (id: string) => void;
  clearSelection: () => void;
  createFolder: (name: string) => Promise<void>;
  createDocument: (name: string) => Promise<void>;
  uploadFile: (filePath: string) => Promise<void>;
  renameById: (id: string, name: string) => Promise<void>;
  deleteById: (id: string) => Promise<void>;
  moveToRoot: (id: string) => Promise<void>;
}

export type ResourcesStore = ResourcesState & ResourcesActions;

export const useResourcesStore = create<ResourcesStore>((set, get) => ({
  ...initialState,

  setProjectId: (projectId) => {
    set({
      projectId,
      currentFolderId: null,
      selectedIds: [],
      searchQuery: "",
      error: null,
      items: [],
    });
  },

  loadResources: async () => {
    const { projectId, currentFolderId } = get();
    if (!projectId) {
      set({ items: [], loading: false, error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const items = await fetchProjectResources(projectId);
      const hasCurrentFolder =
        !currentFolderId ||
        items.some(
          (item) => item.id === currentFolderId && item.kind === "folder",
        );
      set({
        items,
        loading: false,
        currentFolderId: hasCurrentFolder ? currentFolderId : null,
      });
    } catch (error) {
      set({
        loading: false,
        error: toErrorMessage(error),
      });
    }
  },

  refresh: async () => {
    await get().loadResources();
  },

  setCurrentFolderId: (currentFolderId) => {
    set({ currentFolderId, selectedIds: [] });
  },

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
  },

  setSortField: (sortField) => {
    set({ sortField });
  },

  setSortDirection: (sortDirection) => {
    set({ sortDirection });
  },

  setSelectedIds: (selectedIds) => {
    set({ selectedIds });
  },

  toggleSelectedId: (id) => {
    const selectedIds = get().selectedIds;
    if (selectedIds.includes(id)) {
      set({ selectedIds: selectedIds.filter((itemId) => itemId !== id) });
      return;
    }
    set({ selectedIds: [...selectedIds, id] });
  },

  clearSelection: () => {
    set({ selectedIds: [] });
  },

  createFolder: async (name) => {
    const { projectId, currentFolderId } = get();
    if (!projectId) return;

    set({ saving: true, error: null });
    try {
      await createFolderResource(projectId, name, currentFolderId);
      await get().loadResources();
      toast.success("文件夹创建成功");
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      toast.error(message);
    } finally {
      set({ saving: false });
    }
  },

  createDocument: async (name) => {
    const { projectId, currentFolderId } = get();
    if (!projectId) return;

    set({ saving: true, error: null });
    try {
      await createDocumentResource(projectId, name, currentFolderId);
      await get().loadResources();
      toast.success("文档创建成功");
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      toast.error(message);
    } finally {
      set({ saving: false });
    }
  },

  uploadFile: async (filePath) => {
    const { projectId } = get();
    if (!projectId) return;

    set({ saving: true, error: null });
    try {
      await uploadFileResource(projectId, filePath);
      await get().loadResources();
      toast.success("文件上传成功");
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      toast.error(message);
    } finally {
      set({ saving: false });
    }
  },

  renameById: async (id, name) => {
    const target = get().items.find((item) => item.id === id);
    if (!target) return;

    set({ saving: true, error: null });
    try {
      await renameResource(target, name);
      await get().loadResources();
      toast.success("重命名成功");
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      toast.error(message);
    } finally {
      set({ saving: false });
    }
  },

  deleteById: async (id) => {
    const { items } = get();
    const target = items.find((item) => item.id === id);
    if (!target) return;

    set({ saving: true, error: null });
    try {
      if (target.kind === "folder" && target.sourceType === "content") {
        const tree = collectContentTreeForDelete(items, target);
        for (const node of tree) {
          await deleteSingleResource(node);
        }
      } else {
        await deleteSingleResource(target);
      }

      if (get().currentFolderId === target.id) {
        set({ currentFolderId: target.parentId ?? null });
      }

      await get().loadResources();
      toast.success("删除成功");
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      toast.error(message);
    } finally {
      set({ saving: false });
    }
  },

  moveToRoot: async (id) => {
    const target = get().items.find((item) => item.id === id);
    if (!target || target.sourceType !== "content") return;

    set({ saving: true, error: null });
    try {
      await moveContentResource(target, null);
      await get().loadResources();
      toast.success("已移动到根目录");
    } catch (error) {
      const message = toErrorMessage(error);
      set({ error: message });
      toast.error(message);
    } finally {
      set({ saving: false });
    }
  },
}));
