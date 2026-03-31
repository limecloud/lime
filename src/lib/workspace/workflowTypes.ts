/**
 * @file 工作台流程共享类型定义
 * @description 定义工作台流程、画布与步骤相关的共享类型
 * @module lib/workspace/workflowTypes
 */

import type React from "react";
import type {
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
 * 本文件补充工作流步骤与画布相关的共享类型，供工作台现役模块复用。
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
}

/**
 * 工作流步骤
 */
export interface WorkflowStep extends StepDefinition {
  status: StepStatus;
  result?: StepResult;
}

export interface CanvasRegistrationState {
  type: string;
}

/**
 * 画布组件 Props
 */
export interface CanvasProps {
  state: CanvasRegistrationState;
  onStateChange: (state: CanvasRegistrationState) => void;
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
}
