/**
 * 初次安装引导 - 常量配置
 */

import { Code, User, FileCode } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 用户群体类型
 */
export type UserProfile = "developer" | "general";

/**
 * 用户群体配置
 */
export interface UserProfileConfig {
  id: UserProfile;
  name: string;
  description: string;
  icon: LucideIcon;
  defaultPlugins: string[];
}

/**
 * 引导插件配置
 */
export interface OnboardingPlugin {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  downloadUrl: string;
}

/**
 * 用户群体列表
 */
export const userProfiles: UserProfileConfig[] = [
  {
    id: "developer",
    name: "程序员",
    description: "使用 Claude、Codex、Gemini 等 AI 编程工具",
    icon: Code,
    defaultPlugins: ["config-switch"],
  },
  {
    id: "general",
    name: "普通用户",
    description: "日常使用 AI 聊天和其他功能",
    icon: User,
    defaultPlugins: [],
  },
];

/**
 * 可安装插件列表
 */
export const onboardingPlugins: OnboardingPlugin[] = [
  {
    id: "config-switch",
    name: "配置管理",
    description: "一键切换 API 配置，支持 Claude、Codex、Gemini 等客户端",
    icon: FileCode,
    downloadUrl:
      "https://github.com/aiclientproxy/config-switch/releases/latest/download/config-switch-plugin.zip",
  },
];

/**
 * 引导版本号 - 用于控制是否重新显示引导
 * 更新此版本号会触发已完成引导的用户重新看到引导
 */
export const ONBOARDING_VERSION = "1.1.0";

/**
 * localStorage 键名
 */
export const STORAGE_KEYS = {
  ONBOARDING_COMPLETE: "lime_onboarding_complete",
  ONBOARDING_VERSION: "lime_onboarding_version",
  USER_PROFILE: "lime_user_profile",
} as const;
