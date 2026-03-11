/**
 * @file 通用对话类型定义
 * @description 定义通用对话模块的核心类型
 * @module components/chat/types
 */

/**
 * 消息角色类型
 */
export type MessageRole = "user" | "assistant" | "system";

/**
 * 消息接口
 */
export interface Message {
  /** 消息唯一标识 */
  id: string;
  /** 消息角色 */
  role: MessageRole;
  /** 消息内容 */
  content: string;
  /** 消息时间戳 */
  timestamp: number;
  /** 元数据 */
  metadata?: {
    /** 使用的模型 */
    model?: string;
    /** Token 使用量 */
    tokens?: number;
    /** 响应耗时（毫秒） */
    duration?: number;
  };
}

/**
 * 对话状态
 */
export interface ChatState {
  /** 消息列表 */
  messages: Message[];
  /** 是否正在生成 */
  isGenerating: boolean;
  /** 错误信息 */
  error: string | null;
}

/**
 * 对话操作
 */
export interface ChatActions {
  /** 发送消息 */
  sendMessage: (content: string) => Promise<void>;
  /** 清空消息 */
  clearMessages: () => void;
  /** 重试最后一条消息 */
  retryLastMessage: () => Promise<void>;
  /** 停止生成 */
  stopGeneration: () => void;
}

/**
 * 主题类型
 *
 * @deprecated 仅供遗留 `components/chat` UI 资产使用，请改用现役内容创作或统一对话主题类型。
 */
export type ThemeType =
  | "general" // 通用对话（默认）
  | "knowledge" // 知识探索
  | "planning" // 计划规划
  | "social-media" // 社媒内容
  | "poster" // 图文海报
  | "document" // 办公文档
  | "paper" // 学术论文
  | "novel" // 小说创作
  | "script" // 短剧脚本
  | "music" // 歌词曲谱
  | "video"; // 短视频

/**
 * 主题配置
 *
 * @deprecated 仅供遗留 `components/chat` UI 资产使用。
 */
export interface ThemeConfig {
  id: ThemeType;
  name: string;
  icon: string;
  description: string;
}

/**
 * 主题配置列表
 *
 * @deprecated 仅供遗留 `components/chat` UI 资产使用。
 */
export const THEME_CONFIGS: ThemeConfig[] = [
  {
    id: "general",
    name: "通用对话",
    icon: "💬",
    description: "打开即用，纯对话",
  },
  {
    id: "knowledge",
    name: "知识探索",
    icon: "🔍",
    description: "深度搜索、概念解析",
  },
  {
    id: "planning",
    name: "计划规划",
    icon: "📅",
    description: "日程、项目计划",
  },
  {
    id: "social-media",
    name: "社媒内容",
    icon: "📱",
    description: "公众号、小红书等",
  },
  { id: "poster", name: "图文海报", icon: "🖼️", description: "海报、封面设计" },
  { id: "document", name: "办公文档", icon: "📄", description: "Word、报告" },
  { id: "paper", name: "学术论文", icon: "📚", description: "LaTeX 论文" },
  { id: "novel", name: "小说创作", icon: "📖", description: "长篇小说" },
  { id: "script", name: "短剧脚本", icon: "🎭", description: "短剧、微电影" },
  { id: "music", name: "歌词曲谱", icon: "🎵", description: "歌词、简谱" },
  { id: "video", name: "短视频", icon: "🎬", description: "视频脚本" },
];
