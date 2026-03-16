/**
 * 页面类型定义
 *
 * 支持静态页面和动态插件页面
 * - 静态页面: 预定义的页面标识符
 * - 动态插件页面: `plugin:${string}` 格式，如 "plugin:machine-id-tool"
 *
 * @module types/page
 */

import type { SettingsTabs } from "./settings";

export type WorkspaceTheme =
  | "general"
  | "social-media"
  | "poster"
  | "music"
  | "knowledge"
  | "planning"
  | "document"
  | "video"
  | "novel";

export type ThemeWorkspacePage =
  | "workspace-general"
  | "workspace-social-media"
  | "workspace-poster"
  | "workspace-music"
  | "workspace-knowledge"
  | "workspace-planning"
  | "workspace-document"
  | "workspace-video"
  | "workspace-novel";

export const LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY =
  "proxycast:last-theme-workspace-page";

export const THEME_WORKSPACE_PAGE_MAP: Record<
  WorkspaceTheme,
  ThemeWorkspacePage
> = {
  general: "workspace-general",
  "social-media": "workspace-social-media",
  poster: "workspace-poster",
  music: "workspace-music",
  knowledge: "workspace-knowledge",
  planning: "workspace-planning",
  document: "workspace-document",
  video: "workspace-video",
  novel: "workspace-novel",
};

export const WORKSPACE_PAGE_THEME_MAP: Record<
  ThemeWorkspacePage,
  WorkspaceTheme
> = {
  "workspace-general": "general",
  "workspace-social-media": "social-media",
  "workspace-poster": "poster",
  "workspace-music": "music",
  "workspace-knowledge": "knowledge",
  "workspace-planning": "planning",
  "workspace-document": "document",
  "workspace-video": "video",
  "workspace-novel": "novel",
};

export type Page =
  | "openclaw"
  | "agent"
  | "style"
  | ThemeWorkspacePage
  | "image-gen"
  | "automation"
  | "resources"
  | "browser-runtime"
  | "tools"
  | "plugins"
  | "settings"
  | "memory"
  | "terminal"
  | "sysinfo"
  | "files"
  | "web"
  | "image-analysis"
  | "projects"
  | "project-detail"
  | `plugin:${string}`;

export function isThemeWorkspacePage(page: Page): page is ThemeWorkspacePage {
  return page in WORKSPACE_PAGE_THEME_MAP;
}

export function getThemeWorkspacePage(
  theme: WorkspaceTheme,
): ThemeWorkspacePage {
  return THEME_WORKSPACE_PAGE_MAP[theme];
}

export function getThemeByWorkspacePage(
  page: ThemeWorkspacePage,
): WorkspaceTheme {
  return WORKSPACE_PAGE_THEME_MAP[page];
}

export function getDefaultThemeWorkspacePage(): ThemeWorkspacePage {
  return THEME_WORKSPACE_PAGE_MAP.general;
}

export type WorkspaceViewMode =
  | "project-management"
  | "workspace"
  | "project-detail";

export type OpenClawSubpage =
  | "install"
  | "installing"
  | "configure"
  | "runtime"
  | "updating"
  | "restarting"
  | "uninstalling"
  | "dashboard";

export interface OpenClawPageParams {
  subpage?: OpenClawSubpage;
}

/**
 * Agent 页面参数
 * 用于从项目入口跳转到创作界面时传递项目上下文
 */
export interface AgentPageParams {
  projectId?: string;
  contentId?: string;
  /** Agent 入口模式：新建任务或任务中心 */
  agentEntry?: "new-task" | "claw";
  /** 进入 Agent 时自动发送的首条用户消息 */
  initialUserPrompt?: string;
  /** 进入 Agent 时优先创建的话题名称 */
  initialSessionName?: string;
  /** 一次性入口提示文案 */
  entryBannerMessage?: string;
  /** 首屏主题（用于左侧导航直达创作主题） */
  theme?: string;
  /** 是否锁定主题（锁定后不在首屏显示主题切换） */
  lockTheme?: boolean;
  /** 从资源管理页进入（用于沉浸式展示） */
  fromResources?: boolean;
  /** 首页沉浸模式：隐藏左侧应用导航与话题列表，仅保留主工作区 */
  immersiveHome?: boolean;
  /** 首页点击触发的新会话标记（时间戳） */
  newChatAt?: number;
  /** 主题工作台重置标记（时间戳） */
  workspaceResetAt?: number;
  /** 工作台视图模式（仅主题工作台使用） */
  workspaceViewMode?: WorkspaceViewMode;
  /** 进入主题工作台时，预填并触发“创建前确认”提示词 */
  workspaceCreatePrompt?: string;
  /** 创建确认来源（用于策略路由与埋点） */
  workspaceCreateSource?:
    | "workspace_prompt"
    | "quick_create"
    | "project_created";
  /** 创建确认建议标题（可选） */
  workspaceCreateFallbackTitle?: string;
  /** 进入工作台后立即打开项目风格策略 */
  workspaceOpenProjectStyleGuide?: boolean;
  /** 打开项目风格策略时，高亮的来源风格资产 ID */
  workspaceOpenProjectStyleGuideSourceEntryId?: string;
}

/**
 * 项目详情页参数
 */
export interface ProjectDetailPageParams {
  projectId: string;
  workspaceTheme?: WorkspaceTheme;
  openProjectStyleGuide?: boolean;
  openProjectStyleGuideSourceEntryId?: string;
}

/**
 * 设置页面参数
 */
export interface SettingsPageParams {
  tab?: SettingsTabs;
}

export type MemoryPageSection =
  | "home"
  | "identity"
  | "context"
  | "preference"
  | "experience"
  | "activity";

export interface MemoryPageParams {
  section?: MemoryPageSection;
}

export type StylePageSection = "overview" | "library";

export interface StylePageParams {
  section?: StylePageSection;
}

/**
 * 页面参数联合类型
 */
export type PageParams =
  | AgentPageParams
  | ProjectDetailPageParams
  | SettingsPageParams
  | OpenClawPageParams
  | MemoryPageParams
  | StylePageParams
  | Record<string, unknown>;
