/**
 * 内容列表页面
 *
 * 显示项目下的所有内容，支持表格和卡片视图
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArrowLeft,
  Plus,
  Search,
  List,
  RefreshCw,
  MoreHorizontal,
  Edit2,
  Trash2,
  CheckCircle2,
  FileText,
  Users,
  Globe,
  FileEdit,
  Film,
  MapPin,
  LayoutGrid,
  MessageSquare,
  Image,
  LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Project,
  ContentListItem,
  ContentStatus,
  listContents,
  createContent,
  updateContent,
  deleteContent,
  getContentStats,
  getProjectTypeLabel,
  getContentTypeLabel,
  getContentStatusLabel,
  getDefaultContentTypeForProject,
  formatWordCount,
  formatRelativeTime,
} from "@/lib/api/project";
import { toast } from "sonner";
import {
  CharacterPanel,
  WorldBuildingPanel,
  OutlinePanel,
} from "./memory";
import { ProjectType } from "@/lib/api/project";

// Tab 配置类型
interface TabConfig {
  value: string;
  label: string;
  icon: LucideIcon;
}

// 不同项目类型的 Tab 配置
const PROJECT_TAB_CONFIG: Record<ProjectType, TabConfig[]> = {
  // 系统类型
  persistent: [{ value: "contents", label: "内容", icon: FileEdit }],
  temporary: [{ value: "contents", label: "内容", icon: FileEdit }],
  // 用户类型
  general: [
    { value: "contents", label: "内容", icon: FileEdit },
    { value: "characters", label: "角色", icon: Users },
    { value: "world", label: "世界观", icon: Globe },
    { value: "outline", label: "大纲", icon: List },
  ],
  "social-media": [
    { value: "contents", label: "帖子", icon: MessageSquare },
    { value: "assets", label: "素材", icon: Image },
  ],
  knowledge: [{ value: "contents", label: "笔记", icon: FileText }],
  planning: [
    { value: "contents", label: "计划", icon: FileEdit },
    { value: "outline", label: "大纲", icon: List },
  ],
  document: [
    { value: "contents", label: "文档", icon: FileText },
  ],
  video: [
    { value: "contents", label: "剧集", icon: Film },
    { value: "characters", label: "角色", icon: Users },
    { value: "scenes", label: "场景", icon: MapPin },
    { value: "storyboard", label: "分镜", icon: LayoutGrid },
    { value: "outline", label: "大纲", icon: List },
  ],
};

interface ContentListPageProps {
  project: Project;
  onBack: () => void;
  onSelectContent?: (content: ContentListItem) => void;
}

type ContentFilter = "all" | "completed" | "draft" | "published";
type ContentTab =
  | "contents"
  | "characters"
  | "world"
  | "outline"
  | "scenes"
  | "storyboard"
  | "assets";

export function ContentListPage({
  project,
  onBack,
  onSelectContent,
}: ContentListPageProps) {
  const [contents, setContents] = useState<ContentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentFilter, setCurrentFilter] = useState<ContentFilter>("all");
  const [currentTab, setCurrentTab] = useState<ContentTab>("contents");
  const [_viewMode, _setViewMode] = useState<"table" | "grid">("table");
  const [stats, setStats] = useState<{
    count: number;
    words: number;
    completed: number;
  } | null>(null);

  // 加载内容列表
  const loadContents = useCallback(async () => {
    setLoading(true);
    try {
      const [contentList, [count, words, completed]] = await Promise.all([
        listContents(project.id),
        getContentStats(project.id),
      ]);
      setContents(contentList);
      setStats({ count, words, completed });
    } catch (error) {
      console.error("加载内容失败:", error);
      toast.error("加载内容失败");
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    loadContents();
  }, [loadContents]);

  // 过滤内容
  const filteredContents = useMemo(() => {
    let result = contents;

    // 按状态过滤
    if (currentFilter !== "all") {
      result = result.filter((c) => c.status === currentFilter);
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((c) => c.title.toLowerCase().includes(query));
    }

    return result;
  }, [contents, currentFilter, searchQuery]);

  // 创建新内容
  const handleCreateContent = async () => {
    try {
      const defaultType = getDefaultContentTypeForProject(
        project.workspaceType,
      );
      const newContent = await createContent({
        project_id: project.id,
        title: `新${getContentTypeLabel(defaultType)}`,
        content_type: defaultType,
      });
      toast.success("创建成功");
      loadContents();
      onSelectContent?.(newContent);
    } catch (error) {
      console.error("创建内容失败:", error);
      toast.error("创建失败");
    }
  };

  // 获取默认内容类型
  // 更新内容状态
  const handleUpdateStatus = async (
    content: ContentListItem,
    status: ContentStatus,
  ) => {
    try {
      await updateContent(content.id, { status });
      toast.success("状态已更新");
      loadContents();
    } catch (error) {
      console.error("更新状态失败:", error);
      toast.error("更新失败");
    }
  };

  // 删除内容
  const handleDeleteContent = async (content: ContentListItem) => {
    if (!confirm(`确定要删除 "${content.title}" 吗？`)) {
      return;
    }

    try {
      await deleteContent(content.id);
      toast.success("已删除");
      loadContents();
    } catch (error) {
      console.error("删除失败:", error);
      toast.error("删除失败");
    }
  };

  // 计算进度
  const progress = stats
    ? stats.count > 0
      ? (stats.completed / stats.count) * 100
      : 0
    : 0;
  const projectTabs =
    PROJECT_TAB_CONFIG[project.workspaceType] || PROJECT_TAB_CONFIG.general;
  const currentTabMeta = projectTabs.find((tab) => tab.value === currentTab);
  const defaultContentType = getDefaultContentTypeForProject(project.workspaceType);
  const summaryCards = [
    {
      label: "内容总数",
      value: String(stats?.count || 0),
      description: `当前项目包含的${getContentTypeLabel(defaultContentType)}数量`,
    },
    {
      label: "已完成",
      value: String(stats?.completed || 0),
      description:
        (stats?.completed || 0) > 0 ? "已有内容进入完成状态" : "还没有完成的内容条目",
    },
    {
      label: "总字数",
      value: formatWordCount(stats?.words || 0),
      description: "聚合所有内容条目的正文统计",
    },
  ];

  // 获取状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "published":
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="h-full overflow-auto bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,1)_22%,rgba(241,245,249,0.94)_100%)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-6 pt-4 lg:px-6">
        <section className="relative overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(247,250,252,0.98)_0%,rgba(255,255,255,0.98)_48%,rgba(240,249,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
          <div className="pointer-events-none absolute -left-14 top-[-42px] h-44 w-44 rounded-full bg-sky-200/30 blur-3xl" />
          <div className="pointer-events-none absolute right-[-58px] top-[-26px] h-48 w-48 rounded-full bg-emerald-200/25 blur-3xl" />
          <div className="relative flex flex-col gap-6 p-5 lg:p-6">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onBack}
                    className="rounded-full border-white/90 bg-white/85 px-3 shadow-sm shadow-slate-950/5"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    返回项目列表
                  </Button>
                  <Badge className="border-0 bg-slate-900/90 text-white hover:bg-slate-900/90">
                    {getProjectTypeLabel(project.workspaceType)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-slate-200/80 bg-white/80 text-slate-600"
                  >
                    当前工作区：{currentTabMeta?.label || "内容"}
                  </Badge>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/90 bg-white/88 text-2xl shadow-sm shadow-slate-950/5">
                      {project.icon || "📁"}
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                      {project.name}
                    </h1>
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600">
                    在一个更宽的工作台里统一管理内容、项目记忆与默认风格；风格设置会直接作为当前项目的表达基线。
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-4 xl:min-w-[420px] xl:items-end">
                <Button
                  onClick={handleCreateContent}
                  className="self-start xl:self-auto"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  新建{getContentTypeLabel(defaultContentType)}
                </Button>
                <div className="grid gap-3 sm:grid-cols-3 xl:w-full">
                  {summaryCards.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm shadow-slate-950/5"
                    >
                      <div className="text-sm font-semibold text-slate-800">
                        {item.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {item.description}
                      </div>
                      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/90 bg-white/84 p-4 shadow-sm shadow-slate-950/5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    创作进度
                  </div>
                  <div className="text-xs leading-5 text-slate-500">
                    已完成 {stats?.completed || 0} / {stats?.count || 0}，当前完成度{" "}
                    {progress.toFixed(0)}%。
                  </div>
                </div>
                <div className="text-sm text-slate-600">
                  总字数 {formatWordCount(stats?.words || 0)}
                </div>
              </div>
              <Progress value={progress} className="mt-3 h-2.5" />
            </div>
          </div>
        </section>

        <Tabs
          value={currentTab}
          onValueChange={(v) => setCurrentTab(v as ContentTab)}
          className="space-y-5"
        >
          <div className="rounded-[26px] border border-slate-200/80 bg-white/90 p-2 shadow-sm shadow-slate-950/5">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
              {projectTabs.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="gap-2 rounded-[18px] px-4 py-2.5 text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {currentTab === "contents" && (
            <>
              <div className="rounded-[26px] border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-950/5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="flex flex-wrap items-center gap-2">
                    {(["all", "completed", "draft"] as ContentFilter[]).map(
                      (filter) => (
                        <Button
                          key={filter}
                          variant={
                            currentFilter === filter ? "default" : "outline"
                          }
                          size="sm"
                          onClick={() => setCurrentFilter(filter)}
                          className={
                            currentFilter === filter
                              ? "bg-slate-900 text-white hover:bg-slate-800"
                              : "border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50"
                          }
                        >
                          {filter === "all"
                            ? "全部"
                            : filter === "completed"
                              ? "已完成"
                              : "草稿"}
                        </Button>
                      ),
                    )}
                  </div>
                  <div className="flex-1" />
                  <div className="relative w-full lg:w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="搜索标题或条目"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-10 border-slate-200/80 bg-slate-50/70 pl-9"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 shadow-sm shadow-slate-950/5">
                {loading ? (
                  <div className="flex h-48 items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : filteredContents.length === 0 ? (
                  <div className="flex h-56 flex-col items-center justify-center gap-4 text-center text-slate-500">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-slate-700">
                        还没有内容
                      </p>
                      <p className="text-sm">
                        先创建第一条内容，再继续补充项目记忆与默认风格。
                      </p>
                    </div>
                    <Button onClick={handleCreateContent}>
                      创建第一个内容
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-200/80">
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>标题</TableHead>
                          <TableHead className="w-24">状态</TableHead>
                          <TableHead className="w-24">字数</TableHead>
                          <TableHead className="w-32">更新时间</TableHead>
                          <TableHead className="w-20">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredContents.map((content) => (
                          <TableRow
                            key={content.id}
                            className="cursor-pointer border-slate-200/70 hover:bg-slate-50/80"
                            onClick={() => onSelectContent?.(content)}
                          >
                            <TableCell className="font-mono text-muted-foreground">
                              {content.order + 1}
                            </TableCell>
                            <TableCell className="font-medium text-slate-900">
                              {content.title}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {getStatusIcon(content.status)}
                                <span className="text-sm">
                                  {getContentStatusLabel(
                                    content.status as ContentStatus,
                                  )}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatWordCount(content.word_count)}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {formatRelativeTime(content.updated_at)}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      onSelectContent?.(content);
                                    }}
                                  >
                                    <Edit2 className="mr-2 h-4 w-4" />
                                    编辑
                                  </DropdownMenuItem>
                                  {content.status !== "completed" && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        handleUpdateStatus(content, "completed");
                                      }}
                                    >
                                      <CheckCircle2 className="mr-2 h-4 w-4" />
                                      标记完成
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      handleDeleteContent(content);
                                    }}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    删除
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}

          {currentTab === "characters" && (
            <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 shadow-sm shadow-slate-950/5">
              <CharacterPanel projectId={project.id} />
            </div>
          )}

          {currentTab === "world" && (
            <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 shadow-sm shadow-slate-950/5">
              <WorldBuildingPanel projectId={project.id} />
            </div>
          )}

          {currentTab === "outline" && (
            <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/92 shadow-sm shadow-slate-950/5">
              <OutlinePanel projectId={project.id} />
            </div>
          )}

          {currentTab === "scenes" && (
            <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-slate-300/80 bg-white/80 text-muted-foreground">
              <div className="text-center">
                <MapPin className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>场景管理功能开发中...</p>
              </div>
            </div>
          )}

          {currentTab === "storyboard" && (
            <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-slate-300/80 bg-white/80 text-muted-foreground">
              <div className="text-center">
                <LayoutGrid className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>分镜管理功能开发中...</p>
              </div>
            </div>
          )}

          {currentTab === "assets" && (
            <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-slate-300/80 bg-white/80 text-muted-foreground">
              <div className="text-center">
                <Image className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>素材管理功能开发中...</p>
              </div>
            </div>
          )}

        </Tabs>
      </div>
    </div>
  );
}
