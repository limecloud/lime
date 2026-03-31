/**
 * @file 文档画布类型定义
 * @description 定义文档画布相关的核心类型
 * @module components/workspace/document/types
 */

/**
 * 平台类型
 */
export type PlatformType = "wechat" | "xiaohongshu" | "zhihu" | "markdown";

/**
 * 导出格式
 */
export type ExportFormat = "markdown" | "word" | "text" | "clipboard";

/**
 * 文档版本
 */
export interface DocumentVersionMetadata {
  /** 产物 ID（用于同类版本聚合） */
  artifactId?: string;
  /** 父版本 ID（用于构建版本链） */
  parentVersionId?: string;
  /** 父产物 ID */
  parentArtifactId?: string;
  /** 产物类型 */
  artifactType?: string;
  /** 语义阶段 */
  stage?: string;
  /** 适配平台 */
  platform?: PlatformType;
  /** 来源文件名 */
  sourceFileName?: string;
  /** 关联运行 ID */
  runId?: string;
  /** 关联追踪 ID */
  correlationId?: string;
}

export interface DocumentVersion {
  /** 版本 ID */
  id: string;
  /** 文档内容 */
  content: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 版本描述 */
  description?: string;
  /** 版本元数据 */
  metadata?: DocumentVersionMetadata;
}

/**
 * 文档画布状态
 */
export interface DocumentCanvasState {
  /** 画布类型标识 */
  type: "document";
  /** 当前文档内容 */
  content: string;
  /** 当前平台 */
  platform: PlatformType;
  /** 版本历史 */
  versions: DocumentVersion[];
  /** 当前版本 ID */
  currentVersionId: string;
  /** 是否处于编辑模式 */
  isEditing: boolean;
}

/**
 * 文档画布 Props
 */
export interface DocumentCanvasProps {
  /** 画布状态 */
  state: DocumentCanvasState;
  /** 状态变更回调 */
  onStateChange: (state: DocumentCanvasState) => void;
  /** 返回首页回调 */
  onBackHome?: () => void;
  /** 关闭画布回调 */
  onClose: () => void;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 选中文本变更回调 */
  onSelectionTextChange?: (text: string) => void;
  /** 当前项目 ID（用于跨页面插图匹配） */
  projectId?: string | null;
  /** 当前文稿 ID（用于跨页面插图匹配） */
  contentId?: string | null;
  /** 自动配图的主题关键词 */
  autoImageTopic?: string;
  /** 自动续写同步的 Provider */
  autoContinueProviderType?: string;
  /** 自动续写 Provider 切换 */
  onAutoContinueProviderTypeChange?: (providerType: string) => void;
  /** 自动续写同步的模型 */
  autoContinueModel?: string;
  /** 自动续写模型切换 */
  onAutoContinueModelChange?: (model: string) => void;
  /** 自动续写同步的思考开关 */
  autoContinueThinkingEnabled?: boolean;
  /** 自动续写思考开关切换 */
  onAutoContinueThinkingEnabledChange?: (enabled: boolean) => void;
  /** 自动续写执行回调 */
  onAutoContinueRun?: (payload: AutoContinueRunPayload) => Promise<void> | void;
  /** 添加图片动作 */
  onAddImage?: () => Promise<void> | void;
  /** 导入文稿动作 */
  onImportDocument?: () => Promise<void> | void;
  /** 内容评审执行回调 */
  onContentReviewRun?: (
    payload: ContentReviewRunPayload,
  ) => Promise<string> | string;
  /** 内容评审面板位置 */
  contentReviewPlacement?: "inline" | "external-rail";
  /** 文本风格化执行回调 */
  onTextStylizeRun?: (
    payload: TextStylizeRunPayload,
  ) => Promise<string> | string;
}

/**
 * 自动续写设置
 */
export interface AutoContinueSettings {
  /** 自动续写主开关 */
  enabled: boolean;
  /** 是否开启快速模式 */
  fastModeEnabled: boolean;
  /** 续写长度：0=短，1=中，2=长 */
  continuationLength: number;
  /** 续写灵敏度：0-100 */
  sensitivity: number;
}

/**
 * 自动续写执行参数
 */
export interface AutoContinueRunPayload {
  /** 续写提示词 */
  prompt: string;
  /** 是否启用思考过程 */
  thinkingEnabled: boolean;
  /** 续写设置快照 */
  settings: AutoContinueSettings;
}

/**
 * 内容评审执行参数
 */
export interface ContentReviewRunPayload {
  /** 评审提示词 */
  prompt: string;
  /** 是否启用思考过程 */
  thinkingEnabled: boolean;
  /** 已选中的评审专家 */
  experts: ContentReviewExpert[];
}

/**
 * 文本风格化执行参数
 */
export interface TextStylizeRunPayload {
  /** 风格化提示词 */
  prompt: string;
  /** 是否启用思考过程 */
  thinkingEnabled: boolean;
  /** 原始内容 */
  originalContent: string;
}

/**
 * 内容评审专家
 */
export interface ContentReviewExpert {
  /** 专家 ID */
  id: string;
  /** 专家名称 */
  name: string;
  /** 专家定位 */
  title: string;
  /** 专家描述 */
  description: string;
  /** 专家标签 */
  tags: string[];
  /** 角标文案 */
  badgeText?: string;
  /** 头像文字 */
  avatarLabel: string;
  /** 头像底色 */
  avatarColor: string;
  /** 自定义头像 */
  avatarImageUrl?: string;
}

/**
 * 自定义内容评审专家输入
 */
export interface CustomContentReviewExpertInput {
  /** 专家名称 */
  name: string;
  /** 专家背景描述 */
  description: string;
  /** 自定义头像 */
  avatarImageUrl?: string;
}

/**
 * 文档工具栏 Props
 */
export interface DocumentToolbarProps {
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 导出回调 */
  onExport: (format: ExportFormat) => void;
  /** 自动配图动作 */
  onAutoInsertImages?: () => void;
  /** 添加图片动作 */
  onAddImage?: () => Promise<void> | void;
  /** 导入文稿动作 */
  onImportDocument?: () => Promise<void> | void;
  /** 文本风格化动作 */
  onTextStylize?: () => void;
  /** 文本风格化当前来源说明 */
  textStylizeSourceLabel?: string;
  /** 内容评审动作 */
  onContentReview?: () => void;
  /** 内容评审是否已打开 */
  contentReviewActive?: boolean;
  /** 撤销动作 */
  onUndo?: () => void;
  /** 重做动作 */
  onRedo?: () => void;
  /** 是否可以撤销 */
  canUndo?: boolean;
  /** 是否可以重做 */
  canRedo?: boolean;
  /** 自动续写设置 */
  autoContinueSettings: AutoContinueSettings;
  /** 自动续写当前 Provider */
  autoContinueProviderType: string;
  /** 自动续写 Provider 切换 */
  onAutoContinueProviderChange?: (providerType: string) => void;
  /** 自动续写当前模型 */
  selectedAutoContinueModel: string;
  /** 自动续写模型是否加载中 */
  autoContinueModelLoading?: boolean;
  /** 自动续写模型切换 */
  onAutoContinueModelChange?: (model: string) => void;
  /** 思考过程开关（沿用通用对话设置） */
  thinkingEnabled: boolean;
  /** 思考过程变更 */
  onThinkingChange?: (enabled: boolean) => void;
  /** 自动续写设置变更 */
  onAutoContinueSettingsChange?: (patch: Partial<AutoContinueSettings>) => void;
  /** 执行自动续写 */
  onAutoContinueRun?: () => void;
  /** 自动续写执行是否禁用 */
  autoContinueRunDisabled?: boolean;
}

/**
 * 文档渲染器 Props
 */
export interface DocumentRendererProps {
  /** 文档内容 */
  content: string;
  /** 平台类型 */
  platform: PlatformType;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 选中文本变更回调 */
  onSelectionTextChange?: (text: string) => void;
}

/**
 * 平台标签 Props
 */
export interface PlatformTabsProps {
  /** 当前平台 */
  currentPlatform: PlatformType;
  /** 平台切换回调 */
  onPlatformChange: (platform: PlatformType) => void;
}

/**
 * 平台配置
 */
export interface PlatformConfig {
  id: PlatformType;
  name: string;
  icon: string;
  description: string;
}

/**
 * 平台配置列表
 */
export const PLATFORM_CONFIGS: PlatformConfig[] = [
  { id: "wechat", name: "公众号", icon: "📱", description: "微信公众号样式" },
  {
    id: "xiaohongshu",
    name: "小红书",
    icon: "📕",
    description: "小红书笔记样式",
  },
  { id: "zhihu", name: "知乎", icon: "📝", description: "知乎专栏样式" },
  {
    id: "markdown",
    name: "Markdown",
    icon: "📄",
    description: "原始 Markdown",
  },
];

/**
 * 创建初始文档画布状态
 */
export function createInitialDocumentState(
  content: string = "",
): DocumentCanvasState {
  const initialVersion: DocumentVersion = {
    id: crypto.randomUUID(),
    content,
    createdAt: Date.now(),
    description: "初始版本",
  };

  return {
    type: "document",
    content,
    platform: "markdown",
    versions: [initialVersion],
    currentVersionId: initialVersion.id,
    isEditing: true,
  };
}
