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
import type { SkillScaffoldTarget } from "@/lib/api/skills";

export type WorkspaceTheme = "general";

export type Page =
  | "openclaw"
  | "agent"
  | "skills"
  | "video"
  | "image-gen"
  | "automation"
  | "channels"
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
  | `plugin:${string}`;

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

export interface AgentPendingServiceSkillLaunchParams {
  skillId: string;
  requestKey?: number;
  initialSlotValues?: Record<string, string>;
  prefillHint?: string;
}

/**
 * Agent 页面参数
 * 用于从项目入口跳转到创作界面时传递项目上下文
 */
export interface AgentPageParams {
  projectId?: string;
  contentId?: string;
  initialRequestMetadata?: Record<string, unknown>;
  initialAutoSendRequestMetadata?: Record<string, unknown>;
  autoRunInitialPromptOnMount?: boolean;
  /** Agent 入口模式：新建任务或任务中心 */
  agentEntry?: "new-task" | "claw";
  /** 首页沉浸模式提交后透传的首条图片 */
  initialUserImages?: Array<{
    data: string;
    mediaType: string;
  }>;
  /** 进入 Agent 时自动发送的首条用户消息 */
  initialUserPrompt?: string;
  /** 进入 Agent 时透传的初始创作模式 */
  initialCreationMode?: "guided" | "fast" | "hybrid" | "framework";
  /** 进入 Agent 时优先创建的话题名称 */
  initialSessionName?: string;
  /** 一次性入口提示文案 */
  entryBannerMessage?: string;
  /** 首屏工作区主题（用于直达指定工作区入口） */
  theme?: string;
  /** 是否锁定主题（锁定后不在首屏显示主题切换） */
  lockTheme?: boolean;
  /** 从资源管理页进入（用于沉浸式展示） */
  fromResources?: boolean;
  /** 首页沉浸模式：隐藏左侧应用导航与话题列表，仅保留主工作区 */
  immersiveHome?: boolean;
  /** 进入 Agent 后立即打开浏览器协助 */
  openBrowserAssistOnMount?: boolean;
  /** 进入 Agent 后执行一次站点技能启动 */
  initialSiteSkillLaunch?: AgentSiteSkillLaunchParams;
  /** 进入 Agent 后在当前对话挂起或继续一次服务技能启动 */
  initialPendingServiceSkillLaunch?: AgentPendingServiceSkillLaunchParams;
  /** 进入 Agent 后自动打开项目内某个文件 */
  initialProjectFileOpenTarget?: AgentProjectFileOpenTarget;
  /** 首页点击触发的新会话标记（时间戳） */
  newChatAt?: number;
}

/**
 * 设置页面参数
 */
export type SettingsProviderView = "settings" | "cloud" | "companion";

export interface SettingsPageParams {
  tab?: SettingsTabs;
  providerView?: SettingsProviderView;
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

export interface SkillScaffoldDraft extends Record<string, unknown> {
  target?: SkillScaffoldTarget;
  directory?: string;
  name?: string;
  description?: string;
  whenToUse?: string[];
  inputs?: string[];
  outputs?: string[];
  steps?: string[];
  fallbackStrategy?: string[];
  sourceMessageId?: string;
  sourceExcerpt?: string;
}

export interface SkillsPageParams {
  initialScaffoldDraft?: SkillScaffoldDraft;
  initialScaffoldRequestKey?: number;
  creationProjectId?: string;
}

export type AutomationWorkspaceTab = "tasks" | "overview";

export interface AutomationPageParams {
  selectedJobId?: string;
  workspaceTab?: AutomationWorkspaceTab;
}

export interface BrowserRuntimePageParams {
  projectId?: string;
  contentId?: string;
  initialProfileKey?: string;
  initialSessionId?: string;
  initialTargetId?: string;
  initialAdapterName?: string;
  initialArgs?: Record<string, unknown>;
  initialAutoRun?: boolean;
  initialRequireAttachedSession?: boolean;
  initialSaveTitle?: string;
}

export interface AgentSiteSkillLaunchParams {
  adapterName: string;
  args?: Record<string, unknown>;
  autoRun?: boolean;
  profileKey?: string;
  targetId?: string;
  requireAttachedSession?: boolean;
  preferredBackend?: "lime_extension_bridge" | "cdp_direct";
  autoLaunch?: boolean;
  saveTitle?: string;
  skillTitle?: string;
}

export interface AgentProjectFileOpenTarget {
  relativePath: string;
  requestKey?: number;
}

/**
 * 页面参数联合类型
 */
export type PageParams =
  | AgentPageParams
  | AutomationPageParams
  | BrowserRuntimePageParams
  | SettingsPageParams
  | OpenClawPageParams
  | SkillsPageParams
  | MemoryPageParams
  | Record<string, unknown>;
