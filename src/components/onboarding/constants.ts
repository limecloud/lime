/**
 * 初次安装引导 - 常量配置
 */

/**
 * 用户群体类型
 */
export type UserProfile = "developer" | "general";

/**
 * 引导版本号 - 用于控制是否重新显示引导
 * 当前引导只保留语音体验流程，不再包含旧插件安装链路
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
