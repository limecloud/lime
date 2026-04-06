import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowRight,
  ArrowUp,
  Clock3,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Library,
  MoreHorizontal,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProjects } from "@/hooks/useProjects";
import { openPathWithDefaultApp } from "@/lib/api/fileSystem";
import { listMaterials } from "@/lib/api/materials";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
  setStoredResourceProjectId,
} from "@/lib/resourceProjectSelection";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { CanvasBreadcrumbHeader } from "@/lib/workspace/workbenchUi";
import { cn } from "@/lib/utils";
import type { Page, PageParams } from "@/types/page";
import { fetchDocumentDetail } from "./services/resourceAdapter";
import type { ResourceItem } from "./services/types";
import { resourcesSelectors, useResourcesStore } from "./store";

type ResourceViewCategory = "all" | "document" | "image" | "audio" | "video";
type ResourceSortField = "updatedAt" | "createdAt" | "name";
type ResourceSortDirection = "asc" | "desc";

interface ResourcesPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
}

interface ResourceEmptyAction {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  action: () => void;
}

const kindLabelMap: Record<ResourceItem["kind"], string> = {
  folder: "文件夹",
  document: "文档",
  file: "文件",
};

const sourceLabelMap: Record<ResourceItem["sourceType"], string> = {
  content: "内容",
  material: "素材",
};

const resourceCategoryItems: Array<{
  key: ResourceViewCategory;
  label: string;
  icon: typeof FileText;
}> = [
  { key: "all", label: "全部", icon: Library },
  { key: "document", label: "文档", icon: FileText },
  { key: "image", label: "图片", icon: ImageIcon },
  { key: "audio", label: "语音", icon: Music2 },
  { key: "video", label: "视频", icon: Video },
];

const resourceCategoryLabelMap: Record<ResourceViewCategory, string> = {
  all: "全部",
  document: "文档",
  image: "图片",
  audio: "语音",
  video: "视频",
};

const mediaCategoryLabelMap: Record<"image" | "audio" | "video", string> = {
  image: "图片",
  audio: "语音",
  video: "视频",
};

const resourceCategoryIconMap: Record<ResourceViewCategory, LucideIcon> = {
  all: Library,
  document: FileText,
  image: ImageIcon,
  audio: Music2,
  video: Video,
};

const sortFieldLabelMap: Record<ResourceSortField, string> = {
  updatedAt: "更新时间",
  createdAt: "创建时间",
  name: "名称",
};

const sortDirectionLabelMap: Record<ResourceSortDirection, string> = {
  asc: "升序",
  desc: "降序",
};

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

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
  });
};

const getKindIcon = (item: ResourceItem) => {
  if (item.kind === "folder") return Folder;
  if (item.kind === "document") return FileText;
  return File;
};

const getFileExtension = (filename: string): string => {
  const index = filename.lastIndexOf(".");
  if (index < 0 || index === filename.length - 1) {
    return "";
  }
  return filename.slice(index + 1).toLowerCase();
};

const getResourceMediaType = (
  item: ResourceItem,
): "image" | "audio" | "video" | null => {
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
};

const isImageResource = (item: ResourceItem): boolean => {
  return getResourceMediaType(item) === "image";
};

const isAudioResource = (item: ResourceItem): boolean => {
  return getResourceMediaType(item) === "audio";
};

const isVideoResource = (item: ResourceItem): boolean => {
  return getResourceMediaType(item) === "video";
};

const matchResourceCategory = (
  item: ResourceItem,
  category: ResourceViewCategory,
): boolean => {
  if (category === "all") return true;
  if (category === "document") {
    if (item.kind === "document") return true;
    if (item.kind !== "file") return false;
    return (
      !isImageResource(item) && !isAudioResource(item) && !isVideoResource(item)
    );
  }
  if (category === "image") return isImageResource(item);
  if (category === "audio") return isAudioResource(item);
  return isVideoResource(item);
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

const compareBySortField = (
  a: ResourceItem,
  b: ResourceItem,
  field: ResourceSortField,
  direction: ResourceSortDirection,
): number => {
  let value = 0;

  if (field === "name") {
    value = a.name.localeCompare(b.name, "zh-CN");
  } else if (field === "createdAt") {
    value = a.createdAt - b.createdAt;
  } else {
    value = a.updatedAt - b.updatedAt;
  }

  return direction === "asc" ? value : -value;
};

const sortResources = (
  resources: ResourceItem[],
  field: ResourceSortField,
  direction: ResourceSortDirection,
): ResourceItem[] => {
  return [...resources].sort((a, b) =>
    compareBySortField(a, b, field, direction),
  );
};

export function ResourcesPage({ onNavigate }: ResourcesPageProps) {
  const {
    projects,
    defaultProject,
    loading: projectsLoading,
    error: projectError,
  } = useProjects();

  const projectId = useResourcesStore((state) => state.projectId);
  const items = useResourcesStore((state) => state.items);
  const loading = useResourcesStore((state) => state.loading);
  const saving = useResourcesStore((state) => state.saving);
  const error = useResourcesStore((state) => state.error);
  const currentFolderId = useResourcesStore((state) => state.currentFolderId);
  const searchQuery = useResourcesStore((state) => state.searchQuery);
  const sortField = useResourcesStore((state) => state.sortField);
  const sortDirection = useResourcesStore((state) => state.sortDirection);
  const setProjectId = useResourcesStore((state) => state.setProjectId);
  const loadResources = useResourcesStore((state) => state.loadResources);
  const refresh = useResourcesStore((state) => state.refresh);
  const setCurrentFolderId = useResourcesStore(
    (state) => state.setCurrentFolderId,
  );
  const setSearchQuery = useResourcesStore((state) => state.setSearchQuery);
  const setSortField = useResourcesStore((state) => state.setSortField);
  const setSortDirection = useResourcesStore((state) => state.setSortDirection);
  const createFolder = useResourcesStore((state) => state.createFolder);
  const createDocument = useResourcesStore((state) => state.createDocument);
  const uploadFile = useResourcesStore((state) => state.uploadFile);
  const renameById = useResourcesStore((state) => state.renameById);
  const deleteById = useResourcesStore((state) => state.deleteById);
  const moveToRoot = useResourcesStore((state) => state.moveToRoot);

  const visibleItems = useResourcesStore(resourcesSelectors.visibleItems);
  const breadcrumbs = useResourcesStore(resourcesSelectors.folderBreadcrumbs);
  const currentFolder = useResourcesStore(resourcesSelectors.currentFolder);
  const canNavigateUp = useResourcesStore(resourcesSelectors.canNavigateUp);

  const [viewCategory, setViewCategory] = useState<ResourceViewCategory>("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [crossProjectMediaHint, setCrossProjectMediaHint] = useState<{
    projectId: string;
    projectName: string;
    count: number;
    category: "image" | "audio" | "video";
  } | null>(null);

  const availableProjects = useMemo(
    () => projects.filter((project) => !project.isArchived),
    [projects],
  );

  const selectedProject = useMemo(
    () => availableProjects.find((project) => project.id === projectId) ?? null,
    [availableProjects, projectId],
  );

  const categoryCounts = useMemo(
    () => ({
      all: items.length,
      document: items.filter((item) => matchResourceCategory(item, "document"))
        .length,
      image: items.filter((item) => matchResourceCategory(item, "image"))
        .length,
      audio: items.filter((item) => matchResourceCategory(item, "audio"))
        .length,
      video: items.filter((item) => matchResourceCategory(item, "video"))
        .length,
    }),
    [items],
  );

  const isFolderMode = viewCategory === "all";

  const displayItems = useMemo(() => {
    if (isFolderMode) {
      return visibleItems;
    }

    const filteredByCategory = items.filter((item) =>
      matchResourceCategory(item, viewCategory),
    );
    const searchedItems = filteredByCategory.filter((item) =>
      matchSearch(item, searchQuery),
    );

    return sortResources(searchedItems, sortField, sortDirection);
  }, [
    isFolderMode,
    items,
    searchQuery,
    sortDirection,
    sortField,
    viewCategory,
    visibleItems,
  ]);

  useEffect(() => {
    if (projectId || projectsLoading) return;

    const storedProjectId = getStoredResourceProjectId({ includeLegacy: true });
    if (
      storedProjectId &&
      availableProjects.some((project) => project.id === storedProjectId)
    ) {
      setProjectId(storedProjectId);
      return;
    }

    const preferredProject =
      (defaultProject && !defaultProject.isArchived ? defaultProject : null) ??
      availableProjects[0];
    if (!preferredProject) return;

    setProjectId(preferredProject.id);
  }, [
    availableProjects,
    defaultProject,
    projectId,
    projectsLoading,
    setProjectId,
  ]);

  useEffect(() => {
    setStoredResourceProjectId(projectId, {
      source: "resources",
      emitEvent: true,
    });
  }, [projectId]);

  useEffect(() => {
    return onResourceProjectChange((detail) => {
      if (
        detail.source !== "image-gen-target" &&
        detail.source !== "image-gen-save" &&
        detail.source !== "general-chat" &&
        detail.source !== "browser-runtime"
      ) {
        return;
      }

      if (!detail.projectId || detail.projectId === projectId) {
        return;
      }

      if (
        !availableProjects.some((project) => project.id === detail.projectId)
      ) {
        return;
      }

      setProjectId(detail.projectId);
    });
  }, [availableProjects, projectId, setProjectId]);

  useEffect(() => {
    if (!projectId) return;
    void loadResources();
  }, [projectId, loadResources]);

  useEffect(() => {
    if (
      loading ||
      !projectId ||
      (viewCategory !== "image" &&
        viewCategory !== "audio" &&
        viewCategory !== "video")
    ) {
      setCrossProjectMediaHint(null);
      return;
    }

    if (categoryCounts[viewCategory] > 0) {
      setCrossProjectMediaHint(null);
      return;
    }

    const candidateProjects = availableProjects.filter(
      (project) => project.id !== projectId,
    );
    if (candidateProjects.length === 0) {
      setCrossProjectMediaHint(null);
      return;
    }

    let disposed = false;
    void (async () => {
      const results = await Promise.all(
        candidateProjects.map(async (project) => {
          try {
            const materials = await listMaterials(project.id, {
              type: viewCategory,
            });
            return {
              projectId: project.id,
              projectName: project.name,
              count: materials.length,
            };
          } catch {
            return {
              projectId: project.id,
              projectName: project.name,
              count: 0,
            };
          }
        }),
      );

      if (disposed) {
        return;
      }

      const matched = results.find((item) => item.count > 0);
      if (!matched) {
        setCrossProjectMediaHint(null);
        return;
      }

      setCrossProjectMediaHint({
        ...matched,
        category: viewCategory,
      });
    })();

    return () => {
      disposed = true;
    };
  }, [availableProjects, categoryCounts, loading, projectId, viewCategory]);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt("请输入文件夹名称");
    if (!name?.trim()) return;
    await createFolder(name.trim());
  }, [createFolder]);

  const handleCreateDocument = useCallback(async () => {
    const name = window.prompt("请输入文档名称");
    if (!name?.trim()) return;
    await createDocument(name.trim());
  }, [createDocument]);

  const handleUploadFile = useCallback(async () => {
    if (!projectId) return;

    const selected = await open({
      directory: false,
      multiple: false,
      title: "选择上传文件",
    });
    if (!selected || Array.isArray(selected)) return;

    await uploadFile(selected);
  }, [projectId, uploadFile]);

  const handleRename = useCallback(
    async (item: ResourceItem) => {
      const name = window.prompt("请输入新名称", item.name);
      if (!name?.trim() || name.trim() === item.name) return;
      await renameById(item.id, name.trim());
    },
    [renameById],
  );

  const handleDelete = useCallback(
    async (item: ResourceItem) => {
      const confirmed = window.confirm(
        `确定删除「${item.name}」吗？该操作无法撤销。`,
      );
      if (!confirmed) return;
      await deleteById(item.id);
    },
    [deleteById],
  );

  const handleOpenFile = useCallback(async (item: ResourceItem) => {
    if (!item.filePath) {
      toast.error("该文件缺少本地路径，无法打开");
      return;
    }

    try {
      await openPathWithDefaultApp(item.filePath);
    } catch (invokeError) {
      toast.error(
        invokeError instanceof Error
          ? invokeError.message
          : String(invokeError),
      );
    }
  }, []);

  const handleOpenDocument = useCallback(
    async (item: ResourceItem) => {
      if (onNavigate) {
        onNavigate("agent", {
          projectId: item.projectId,
          contentId: item.id,
          lockTheme: true,
          fromResources: true,
        });
        return;
      }

      setPreviewOpen(true);
      setPreviewLoading(true);
      setPreviewTitle(item.name);
      setPreviewContent("");

      try {
        const detail = await fetchDocumentDetail(item.id);
        if (!detail) {
          setPreviewContent("文档不存在或已被删除。");
          return;
        }
        setPreviewTitle(detail.title);
        setPreviewContent(detail.body || "");
      } catch (detailError) {
        setPreviewContent(
          detailError instanceof Error
            ? `读取失败：${detailError.message}`
            : `读取失败：${String(detailError)}`,
        );
      } finally {
        setPreviewLoading(false);
      }
    },
    [onNavigate],
  );

  const handleOpenResource = useCallback(
    async (item: ResourceItem) => {
      if (item.kind === "folder") {
        setCurrentFolderId(item.id);
        return;
      }
      if (item.kind === "document") {
        await handleOpenDocument(item);
        return;
      }
      await handleOpenFile(item);
    },
    [handleOpenDocument, handleOpenFile, setCurrentFolderId],
  );

  const handleNavigateUp = useCallback(() => {
    if (!canNavigateUp) return;
    setCurrentFolderId(currentFolder?.parentId ?? null);
  }, [canNavigateUp, currentFolder?.parentId, setCurrentFolderId]);

  const handleBackHome = useCallback(() => {
    onNavigate?.("agent", buildHomeAgentParams());
  }, [onNavigate]);

  const headingDescription = useMemo(() => {
    if (!projectId) return "请选择左侧资料库";
    if (currentFolderId && currentFolder) {
      return `当前目录：${currentFolder.name}`;
    }
    return `资料库：${selectedProject?.name ?? "未命名项目"}`;
  }, [currentFolder, currentFolderId, projectId, selectedProject?.name]);

  const activeCategoryLabel = resourceCategoryLabelMap[viewCategory];
  const ActiveCategoryIcon = resourceCategoryIconMap[viewCategory];

  const totalFolderCount = useMemo(
    () => items.filter((item) => item.kind === "folder").length,
    [items],
  );

  const latestVisibleUpdateLabel = useMemo(() => {
    if (displayItems.length === 0) {
      return "暂无更新";
    }

    const latestItem = displayItems.reduce((latest, item) =>
      item.updatedAt > latest.updatedAt ? item : latest,
    );
    return formatTime(latestItem.updatedAt);
  }, [displayItems]);

  const currentScopeLabel = useMemo(() => {
    if (!projectId) return "待选择";
    if (!isFolderMode) {
      return activeCategoryLabel;
    }
    return currentFolder?.name ?? "根目录";
  }, [activeCategoryLabel, currentFolder?.name, isFolderMode, projectId]);

  const currentScopeDescription = useMemo(() => {
    if (!projectId) {
      return "先在左侧选择一个项目资料库。";
    }
    if (!isFolderMode) {
      return `跨目录查看当前资料库内的${activeCategoryLabel}内容。`;
    }
    if (currentFolder && breadcrumbs.length > 0) {
      return `路径：根目录 / ${breadcrumbs.map((folder) => folder.name).join(" / ")}`;
    }
    return "当前位于根目录，可继续进入子文件夹浏览。";
  }, [
    activeCategoryLabel,
    breadcrumbs,
    currentFolder,
    isFolderMode,
    projectId,
  ]);

  const contentPanelDescription = useMemo(() => {
    if (!projectId) {
      return "选择资料库后，这里会显示当前项目的文档、素材和目录结构。";
    }
    if (searchQuery.trim()) {
      return `已按“${searchQuery.trim()}”筛选，当前范围内共 ${displayItems.length} 个结果。`;
    }
    if (!isFolderMode) {
      return `当前为${activeCategoryLabel}分类视图，共展示 ${displayItems.length} 个条目。`;
    }
    if (currentFolder) {
      return `当前目录共展示 ${displayItems.length} 个条目，可继续进入子文件夹或直接打开文件。`;
    }
    return `当前位于根目录，共展示 ${displayItems.length} 个条目。`;
  }, [
    activeCategoryLabel,
    currentFolder,
    displayItems.length,
    isFolderMode,
    projectId,
    searchQuery,
  ]);

  const summaryCards = useMemo(
    () => [
      {
        key: "library",
        title: "当前资料库",
        value: selectedProject?.name ?? "未选择",
        description: projectId
          ? `${items.length} 个总条目，${availableProjects.length} 个项目可切换`
          : "先在左侧选择一个项目资料库",
        icon: Library,
        iconClassName: "border-slate-200 bg-slate-100 text-slate-700",
        valueClassName: "text-2xl leading-8",
      },
      {
        key: "scope",
        title: "浏览范围",
        value: currentScopeLabel,
        description: currentScopeDescription,
        icon: ActiveCategoryIcon,
        iconClassName: "border-sky-200 bg-sky-100 text-sky-700",
        valueClassName: "text-2xl leading-8",
      },
      {
        key: "results",
        title: "当前结果",
        value: `${displayItems.length}`,
        description: `${sortFieldLabelMap[sortField]} · ${sortDirectionLabelMap[sortDirection]}`,
        icon: Sparkles,
        iconClassName: "border-emerald-200 bg-emerald-100 text-emerald-700",
        valueClassName: "text-3xl",
      },
      {
        key: "updated",
        title: "最近更新",
        value: latestVisibleUpdateLabel,
        description:
          displayItems.length > 0
            ? "优先展示当前筛选范围内最近发生变化的内容。"
            : "当前范围内还没有可展示的更新记录。",
        icon: Clock3,
        iconClassName: "border-amber-200 bg-amber-100 text-amber-700",
        valueClassName: "text-xl leading-8",
      },
    ],
    [
      ActiveCategoryIcon,
      availableProjects.length,
      currentScopeDescription,
      currentScopeLabel,
      displayItems.length,
      items.length,
      latestVisibleUpdateLabel,
      projectId,
      selectedProject?.name,
      sortDirection,
      sortField,
    ],
  );

  const emptyActions = useMemo<ResourceEmptyAction[]>(
    () => [
      {
        key: "new-folder",
        label: "新建文件夹",
        description: "先搭好目录结构，再把内容放进去。",
        icon: FolderPlus,
        action: () => {
          void handleCreateFolder();
        },
      },
      {
        key: "new-document",
        label: "新建文档",
        description: "直接开始沉淀文字内容和结构化资料。",
        icon: FilePlus2,
        action: () => {
          void handleCreateDocument();
        },
      },
      {
        key: "upload-file",
        label: "上传文件",
        description: "把本地图片、音频、视频或普通文件加入资料库。",
        icon: Upload,
        action: () => {
          void handleUploadFile();
        },
      },
    ],
    [handleCreateDocument, handleCreateFolder, handleUploadFile],
  );

  const showEmptyState = projectId && !loading && displayItems.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,1)_0%,rgba(244,249,248,0.96)_52%,rgba(248,250,252,1)_100%)]">
      <div className="border-b border-slate-200/70 bg-white">
        <div className="mx-auto w-full max-w-[1480px] px-4 py-3 lg:px-6">
          <CanvasBreadcrumbHeader label="资料库" onBackHome={handleBackHome} />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-6 px-4 py-5 lg:px-6 lg:py-6">
          <section className="relative overflow-hidden rounded-[30px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(243,250,247,0.98)_0%,rgba(248,250,252,0.98)_48%,rgba(241,247,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
            <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />
            <div className="pointer-events-none absolute right-[-76px] top-[-24px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />

            <div className="relative flex flex-col gap-6 p-6 lg:p-8">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="max-w-3xl space-y-4">
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                    FILE LIBRARY
                  </span>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                        文件与资料
                      </h1>
                      <WorkbenchInfoTip
                        ariaLabel="资料库工作台说明"
                        content="在一个更宽的工作台里统一查看项目文档、素材与目录结构，把筛选、浏览和新增操作拆开，减少来回切换成本。"
                        tone="mint"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full border border-white/90 bg-white/90 px-3 py-1 text-slate-700 shadow-sm hover:bg-white">
                      {selectedProject?.name ?? "未选择资料库"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white/75 px-3 py-1 text-slate-600"
                    >
                      {isFolderMode
                        ? currentFolder
                          ? `目录：${currentFolder.name}`
                          : "目录浏览"
                        : `${activeCategoryLabel}分类视图`}
                    </Badge>
                    {searchQuery.trim() ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-sky-200 bg-sky-50 px-3 py-1 text-sky-700"
                      >
                        搜索：{searchQuery.trim()}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="rounded-full border-slate-200 bg-white/75 px-3 py-1 text-slate-500"
                      >
                        {sortFieldLabelMap[sortField]} ·{" "}
                        {sortDirectionLabelMap[sortDirection]}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="w-full max-w-[360px] rounded-[24px] border border-white/90 bg-white/88 p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        当前视图
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {headingDescription}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
                        saving
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      {saving && <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      {saving ? "同步中" : "已就绪"}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      {displayItems.length} 个结果
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      {totalFolderCount} 个文件夹
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1">
                      {Math.max(items.length - totalFolderCount, 0)} 个内容项
                    </span>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        className="mt-5 h-11 w-full rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                        disabled={!projectId || saving}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        添加内容
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          void handleCreateFolder();
                        }}
                      >
                        <FolderPlus className="mr-2 h-4 w-4" />
                        新建文件夹
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          void handleCreateDocument();
                        }}
                      >
                        <FilePlus2 className="mr-2 h-4 w-4" />
                        新建文档
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          void handleUploadFile();
                        }}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        上传文件
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summaryCards.map((card) => {
                  const CardIcon = card.icon;
                  return (
                    <div
                      key={card.key}
                      className="rounded-[22px] border border-white/90 bg-white/85 p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-800">
                              {card.title}
                            </p>
                            <WorkbenchInfoTip
                              ariaLabel={`${card.title}说明`}
                              content={card.description}
                              tone="slate"
                            />
                          </div>
                        </div>
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                            card.iconClassName,
                          )}
                        >
                          <CardIcon className="h-[18px] w-[18px]" />
                        </div>
                      </div>
                      <p
                        className={cn(
                          "mt-4 break-words font-semibold tracking-tight text-slate-900",
                          card.valueClassName,
                        )}
                      >
                        {card.value}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[290px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <section className="rounded-[26px] border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-950/5">
                <div className="px-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <span>资料分类</span>
                    <WorkbenchInfoTip
                      ariaLabel="资料分类说明"
                      content="在目录浏览和跨目录分类视图之间切换，快速定位不同类型内容。"
                      tone="slate"
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {resourceCategoryItems.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between rounded-2xl border border-transparent px-3 py-3 text-left text-sm transition hover:border-slate-200 hover:bg-slate-50",
                        viewCategory === key &&
                          "border-slate-900/10 bg-slate-900 text-white shadow-sm hover:bg-slate-900",
                      )}
                      onClick={() => setViewCategory(key)}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-2xl border",
                            viewCategory === key
                              ? "border-white/15 bg-white/10 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-600",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span>
                          <span className="block font-medium">{label}</span>
                          <span
                            className={cn(
                              "block text-xs",
                              viewCategory === key
                                ? "text-white/70"
                                : "text-slate-500",
                            )}
                          >
                            {key === "all"
                              ? "按目录管理完整资料库"
                              : `聚合查看${label}内容`}
                          </span>
                        </span>
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium",
                          viewCategory === key
                            ? "bg-white/10 text-white"
                            : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {categoryCounts[key]}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-[26px] border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-950/5">
                <div className="flex items-start justify-between gap-3 px-1">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <span>资料库</span>
                      <WorkbenchInfoTip
                        ariaLabel="资料库切换说明"
                        content="资料库来源于项目，这里只负责切换和浏览，不在当前页面直接新建项目。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    onClick={() =>
                      toast.info("资料库来源于项目，请在项目模块中创建")
                    }
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <button
                  type="button"
                  className="mt-4 flex w-full items-center justify-between rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-3 text-left transition hover:border-slate-400 hover:bg-slate-50"
                  onClick={() =>
                    toast.info("资料库来源于项目，请在项目模块中创建")
                  }
                >
                  <span>
                    <span className="block text-sm font-medium text-slate-800">
                      新建资料库
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      跳转到项目模块创建新的资料库容器。
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </button>

                <ScrollArea className="mt-4 h-[320px] pr-1">
                  <div className="space-y-2">
                    {projectsLoading ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                        项目加载中...
                      </div>
                    ) : availableProjects.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                        暂无可用项目
                      </div>
                    ) : (
                      availableProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={cn(
                            "w-full rounded-2xl border border-transparent bg-white/80 px-3 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50",
                            project.id === projectId &&
                              "border-slate-300 bg-slate-50 shadow-sm",
                          )}
                          onClick={() => setProjectId(project.id)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-900">
                                {project.name}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {project.id.slice(0, 8)}
                              </div>
                            </div>
                            {project.id === projectId && (
                              <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-medium text-white">
                                当前
                              </span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </section>
            </aside>

            <section className="min-w-0 space-y-4">
              <div className="rounded-[26px] border border-slate-200/80 bg-white/90 p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <ActiveCategoryIcon className="h-4 w-4 text-emerald-600" />
                      当前浏览
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                        {currentFolder?.name ?? activeCategoryLabel}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {contentPanelDescription}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white px-3 py-1 text-slate-600"
                    >
                      {displayItems.length} 个条目
                    </Badge>
                    <Button
                      variant="outline"
                      className="rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      onClick={refresh}
                      disabled={!projectId || loading}
                    >
                      <RefreshCw
                        className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
                      />
                      刷新
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      onClick={handleNavigateUp}
                      disabled={!projectId || !isFolderMode || !canNavigateUp}
                    >
                      <ArrowUp className="mr-2 h-4 w-4" />
                      返回上级
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_110px] xl:grid-cols-[minmax(0,1fr)_160px_110px_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={
                        isFolderMode
                          ? "按名称、描述或标签搜索"
                          : "搜索当前分类内容"
                      }
                      className="h-11 rounded-xl border-slate-200 bg-slate-50/80 pl-10 shadow-none focus-visible:ring-slate-300"
                    />
                  </div>

                  <Select
                    value={sortField}
                    onValueChange={(value) =>
                      setSortField(value as ResourceSortField)
                    }
                  >
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-slate-700 shadow-none">
                      <span>{sortFieldLabelMap[sortField]}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="updatedAt">更新时间</SelectItem>
                      <SelectItem value="createdAt">创建时间</SelectItem>
                      <SelectItem value="name">名称</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    className="h-11 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={() =>
                      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
                    }
                  >
                    {sortDirectionLabelMap[sortDirection]}
                  </Button>

                  <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50/70 px-4 text-sm text-slate-500">
                    {headingDescription}
                  </div>
                </div>

                {isFolderMode ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition hover:border-slate-300 hover:bg-slate-50",
                        currentFolderId === null
                          ? "border-slate-300 bg-slate-100 text-slate-900"
                          : "border-slate-200 bg-white text-slate-600",
                      )}
                      onClick={() => setCurrentFolderId(null)}
                      type="button"
                    >
                      根目录
                    </button>
                    {breadcrumbs.map((folder) => (
                      <button
                        key={folder.id}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition hover:border-slate-300 hover:bg-slate-50",
                          currentFolderId === folder.id
                            ? "border-slate-300 bg-slate-100 text-slate-900"
                            : "border-slate-200 bg-white text-slate-600",
                        )}
                        onClick={() => setCurrentFolderId(folder.id)}
                        type="button"
                      >
                        / {folder.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-sky-200/80 bg-sky-50/80 px-4 py-3 text-sm text-sky-900">
                    当前为「{activeCategoryLabel}」分类视图，展示整个资料库内该分类内容。
                  </div>
                )}

                {crossProjectMediaHint && (
                  <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-300/70 bg-amber-50/90 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
                    <span className="leading-6">
                      当前资料库暂无
                      {mediaCategoryLabelMap[crossProjectMediaHint.category]}
                      ，检测到「{crossProjectMediaHint.projectName}」包含{" "}
                      {crossProjectMediaHint.count} 个
                      {mediaCategoryLabelMap[crossProjectMediaHint.category]}。
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                      onClick={() =>
                        setProjectId(crossProjectMediaHint.projectId)
                      }
                    >
                      切换查看
                    </Button>
                  </div>
                )}
              </div>

              {(error || projectError) && (
                <div className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
                  {error || projectError}
                </div>
              )}

              <div className="overflow-hidden rounded-[26px] border border-slate-200/80 bg-white/95 shadow-sm shadow-slate-950/5">
                <div className="border-b border-slate-200/80 px-5 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                          内容列表
                        </h3>
                        <WorkbenchInfoTip
                          ariaLabel="内容列表说明"
                          content="按当前目录或分类范围展示内容，支持直接打开、重命名、删除与移动内容。"
                          tone="slate"
                        />
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
                    >
                      最近更新：{latestVisibleUpdateLabel}
                    </Badge>
                  </div>
                </div>

                <div className="p-5">
                  {!projectId ? (
                    <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 p-10 text-center text-sm text-slate-500">
                      请先在左侧选择资料库
                    </div>
                  ) : loading ? (
                    <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 p-10 text-center text-sm text-slate-500">
                      资料加载中...
                    </div>
                  ) : showEmptyState ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-[linear-gradient(135deg,rgba(248,250,252,0.98)_0%,rgba(243,249,247,0.96)_100%)] px-6 py-12 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/90 bg-white/90 text-slate-700 shadow-sm">
                        <Upload className="h-7 w-7" />
                      </div>
                      <h3 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">
                        先把内容放进资料库
                      </h3>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                        当前范围内还没有可展示的内容。可以先创建文件夹整理结构、写一份文档，或者把本地文件直接上传进来。
                      </p>

                      <div className="mt-8 grid w-full max-w-4xl gap-4 md:grid-cols-3">
                        {emptyActions.map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className="group rounded-[22px] border border-white/90 bg-white/92 px-5 py-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                              onClick={item.action}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-700">
                                  <ItemIcon className="h-5 w-5" />
                                </div>
                                <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
                              </div>
                              <p className="mt-4 text-base font-semibold text-slate-900">
                                {item.label}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-slate-500">
                                {item.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-[22px] border border-slate-200/80">
                      <Table>
                        <TableHeader className="bg-slate-50/90">
                          <TableRow className="hover:bg-slate-50/90">
                            <TableHead className="text-slate-500">名称</TableHead>
                            <TableHead className="w-[120px] text-slate-500">
                              类型
                            </TableHead>
                            <TableHead className="w-[120px] text-slate-500">
                              来源
                            </TableHead>
                            <TableHead className="w-[220px] text-slate-500">
                              更新时间
                            </TableHead>
                            <TableHead className="w-[80px] text-right text-slate-500">
                              操作
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayItems.map((item) => {
                            const Icon = getKindIcon(item);
                            return (
                              <TableRow
                                key={item.id}
                                className="hover:bg-slate-50/70"
                              >
                                <TableCell>
                                  <button
                                    type="button"
                                    className="flex max-w-[580px] items-center gap-3 text-left text-slate-800 transition hover:text-slate-950"
                                    onClick={() => {
                                      if (item.kind === "folder") {
                                        setCurrentFolderId(item.id);
                                        return;
                                      }
                                      void handleOpenResource(item);
                                    }}
                                  >
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600">
                                      <Icon className="h-4 w-4" />
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block truncate font-medium">
                                        {item.name}
                                      </span>
                                      <span className="mt-0.5 block text-xs text-slate-500">
                                        {item.kind === "folder"
                                          ? "继续进入查看子目录与内容"
                                          : item.description?.trim() ||
                                            "点击打开查看详情或使用系统默认应用打开"}
                                      </span>
                                    </span>
                                  </button>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      item.kind === "folder" ? "default" : "outline"
                                    }
                                    className={cn(
                                      "rounded-full",
                                      item.kind === "folder" &&
                                        "bg-slate-900 text-white hover:bg-slate-900",
                                    )}
                                  >
                                    {kindLabelMap[item.kind]}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="secondary"
                                    className="rounded-full bg-slate-100 text-slate-700"
                                  >
                                    {sourceLabelMap[item.sourceType]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-slate-500">
                                  {formatTime(item.updatedAt)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => {
                                          void handleOpenResource(item);
                                        }}
                                      >
                                        {item.kind === "folder"
                                          ? "进入文件夹"
                                          : "打开"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          void handleRename(item);
                                        }}
                                      >
                                        <Pencil className="mr-2 h-4 w-4" />
                                        重命名
                                      </DropdownMenuItem>
                                      {item.sourceType === "content" &&
                                        item.parentId && (
                                          <DropdownMenuItem
                                            onClick={() => {
                                              void moveToRoot(item.id);
                                            }}
                                          >
                                            <ArrowUp className="mr-2 h-4 w-4" />
                                            移动到根目录
                                          </DropdownMenuItem>
                                        )}
                                      <DropdownMenuItem
                                        className="text-destructive"
                                        onClick={() => {
                                          void handleDelete(item);
                                        }}
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        删除
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] rounded border p-3">
            {previewLoading ? (
              <div className="text-sm text-muted-foreground">
                加载文档内容中...
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-sm">
                {previewContent || "暂无内容"}
              </pre>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ResourcesPage;
