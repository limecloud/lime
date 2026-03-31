/**
 * @file Artifact 列表组件
 * @description 显示当前消息中的所有 artifacts，支持选择交互
 * @module components/artifact/ArtifactList
 * @requirements 10.2
 */

import React, { memo, useCallback } from "react";
import {
  Code,
  Globe,
  Image,
  GitBranch,
  Component,
  FileText,
  Film,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Artifact, ArtifactType } from "@/lib/artifact/types";

/**
 * ArtifactList Props
 */
export interface ArtifactListProps {
  /** Artifact 列表 */
  artifacts: Artifact[];
  /** 当前选中的 Artifact ID */
  selectedId?: string | null;
  /** 选择回调 */
  onSelect?: (id: string) => void;
  /** 自定义类名 */
  className?: string;
}

/**
 * 获取 Artifact 类型对应的图标组件
 * @param type - Artifact 类型
 * @returns 图标组件
 */
function getTypeIcon(type: ArtifactType): React.ReactNode {
  const iconClass = "w-4 h-4";

  switch (type) {
    case "document":
      return <FileText className={iconClass} />;
    case "code":
      return <Code className={iconClass} />;
    case "html":
      return <Globe className={iconClass} />;
    case "svg":
      return <Image className={iconClass} />;
    case "mermaid":
      return <GitBranch className={iconClass} />;
    case "react":
      return <Component className={iconClass} />;
    case "browser_assist":
      return <Globe className={iconClass} />;
    case "canvas:document":
      return <FileText className={iconClass} />;
    case "canvas:video":
      return <Film className={iconClass} />;
    default:
      return <FileText className={iconClass} />;
  }
}

/**
 * 获取 Artifact 类型的显示名称
 * @param type - Artifact 类型
 * @returns 显示名称
 */
function getTypeDisplayName(type: ArtifactType): string {
  const displayNames: Record<ArtifactType, string> = {
    document: "文档",
    code: "代码",
    html: "HTML",
    svg: "SVG",
    mermaid: "图表",
    react: "React",
    browser_assist: "浏览器协助",
    "canvas:document": "文档",
    "canvas:video": "视频",
  };

  return displayNames[type] || type;
}

/**
 * 单个 Artifact 列表项 Props
 */
interface ArtifactListItemProps {
  artifact: Artifact;
  isSelected: boolean;
  onSelect: () => void;
}

/**
 * 单个 Artifact 列表项组件
 */
const ArtifactListItem: React.FC<ArtifactListItemProps> = memo(
  ({ artifact, isSelected, onSelect }) => {
    const isStreaming = artifact.status === "streaming";

    return (
      <button
        onClick={onSelect}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-all",
          "hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-white/20",
          isSelected
            ? "bg-white/10 text-white border-l-2 border-blue-500"
            : "text-gray-400 border-l-2 border-transparent",
        )}
      >
        {/* 类型图标 */}
        <span
          className={cn(
            "shrink-0",
            isSelected ? "text-blue-400" : "text-gray-500",
          )}
        >
          {getTypeIcon(artifact.type)}
        </span>

        {/* 标题和类型 */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{artifact.title}</div>
          <div className="text-xs text-gray-500 truncate">
            {getTypeDisplayName(artifact.type)}
            {artifact.meta.language && ` · ${artifact.meta.language}`}
          </div>
        </div>

        {/* 流式状态指示器 */}
        {isStreaming && (
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
        )}
      </button>
    );
  },
);

ArtifactListItem.displayName = "ArtifactListItem";

/**
 * Artifact 列表组件
 *
 * 功能特性：
 * - 显示 artifact 列表，包含类型图标和标题 (Requirement 10.2)
 * - 支持选择交互，高亮选中项
 * - 显示流式状态指示器（streaming 状态时显示加载动画）
 * - 紧凑的垂直布局，适合侧边面板
 *
 * @param artifacts - Artifact 列表
 * @param selectedId - 当前选中的 Artifact ID
 * @param onSelect - 选择回调
 * @param className - 自定义类名
 */
export const ArtifactList: React.FC<ArtifactListProps> = memo(
  ({ artifacts, selectedId, onSelect, className }) => {
    /**
     * 处理选择事件
     */
    const handleSelect = useCallback(
      (id: string) => {
        onSelect?.(id);
      },
      [onSelect],
    );

    // 如果没有 artifacts，不渲染
    if (artifacts.length === 0) {
      return null;
    }

    return (
      <div
        className={cn(
          "flex flex-col border-b border-white/10 bg-[#1e2227]",
          className,
        )}
      >
        {/* 列表标题 */}
        <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
          Artifacts ({artifacts.length})
        </div>

        {/* 列表内容 */}
        <div className="max-h-48 overflow-y-auto">
          {artifacts.map((artifact) => (
            <ArtifactListItem
              key={artifact.id}
              artifact={artifact}
              isSelected={artifact.id === selectedId}
              onSelect={() => handleSelect(artifact.id)}
            />
          ))}
        </div>
      </div>
    );
  },
);

ArtifactList.displayName = "ArtifactList";

export default ArtifactList;
