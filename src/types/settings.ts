/**
 * 设置页面类型定义
 *
 * 定义设置分组和标签页的枚举
 */

/**
 * 设置分组 Key
 */
export enum SettingsGroupKey {
  Personal = "personal",
  Integrations = "integrations",
  Coding = "coding",
}

/**
 * 设置标签页
 */
export enum SettingsTabs {
  General = "general",
  Voice = "voice",
  // 账号
  Profile = "profile",

  // 通用
  Appearance = "appearance",
  Browser = "browser-use",
  KeyboardShortcuts = "keyboard-shortcuts",
  Memory = "memory",
  ArchivedConversations = "archived-conversations",
  Storage = "storage",
  Configuration = "configuration",

  // 智能体
  Providers = "providers",
  Plugins = "plugins-settings",
  MediaServices = "media-services",

  // 系统
  Hooks = "hooks",
  LocalEnvironments = "local-environments",
  Git = "git",
  Worktrees = "worktrees",
  ExecutionPolicy = "execution-policy",

  About = "about",
}

/**
 * 分组信息
 */
export interface SettingsGroupInfo {
  key: SettingsGroupKey;
  labelKey: string; // i18n key
}

/**
 * 标签页信息
 */
export interface SettingsTabInfo {
  key: SettingsTabs;
  labelKey: string; // i18n key
  group: SettingsGroupKey;
}
