/**
 * @file 画布工厂组件
 * @description 根据主题类型动态渲染对应的画布组件
 * @module components/workspace/canvas/CanvasFactory
 */

import React, { memo, useMemo } from "react";
import type { ThemeType } from "@/lib/workspace/workflowTypes";
import { DocumentCanvas } from "@/components/workspace/document/DocumentCanvas";
import type {
  AutoContinueRunPayload,
  ContentReviewRunPayload,
  DocumentCanvasState,
  TextStylizeRunPayload,
} from "@/components/workspace/document/types";
import { VideoCanvas } from "@/components/workspace/video/VideoCanvas";
import type { VideoCanvasState } from "@/components/workspace/video/types";
import { DesignCanvas } from "@/components/workspace/design/DesignCanvas";
import type { DesignCanvasState } from "@/components/workspace/design/types";
import type {
  AnalyzeLayeredDesignFlatImage,
  LayeredDesignAnalyzerModelSlotConfigInput,
} from "@/lib/layered-design";
import { getCanvasTypeForTheme, type CanvasStateUnion } from "./canvasUtils";

/**
 * 画布工厂 Props
 */
interface CanvasFactoryProps {
  /** 当前主题 */
  theme: ThemeType;
  /** 画布状态 */
  state: CanvasStateUnion;
  /** 状态变更回调 */
  onStateChange: (state: CanvasStateUnion) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 返回首页回调 */
  onBackHome?: () => void;
  /** 是否正在流式输出（仅文档画布使用） */
  isStreaming?: boolean;
  /** 画布选中文本变更 */
  onSelectionTextChange?: (text: string) => void;
  /** 当前项目 ID（用于跨页面插图） */
  projectId?: string | null;
  /** 当前文稿 ID（用于跨页面插图） */
  contentId?: string | null;
  /** 当前项目根目录（用于图层设计图片任务） */
  projectRootPath?: string | null;
  /** 图层设计图片任务优先使用的 Provider */
  imageGenerationProviderId?: string | null;
  /** 图层设计图片任务优先使用的模型 */
  imageGenerationModelId?: string | null;
  /** 图层设计扁平图 analyzer 注入（DEV smoke / 测试使用） */
  designAnalyzeFlatImage?: AnalyzeLayeredDesignFlatImage;
  /** 图层设计 analyzer model slot config（DEV smoke / 测试导出审计使用） */
  designAnalyzerModelSlotConfigs?: readonly LayeredDesignAnalyzerModelSlotConfigInput[];
  /** 自动配图主题关键词 */
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
  /** 文本风格化执行回调 */
  onTextStylizeRun?: (
    payload: TextStylizeRunPayload,
  ) => Promise<string> | string;
  /** 文档评审面板位置 */
  documentContentReviewPlacement?: "inline" | "external-rail";
}

/**
 * 画布工厂组件
 *
 * 根据画布状态类型动态渲染对应的画布组件
 * 优先使用 state.type 来决定渲染哪个画布，以支持 general 等主题
 */
export const CanvasFactory: React.FC<CanvasFactoryProps> = memo(
  ({
    theme,
    state,
    onStateChange,
    onClose,
    onBackHome,
    isStreaming,
    onSelectionTextChange,
    projectId,
    contentId,
    projectRootPath,
    imageGenerationProviderId,
    imageGenerationModelId,
    designAnalyzeFlatImage,
    designAnalyzerModelSlotConfigs,
    autoImageTopic,
    autoContinueProviderType,
    onAutoContinueProviderTypeChange,
    autoContinueModel,
    onAutoContinueModelChange,
    autoContinueThinkingEnabled,
    onAutoContinueThinkingEnabledChange,
    onAutoContinueRun,
    onAddImage,
    onImportDocument,
    onContentReviewRun,
    onTextStylizeRun,
    documentContentReviewPlacement = "inline",
  }) => {
    const resolvedBackHome = onBackHome ?? onClose;

    // 优先根据 state.type 渲染，这样 general 主题也能显示文档画布
    // 只有当 state.type 与 theme 对应的 canvasType 不匹配时才检查 theme
    const canvasType = useMemo(() => {
      // 如果 state 有明确的类型，直接使用
      if (state.type) {
        return state.type;
      }
      // 否则根据 theme 获取
      return getCanvasTypeForTheme(theme);
    }, [theme, state.type]);

    // 根据画布类型渲染对应组件
    if (canvasType === "document" && state.type === "document") {
      return (
        <DocumentCanvas
          state={state}
          onStateChange={onStateChange as (s: DocumentCanvasState) => void}
          onBackHome={resolvedBackHome}
          onClose={onClose}
          isStreaming={isStreaming}
          onSelectionTextChange={onSelectionTextChange}
          projectId={projectId}
          contentId={contentId}
          autoImageTopic={autoImageTopic}
          autoContinueProviderType={autoContinueProviderType}
          onAutoContinueProviderTypeChange={onAutoContinueProviderTypeChange}
          autoContinueModel={autoContinueModel}
          onAutoContinueModelChange={onAutoContinueModelChange}
          autoContinueThinkingEnabled={autoContinueThinkingEnabled}
          onAutoContinueThinkingEnabledChange={
            onAutoContinueThinkingEnabledChange
          }
          onAutoContinueRun={onAutoContinueRun}
          onAddImage={onAddImage}
          onImportDocument={onImportDocument}
          onContentReviewRun={onContentReviewRun}
          onTextStylizeRun={onTextStylizeRun}
          contentReviewPlacement={documentContentReviewPlacement}
        />
      );
    }

    if (canvasType === "video" && state.type === "video") {
      return (
        <VideoCanvas
          state={state}
          onStateChange={onStateChange as (s: VideoCanvasState) => void}
          onBackHome={resolvedBackHome}
          onClose={onClose}
          projectId={projectId}
          contentId={contentId}
        />
      );
    }

    if (canvasType === "design" && state.type === "design") {
      return (
        <DesignCanvas
          state={state}
          onStateChange={onStateChange as (s: DesignCanvasState) => void}
          onBackHome={resolvedBackHome}
          onClose={onClose}
          projectRootPath={projectRootPath}
          projectId={projectId}
          contentId={contentId}
          imageGenerationProviderId={imageGenerationProviderId}
          imageGenerationModelId={imageGenerationModelId}
          analyzeFlatImage={designAnalyzeFlatImage}
          analyzerModelSlotConfigs={designAnalyzerModelSlotConfigs}
        />
      );
    }

    // 不支持的主题或状态类型不匹配
    return null;
  },
);

CanvasFactory.displayName = "CanvasFactory";
