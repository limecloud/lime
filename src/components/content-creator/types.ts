/**
 * @file 内容创作模块类型定义
 * @description 定义内容创作相关的核心类型
 * @module components/content-creator/types
 */

import type React from "react";
import type {
  CreationMode,
  LayoutMode,
  StepStatus,
  StepType,
  ThemeType,
} from "@/lib/workspace/workbenchContract";

export type {
  ThemeType,
  CreationMode,
  LayoutMode,
  StepType,
  StepStatus,
} from "@/lib/workspace/workbenchContract";

/**
 * 共享主题 / 布局 / 流程状态类型已收口到 lib/workspace/workbenchContract。
 * 本文件保留 re-export，避免现役 content-creator 内部模块在本轮治理中被迫联动改动。
 */

/**
 * 表单字段类型
 */
export type FormFieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "slider"
  | "tags"
  | "outline";

/**
 * 表单字段配置
 */
export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
}

/**
 * 表单配置
 */
export interface FormConfig {
  fields: FormField[];
  submitLabel: string;
  skipLabel?: string;
}

/**
 * AI 任务配置
 */
export interface AITaskConfig {
  taskType: string;
  prompt?: string;
  streaming?: boolean;
}

/**
 * 步骤行为配置
 */
export interface StepBehavior {
  skippable: boolean;
  redoable: boolean;
  autoAdvance: boolean;
}

/**
 * 步骤定义
 */
export interface StepDefinition {
  id: string;
  type: StepType;
  title: string;
  description?: string;
  form?: FormConfig;
  aiTask?: AITaskConfig;
  behavior: StepBehavior;
}

/**
 * 步骤结果
 */
export interface StepResult {
  userInput?: Record<string, unknown>;
  aiOutput?: unknown;
  artifacts?: ContentFile[];
}

/**
 * 工作流步骤
 */
export interface WorkflowStep extends StepDefinition {
  status: StepStatus;
  result?: StepResult;
}

/**
 * 内容文件
 */
export interface ContentFile {
  id: string;
  name: string;
  type: string;
  content?: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 画布状态基础接口
 */
export interface BaseCanvasState {
  type: string;
}

/**
 * 文档画布状态
 */
export interface DocumentCanvasState extends BaseCanvasState {
  type: "document";
  content: string;
  platform: "wechat" | "xiaohongshu" | "zhihu" | "markdown";
  versions: { id: string; content: string; createdAt: number }[];
  currentVersion: string;
}

/**
 * 画布状态联合类型
 */
export type CanvasState = DocumentCanvasState; // 后续添加更多画布类型

/**
 * 画布组件 Props
 */
export interface CanvasProps {
  state: CanvasState;
  onStateChange: (state: CanvasState) => void;
}

/**
 * 工具栏组件 Props
 */
export interface ToolbarProps {
  canvasState: CanvasState;
  onStateChange: (state: CanvasState) => void;
  onClose: () => void;
}

/**
 * 画布插件定义
 */
export interface CanvasPlugin {
  type: string;
  name: string;
  icon: string;
  supportedThemes: ThemeType[];
  supportedFileTypes: string[];
  component: React.ComponentType<CanvasProps>;
  toolbar?: React.ComponentType<ToolbarProps>;
}

/**
 * 内容创作状态
 */
export interface ContentCreatorState {
  mode: LayoutMode;
  theme: ThemeType;
  creationMode: CreationMode;
  activeFile: ContentFile | null;
  canvas: CanvasState | null;
  workflow: {
    steps: WorkflowStep[];
    currentStepIndex: number;
  };
}
