import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
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
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
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
import { cn } from "@/lib/utils";
import type { Page, PageParams } from "@/types/page";
import { CanvasBreadcrumbHeader } from "@/components/content-creator/canvas/shared/CanvasBreadcrumbHeader";
import { fetchDocumentDetail } from "./services/resourceAdapter";
import type { ResourceItem } from "./services/types";
import { resourcesSelectors, useResourcesStore } from "./store";

type ResourceViewCategory = "all" | "document" | "image" | "audio" | "video";

interface ResourcesPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
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

const sortFieldLabelMap: Record<"updatedAt" | "createdAt" | "name", string> = {
  updatedAt: "更新时间",
  createdAt: "创建时间",
  name: "名称",
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
  field: "updatedAt" | "createdAt" | "name",
  direction: "asc" | "desc",
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
  field: "updatedAt" | "createdAt" | "name",
  direction: "asc" | "desc",
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
        detail.source !== "image-gen-save"
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
    if (!projectId) return "请选择左侧资源库";
    if (currentFolderId && currentFolder) {
      return `当前目录：${currentFolder.name}`;
    }
    return `资源库：${selectedProject?.name ?? "未命名项目"}`;
  }, [currentFolder, currentFolderId, projectId, selectedProject?.name]);

  const emptyActions = useMemo(
    () => [
      {
        key: "new-library",
        label: "新建资源库",
        action: () => toast.info("资源库来源于项目，请在项目模块中创建"),
      },
      {
        key: "upload-file",
        label: "上传文件",
        action: () => {
          void handleUploadFile();
        },
      },
      {
        key: "upload-folder",
        label: "上传文件夹",
        action: () => {
          toast.info(
            "当前版本暂不支持文件夹上传，可先创建文件夹后逐个上传文件",
          );
        },
      },
    ],
    [handleUploadFile],
  );

  const showEmptyState = projectId && !loading && displayItems.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b bg-background px-6 py-3">
        <CanvasBreadcrumbHeader label="资源" onBackHome={handleBackHome} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
          <span>{selectedProject?.name ?? "未选择资源库"}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid min-h-full rounded-xl border bg-background lg:grid-cols-[248px_1fr]">
          <aside className="border-b bg-muted/20 p-3 lg:border-b-0 lg:border-r">
            <div className="space-y-4">
              <div>
                <p className="px-2 text-xs font-medium text-muted-foreground">
                  资源
                </p>
                <div className="mt-1 space-y-1">
                  {resourceCategoryItems.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted",
                        viewCategory === key &&
                          "bg-background text-foreground shadow-sm",
                      )}
                      onClick={() => setViewCategory(key)}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {categoryCounts[key]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <div className="flex items-center justify-between px-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    库
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() =>
                      toast.info("资源库来源于项目，请在项目模块中创建")
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <button
                  type="button"
                  className="mt-2 w-full rounded-lg border border-dashed bg-background px-3 py-2 text-left text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  onClick={() =>
                    toast.info("资源库来源于项目，请在项目模块中创建")
                  }
                >
                  + 新建资源库
                </button>

                <ScrollArea className="mt-2 h-[240px] pr-1">
                  <div className="space-y-1">
                    {availableProjects.length === 0 ? (
                      <div className="rounded-lg border border-dashed px-2 py-3 text-xs text-muted-foreground">
                        暂无可用项目
                      </div>
                    ) : (
                      availableProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={cn(
                            "w-full rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                            project.id === projectId &&
                              "bg-background text-foreground shadow-sm",
                          )}
                          onClick={() => setProjectId(project.id)}
                        >
                          <div className="truncate font-medium">
                            {project.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {project.id.slice(0, 8)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">
                    {currentFolder?.name ??
                      resourceCategoryLabelMap[viewCategory]}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {headingDescription}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline">{displayItems.length} 个条目</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        className="bg-foreground text-background hover:bg-foreground/90"
                        disabled={!projectId || saving}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        添加
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

              <div className="mt-4 grid gap-2 md:grid-cols-[1fr_140px_88px_auto_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={
                      isFolderMode
                        ? "按名称、描述或标签搜索"
                        : "搜索当前分类资源"
                    }
                    className="pl-8"
                  />
                </div>

                <Select
                  value={sortField}
                  onValueChange={(value) =>
                    setSortField(value as "updatedAt" | "createdAt" | "name")
                  }
                >
                  <SelectTrigger>
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
                  onClick={() =>
                    setSortDirection(sortDirection === "asc" ? "desc" : "asc")
                  }
                >
                  {sortDirection === "asc" ? "升序" : "降序"}
                </Button>

                <Button
                  variant="outline"
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
                  onClick={handleNavigateUp}
                  disabled={!projectId || !isFolderMode || !canNavigateUp}
                >
                  <ArrowUp className="mr-2 h-4 w-4" />
                  返回上级
                </Button>
              </div>

              {isFolderMode ? (
                <div className="mt-3 flex flex-wrap items-center gap-1 text-sm">
                  <button
                    className={cn(
                      "rounded px-2 py-1 hover:bg-muted",
                      currentFolderId === null && "bg-muted text-foreground",
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
                        "rounded px-2 py-1 hover:bg-muted",
                        currentFolderId === folder.id &&
                          "bg-muted text-foreground",
                      )}
                      onClick={() => setCurrentFolderId(folder.id)}
                      type="button"
                    >
                      / {folder.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  当前为「{resourceCategoryLabelMap[viewCategory]}
                  」分类视图，展示整个资源库内该分类内容
                </div>
              )}
              {crossProjectMediaHint && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="truncate">
                    当前资源库暂无
                    {mediaCategoryLabelMap[crossProjectMediaHint.category]}
                    ，检测到「
                    {crossProjectMediaHint.projectName}」包含{" "}
                    {crossProjectMediaHint.count} 个
                    {mediaCategoryLabelMap[crossProjectMediaHint.category]}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setProjectId(crossProjectMediaHint.projectId)
                    }
                  >
                    切换查看
                  </Button>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {(error || projectError) && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error || projectError}
                </div>
              )}

              {!projectId ? (
                <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  请先在左侧选择资源库
                </div>
              ) : loading ? (
                <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  资源加载中...
                </div>
              ) : showEmptyState ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border bg-muted/10 px-6 py-12 text-center">
                  <h3 className="text-3xl font-semibold tracking-tight">
                    把文件或文件夹拖到这里
                  </h3>
                  <p className="mt-2 text-lg text-muted-foreground">或者</p>
                  <div className="mt-8 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
                    {emptyActions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="rounded-2xl border bg-background px-4 py-12 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
                        onClick={item.action}
                      >
                        <div className="text-lg font-medium">{item.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>名称</TableHead>
                        <TableHead className="w-[120px]">类型</TableHead>
                        <TableHead className="w-[120px]">来源</TableHead>
                        <TableHead className="w-[220px]">更新时间</TableHead>
                        <TableHead className="w-[80px] text-right">
                          操作
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayItems.map((item) => {
                        const Icon = getKindIcon(item);
                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              <button
                                type="button"
                                className="flex items-center gap-2 text-left hover:text-primary"
                                onClick={() => {
                                  if (item.kind === "folder") {
                                    setCurrentFolderId(item.id);
                                    return;
                                  }
                                  void handleOpenResource(item);
                                }}
                              >
                                <Icon className="h-4 w-4 text-muted-foreground" />
                                <span className="truncate">{item.name}</span>
                              </button>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  item.kind === "folder" ? "default" : "outline"
                                }
                              >
                                {kindLabelMap[item.kind]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {sourceLabelMap[item.sourceType]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatTime(item.updatedAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon" variant="ghost">
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
          </section>
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
