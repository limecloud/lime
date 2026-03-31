/**
 * @file Canvas 适配器组件
 * @description 将 Canvas 类型的 Artifact 适配到现有 Canvas 系统
 * @module components/artifact/CanvasAdapter
 * @requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */

import React, { memo, useCallback, useMemo, useState, useEffect } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/lib/artifact/types";

// Canvas 系统导入
import {
  CanvasFactory,
  type CanvasStateUnion,
} from "@/lib/workspace/workbenchCanvas";

// 工具函数导入
import {
  getCanvasTypeFromArtifact,
  createCanvasStateFromArtifact,
  extractContentFromCanvasState,
  CANVAS_TYPE_LABELS,
  CANVAS_TYPE_ICONS,
} from "./canvasAdapterUtils";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Canvas 适配器 Props
 */
export interface CanvasAdapterProps {
  /** 要渲染的 Artifact 对象 */
  artifact: Artifact;
  /** 是否处于流式生成状态 */
  isStreaming?: boolean;
  /** 内容变更回调 */
  onContentChange?: (content: string) => void;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 辅助组件
// ============================================================================

/**
 * Canvas 加载骨架屏
 */
const CanvasLoadingSkeleton: React.FC = memo(() => (
  <div className="flex items-center justify-center h-full min-h-[300px] bg-[#1e2227]">
    <div className="flex flex-col items-center gap-3 text-gray-400">
      <Loader2 className="w-8 h-8 animate-spin" />
      <span className="text-sm">加载 Canvas...</span>
    </div>
  </div>
));
CanvasLoadingSkeleton.displayName = "CanvasLoadingSkeleton";

/**
 * Canvas 不支持提示
 */
const CanvasUnsupportedMessage: React.FC<{ canvasType: string }> = memo(
  ({ canvasType }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] bg-[#1e2227]">
      <div className="text-center p-6">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
          <span className="text-2xl">⚠️</span>
        </div>
        <h3 className="text-lg font-medium text-white mb-2">
          不支持的 Canvas 类型
        </h3>
        <p className="text-sm text-gray-400">
          类型 "{canvasType}" 暂不支持在此处渲染
        </p>
      </div>
    </div>
  ),
);
CanvasUnsupportedMessage.displayName = "CanvasUnsupportedMessage";

// ============================================================================
// 主组件
// ============================================================================

/**
 * Canvas 适配器组件
 *
 * 功能特性：
 * - 检测 Canvas 类型 (canvas:document, canvas:video；旧类型仅在边界归一) (Requirement 12.1)
 * - 将 Artifact 内容作为初始状态传递给 Canvas (Requirement 12.2)
 * - 同步 Canvas 状态变更回 Artifact (Requirement 12.3)
 * - 支持在完整 Canvas 编辑器模式中打开 (Requirement 12.4)
 * - 保留 Canvas 特定元数据 (platform, version 等) (Requirement 12.5)
 *
 * @param artifact - 要渲染的 Artifact 对象
 * @param isStreaming - 是否处于流式生成状态
 * @param onContentChange - 内容变更回调
 * @param className - 自定义类名
 *
 * @requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */
export const CanvasAdapter: React.FC<CanvasAdapterProps> = memo(
  ({ artifact, isStreaming = false, onContentChange, className }) => {
    // 获取 Canvas 类型
    const canvasType = useMemo(
      () => getCanvasTypeFromArtifact(artifact.type),
      [artifact.type],
    );

    // Canvas 状态管理
    // @requirements 12.2
    const [canvasState, setCanvasState] = useState<CanvasStateUnion | null>(
      () => createCanvasStateFromArtifact(artifact),
    );

    // 是否显示完整编辑器模式
    const [isFullEditorMode, setIsFullEditorMode] = useState(false);

    // 当 Artifact 内容变化时，更新 Canvas 状态
    // @requirements 12.2
    useEffect(() => {
      // 仅在非编辑模式下同步外部内容变化
      if (!isFullEditorMode) {
        const newState = createCanvasStateFromArtifact(artifact);
        if (newState) {
          setCanvasState(newState);
        }
      }
    }, [artifact, isFullEditorMode]);

    /**
     * 处理 Canvas 状态变更
     * 同步状态变更回 Artifact
     * @requirements 12.3
     */
    const handleStateChange = useCallback(
      (newState: CanvasStateUnion) => {
        setCanvasState(newState);

        // 提取内容并回调
        if (onContentChange) {
          const content = extractContentFromCanvasState(newState);
          onContentChange(content);
        }
      },
      [onContentChange],
    );

    /**
     * 处理关闭 Canvas
     */
    const handleClose = useCallback(() => {
      setIsFullEditorMode(false);
    }, []);

    /**
     * 打开完整编辑器模式
     * @requirements 12.4
     */
    const handleOpenFullEditor = useCallback(() => {
      setIsFullEditorMode(true);
      console.log("[CanvasAdapter] 打开完整 Canvas 编辑器:", artifact.type);
    }, [artifact.type]);

    // 不支持的 Canvas 类型
    if (!canvasType) {
      return (
        <div className={cn("h-full", className)}>
          <CanvasUnsupportedMessage canvasType={artifact.type} />
        </div>
      );
    }

    // Canvas 状态未初始化
    if (!canvasState) {
      return (
        <div className={cn("h-full", className)}>
          <CanvasLoadingSkeleton />
        </div>
      );
    }

    // 获取显示信息
    const label =
      CANVAS_TYPE_LABELS[canvasType as keyof typeof CANVAS_TYPE_LABELS];
    const icon =
      CANVAS_TYPE_ICONS[canvasType as keyof typeof CANVAS_TYPE_ICONS];

    return (
      <div className={cn("h-full flex flex-col bg-[#1e2227]", className)}>
        {/* Canvas 信息头部 */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-lg">{icon}</span>
            <span className="text-sm font-medium text-white">
              {label} Canvas
            </span>
            {isStreaming && (
              <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                生成中...
              </span>
            )}
          </div>
          <button
            onClick={handleOpenFullEditor}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
            title="在完整编辑器中打开"
          >
            <ExternalLink className="w-4 h-4" />
            <span>编辑</span>
          </button>
        </div>

        {/* Canvas 渲染区域 */}
        <div className="flex-1 overflow-hidden">
          <CanvasFactory
            theme="general"
            state={canvasState}
            onStateChange={handleStateChange}
            onBackHome={handleClose}
            onClose={handleClose}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    );
  },
);

CanvasAdapter.displayName = "CanvasAdapter";

export default CanvasAdapter;
