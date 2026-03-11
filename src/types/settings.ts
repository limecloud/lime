/**
 * 设置页面类型定义
 *
 * 定义设置分组和标签页的枚举
 */

/**
 * 设置分组 Key
 */
export enum SettingsGroupKey {
  Account = "account",
  General = "general",
  Agent = "agent",
  System = "system",
}

/**
 * 设置标签页
 */
export enum SettingsTabs {
  // 账号
  Profile = "profile",
  Stats = "stats",

  // 通用
  Appearance = "appearance",
  ChatAppearance = "chat-appearance",
  Hotkeys = "hotkeys",
  Memory = "memory",

  // 智能体
  Providers = "providers",
  Assistant = "assistant",
  Skills = "skills",
  ImageGen = "image-gen",
  VideoGen = "video-gen",
  Voice = "voice",

  // 系统
  ApiServer = "api-server",
  McpServer = "mcp-server",
  Channels = "channels",
  WebSearch = "web-search",
  Environment = "environment",
  ChromeRelay = "chrome-relay",
  SecurityPerformance = "security-performance",
  Heartbeat = "heartbeat",
  ExecutionTracker = "execution-tracker",

  Experimental = "experimental",
  Developer = "developer",
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
  experimental?: boolean;
}

/**
 * 分组到标签页的映射
 */
export const SETTINGS_GROUPS: Record<SettingsGroupKey, SettingsTabs[]> = {
  [SettingsGroupKey.Account]: [SettingsTabs.Profile, SettingsTabs.Stats],
  [SettingsGroupKey.General]: [
    SettingsTabs.Appearance,
    SettingsTabs.ChatAppearance,
    SettingsTabs.Hotkeys,
    SettingsTabs.Memory,
  ],
  [SettingsGroupKey.Agent]: [
    SettingsTabs.Providers,
    SettingsTabs.Assistant,
    SettingsTabs.Skills,
    SettingsTabs.ImageGen,
    SettingsTabs.VideoGen,
    SettingsTabs.Voice,
  ],
  [SettingsGroupKey.System]: [
    SettingsTabs.ApiServer,
    SettingsTabs.McpServer,
    SettingsTabs.Channels,
    SettingsTabs.WebSearch,
    SettingsTabs.Environment,
    SettingsTabs.ChromeRelay,
    SettingsTabs.SecurityPerformance,
    SettingsTabs.Heartbeat,
    SettingsTabs.ExecutionTracker,

    SettingsTabs.Experimental,
    SettingsTabs.Developer,
    SettingsTabs.About,
  ],
};
