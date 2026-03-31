/**
 * 项目管理 API
 *
 * 提供项目（Project）和内容（Content）的 CRUD 操作
 */

import { safeInvoke } from "@/lib/dev-bridge";
import { normalizeThemeType } from "@/lib/workspace/workbenchContract";
import type { WorkspaceSettings } from "@/types/workspace";

// ==================== 类型定义 ====================

/** 系统级类型（不在 UI 中显示） */
export type SystemType = "persistent" | "temporary";

/** 用户级类型（统一后的 9 种） */
export type UserType =
  | "general" // 通用对话 💬
  | "social-media" // 社媒内容 📱
  | "knowledge" // 知识探索 🔍
  | "planning" // 计划规划 📅
  | "document" // 办公文档 📄
  | "video"; // 短视频 🎬

/** 项目类型（系统级 + 用户级） */
export type ProjectType = SystemType | UserType;

/** 用户可选的项目类型列表 */
export const USER_PROJECT_TYPES: UserType[] = [
  "general",
  "social-media",
  "knowledge",
  "planning",
  "document",
  "video",
];

/** 项目类型配置 */
export interface ProjectTypeConfig {
  label: string;
  icon: string;
  defaultContentType: ContentType;
  canvasType: string | null;
}

/** 统一的项目类型配置 */
export const TYPE_CONFIGS: Record<ProjectType, ProjectTypeConfig> = {
  // 系统级类型
  persistent: {
    label: "持久化",
    icon: "📁",
    defaultContentType: "document",
    canvasType: null,
  },
  temporary: {
    label: "临时",
    icon: "📂",
    defaultContentType: "document",
    canvasType: null,
  },
  // 用户级类型
  general: {
    label: "通用对话",
    icon: "💬",
    defaultContentType: "content",
    canvasType: null,
  },
  "social-media": {
    label: "社媒内容",
    icon: "📱",
    defaultContentType: "post",
    canvasType: "document",
  },
  knowledge: {
    label: "知识探索",
    icon: "🔍",
    defaultContentType: "document",
    canvasType: null,
  },
  planning: {
    label: "计划规划",
    icon: "📅",
    defaultContentType: "document",
    canvasType: null,
  },
  document: {
    label: "办公文档",
    icon: "📄",
    defaultContentType: "document",
    canvasType: "document",
  },
  video: {
    label: "短视频",
    icon: "🎬",
    defaultContentType: "episode",
    canvasType: "video",
  },
};

/** 内容类型 */
export type ContentType =
  | "episode"
  | "chapter"
  | "post"
  | "document"
  | "content";

/** 内容状态 */
export type ContentStatus = "draft" | "completed" | "published";

/** 项目统计信息 */
export interface ProjectStats {
  content_count: number;
  total_words: number;
  completed_count: number;
  last_accessed?: number;
}

/** 项目列表项 */
export interface Project {
  id: string;
  name: string;
  workspaceType: ProjectType;
  rootPath: string;
  isDefault: boolean;
  settings?: WorkspaceSettings;
  createdAt: number;
  updatedAt: number;
  icon?: string;
  color?: string;
  isFavorite: boolean;
  isArchived: boolean;
  tags: string[];
  defaultPersonaId?: string;
  stats?: ProjectStats;
}

export type RawProject = Partial<Project> & {
  id: string;
  name: string;
  workspace_type?: ProjectType;
  root_path?: string;
  is_default?: boolean;
  created_at?: number;
  updated_at?: number;
  is_favorite?: boolean;
  is_archived?: boolean;
  default_persona_id?: string;
};

/** 内容列表项 */
export interface ContentListItem {
  id: string;
  project_id: string;
  title: string;
  content_type: string;
  status: string;
  order: number;
  word_count: number;
  metadata?: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

/** 内容详情 */
export interface ContentDetail extends ContentListItem {
  body: string;
  metadata?: Record<string, unknown>;
  session_id?: string;
}

export interface ThemeWorkbenchVersionState {
  id: string;
  created_at: number;
  description?: string;
  status?: "in_progress" | "pending" | "merged" | "candidate";
  is_current: boolean;
}

export interface ThemeWorkbenchDocumentState {
  content_id: string;
  current_version_id: string;
  version_count: number;
  versions: ThemeWorkbenchVersionState[];
}

/** 创建项目请求 */
export interface CreateProjectRequest {
  name: string;
  rootPath: string;
  workspaceType?: ProjectType;
}

/** 更新项目请求 */
export interface UpdateProjectRequest {
  name?: string;
  rootPath?: string;
  settings?: WorkspaceSettings;
  icon?: string;
  color?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  tags?: string[];
  defaultPersonaId?: string;
}

export interface WorkspaceEnsureResult {
  workspaceId: string;
  rootPath: string;
  existed: boolean;
  created: boolean;
  repaired: boolean;
  relocated?: boolean;
  previousRootPath?: string | null;
  warning?: string | null;
}

/** 创建内容请求 */
export interface CreateContentRequest {
  project_id: string;
  title: string;
  content_type?: ContentType;
  order?: number;
  body?: string;
  metadata?: Record<string, unknown>;
}

/** 更新内容请求 */
export interface UpdateContentRequest {
  title?: string;
  status?: ContentStatus;
  order?: number;
  body?: string;
  metadata?: Record<string, unknown>;
  session_id?: string;
}

/** 内容列表查询参数 */
export interface ListContentQuery {
  status?: ContentStatus;
  content_type?: ContentType;
  search?: string;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

// ==================== 项目 API ====================

/** 创建项目 */
export async function createProject(
  request: CreateProjectRequest,
): Promise<Project> {
  const project = await safeInvoke<RawProject>("workspace_create", { request });
  return normalizeProject(project);
}

/** 获取统一 workspace 项目根目录 */
export async function getWorkspaceProjectsRoot(): Promise<string> {
  return safeInvoke<string>("workspace_get_projects_root");
}

/** 按项目名称解析固定项目目录 */
export async function resolveProjectRootPath(name: string): Promise<string> {
  return safeInvoke<string>("workspace_resolve_project_path", { name });
}

/** 获取项目列表 */
export async function listProjects(): Promise<Project[]> {
  const projects = await safeInvoke<RawProject[]>("workspace_list");
  // 防御性编程：确保返回数组
  if (!Array.isArray(projects)) {
    console.warn("listProjects 返回非数组值:", projects);
    return [];
  }
  return projects.map((project) => normalizeProject(project));
}

/** 获取默认项目 */
export async function getDefaultProject(): Promise<Project | null> {
  const project = await safeInvoke<RawProject | null>("workspace_get_default");
  return project ? normalizeProject(project) : null;
}

/** 获取默认项目，缺失时抛出错误 */
export async function requireDefaultProject(
  errorMessage: string = "未找到默认工作区，请先创建或选择项目",
): Promise<Project> {
  const project = await getDefaultProject();
  if (!project?.id) {
    throw new Error(errorMessage);
  }
  return project;
}

/** 获取默认项目 ID，缺失时抛出错误 */
export async function requireDefaultProjectId(
  errorMessage?: string,
): Promise<string> {
  const project = await requireDefaultProject(errorMessage);
  return project.id;
}

/** 确保工作区目录就绪 */
export async function ensureWorkspaceReady(
  id: string,
): Promise<WorkspaceEnsureResult> {
  return safeInvoke<WorkspaceEnsureResult>("workspace_ensure_ready", { id });
}

/** 确保默认工作区目录就绪 */
export async function ensureDefaultWorkspaceReady(): Promise<WorkspaceEnsureResult | null> {
  return safeInvoke<WorkspaceEnsureResult | null>(
    "workspace_ensure_default_ready",
  );
}

/** 设置默认项目 */
export async function setDefaultProject(id: string): Promise<void> {
  await safeInvoke<void>("workspace_set_default", { id });
}

/** 获取或创建默认项目 */
export async function getOrCreateDefaultProject(): Promise<Project> {
  const project = await safeInvoke<RawProject>("get_or_create_default_project");
  return normalizeProject(project);
}

/** 通过根路径获取项目 */
export async function getProjectByRootPath(
  rootPath: string,
): Promise<Project | null> {
  const project = await safeInvoke<RawProject | null>("workspace_get_by_path", {
    rootPath,
  });
  return project ? normalizeProject(project) : null;
}

/** 获取项目详情 */
export async function getProject(id: string): Promise<Project | null> {
  const project = await safeInvoke<RawProject | null>("workspace_get", { id });
  return project ? normalizeProject(project) : null;
}

/** 更新项目 */
export async function updateProject(
  id: string,
  request: UpdateProjectRequest,
): Promise<Project> {
  const project = await safeInvoke<RawProject>("workspace_update", {
    id,
    request,
  });
  return normalizeProject(project);
}

/** 删除项目 */
export async function deleteProject(
  id: string,
  deleteDirectory?: boolean,
): Promise<boolean> {
  return safeInvoke<boolean>("workspace_delete", { id, deleteDirectory });
}

// ==================== 内容 API ====================

/** 创建内容 */
export async function createContent(
  request: CreateContentRequest,
): Promise<ContentDetail> {
  return safeInvoke<ContentDetail>("content_create", { request });
}

/** 获取内容详情 */
export async function getContent(id: string): Promise<ContentDetail | null> {
  return safeInvoke<ContentDetail | null>("content_get", { id });
}

/** 获取主题工作台文稿版本状态（后端解析 content.metadata） */
export async function getThemeWorkbenchDocumentState(
  id: string,
): Promise<ThemeWorkbenchDocumentState | null> {
  return safeInvoke<ThemeWorkbenchDocumentState | null>(
    "content_get_theme_workbench_document_state",
    { id },
  );
}

/** 获取项目的内容列表 */
export async function listContents(
  projectId: string,
  query?: ListContentQuery,
): Promise<ContentListItem[]> {
  const contents = await safeInvoke<ContentListItem[]>("content_list", {
    projectId,
    query,
  });
  // 防御性编程：确保返回数组
  if (!Array.isArray(contents)) {
    console.warn("listContents 返回非数组值:", contents);
    return [];
  }
  return contents;
}

/** 更新内容 */
export async function updateContent(
  id: string,
  request: UpdateContentRequest,
): Promise<ContentDetail> {
  return safeInvoke<ContentDetail>("content_update", { id, request });
}

/** 删除内容 */
export async function deleteContent(id: string): Promise<boolean> {
  return safeInvoke<boolean>("content_delete", { id });
}

/** 重新排序内容 */
export async function reorderContents(
  projectId: string,
  contentIds: string[],
): Promise<void> {
  return safeInvoke<void>("content_reorder", { projectId, contentIds });
}

/** 获取项目内容统计 */
export async function getContentStats(
  projectId: string,
): Promise<[number, number, number]> {
  return safeInvoke<[number, number, number]>("content_stats", { projectId });
}

// ==================== 辅助函数 ====================

/** 规范化项目对象字段 */
export function normalizeProject(project: RawProject): Project {
  const rawWorkspaceType = String(
    project.workspaceType ?? project.workspace_type ?? "persistent",
  )
    .trim()
    .toLowerCase();
  const workspaceType: ProjectType =
    rawWorkspaceType === "persistent" || rawWorkspaceType === "temporary"
      ? rawWorkspaceType
      : normalizeThemeType(rawWorkspaceType);

  return {
    id: project.id,
    name: project.name,
    workspaceType,
    rootPath: project.rootPath ?? project.root_path ?? "",
    isDefault: project.isDefault ?? project.is_default ?? false,
    settings: project.settings,
    createdAt: project.createdAt ?? project.created_at ?? 0,
    updatedAt: project.updatedAt ?? project.updated_at ?? 0,
    icon: project.icon,
    color: project.color,
    isFavorite: project.isFavorite ?? project.is_favorite ?? false,
    isArchived: project.isArchived ?? project.is_archived ?? false,
    tags: project.tags ?? [],
    defaultPersonaId:
      project.defaultPersonaId ?? project.default_persona_id ?? undefined,
    stats: project.stats,
  };
}

/** 判断是否为用户级项目类型 */
export function isUserProjectType(type: ProjectType): boolean {
  return USER_PROJECT_TYPES.includes(type as UserType);
}

/** 获取项目类型的显示名称 */
export function getProjectTypeLabel(type: ProjectType): string {
  return TYPE_CONFIGS[type]?.label || type;
}

/** 获取项目类型的图标 */
export function getProjectTypeIcon(type: ProjectType): string {
  return TYPE_CONFIGS[type]?.icon || "📁";
}

/** 获取项目默认内容类型 */
export function getDefaultContentTypeForProject(
  projectType: ProjectType,
): ContentType {
  return TYPE_CONFIGS[projectType]?.defaultContentType || "document";
}

/** 获取项目类型对应的画布类型 */
export function getCanvasTypeForProjectType(
  projectType: ProjectType,
): string | null {
  return TYPE_CONFIGS[projectType]?.canvasType || null;
}

/** 获取内容类型的显示名称 */
export function getContentTypeLabel(type: ContentType): string {
  const labels: Record<ContentType, string> = {
    episode: "剧集",
    chapter: "章节",
    post: "帖子",
    document: "文档",
    content: "内容",
  };
  return labels[type] || type;
}

/** 获取内容状态的显示名称 */
export function getContentStatusLabel(status: ContentStatus): string {
  const labels: Record<ContentStatus, string> = {
    draft: "草稿",
    completed: "已完成",
    published: "已发布",
  };
  return labels[status] || status;
}

/** 解析创建项目的错误信息 */
export function getCreateProjectErrorMessage(message: string): string {
  if (!message) {
    return "未知错误";
  }
  if (message === "[object Object]") {
    return "创建项目失败，请查看日志";
  }
  if (message.includes("路径已存在")) {
    return "项目目录已存在，请更换项目名称或清理同名目录";
  }
  if (message.includes("no such column") || message.includes("has no column")) {
    return "数据库结构过旧，请重启应用以执行迁移";
  }
  if (message.includes("无效的路径")) {
    return "项目目录无效，请重新选择";
  }
  return message;
}

/** 提取异常中的错误消息 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }

  return String(error);
}

/** 格式化字数 */
export function formatWordCount(count: number): string {
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return count.toLocaleString();
}

/** 格式化相对时间 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (diff < minute) {
    return "刚刚";
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)}分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)}小时前`;
  } else if (diff < week) {
    return `${Math.floor(diff / day)}天前`;
  } else if (diff < month) {
    return `${Math.floor(diff / week)}周前`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}
