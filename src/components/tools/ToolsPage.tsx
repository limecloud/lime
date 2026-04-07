/**
 * 工具箱页面组件
 *
 * 显示所有可用工具，包括内置工具和插件工具
 * 支持从插件系统动态获取工具列表
 * 支持推荐插件一键安装
 *
 * _需求: 1.2, 2.1, 2.2_
 */

import React, { useState, useEffect, useCallback } from "react";
import { Package, Loader2, ArrowLeft, type LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPluginsForSurface, type PluginUIInfo } from "@/lib/api/pluginUI";
import {
  disablePlugin,
  enablePlugin,
  uninstallPlugin,
} from "@/lib/api/plugins";
import { PluginInstallDialog } from "@/components/plugins/PluginInstallDialog";
import { ToolCardContextMenu } from "./ToolCardContextMenu";
import { toast } from "sonner";
import { ImageAnalysisTool } from "./image-analysis";
import type { Page, PageParams } from "@/types/page";

interface ToolsPageProps {
  /**
   * 页面导航回调
   * 支持静态页面和动态插件页面
   */
  onNavigate: (page: Page, params?: PageParams) => void;
}

/**
 * 动态工具卡片数据结构
 */
interface DynamicToolCard {
  /** 工具 ID */
  id: string;
  /** 工具标题 */
  title: string;
  /** 工具描述 */
  description: string;
  /** 图标名称 (Lucide 图标) */
  icon: string;
  /** 工具来源: builtin (内置) 或 plugin (插件) */
  source: "builtin" | "plugin";
  /** 插件 ID (仅插件工具) */
  pluginId?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 状态文本 */
  status?: string;
}

interface ToolCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  status?: string;
  disabled?: boolean;
  onClick?: () => void;
  source?: "builtin" | "plugin";
}

/**
 * 根据图标名称获取 Lucide 图标组件
 *
 * @param iconName - 图标名称 (如 "Cpu", "Globe")
 * @returns Lucide 图标组件
 */
function getLucideIcon(iconName: string): LucideIcon {
  // 将图标名称转换为 PascalCase
  const pascalCase = iconName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  // 从 LucideIcons 中获取图标
  const Icon = (LucideIcons as any)[pascalCase] as LucideIcon | undefined;
  return Icon || Package;
}

/**
 * 工具卡片组件
 */
function ToolCard({
  title,
  description,
  icon,
  status,
  disabled = false,
  onClick,
  source,
}: ToolCardProps) {
  return (
    <Card
      className={`cursor-pointer transition-colors hover:bg-muted/50 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary/10 rounded-lg">{icon}</div>
            <div>
              <CardTitle className="text-lg">{title}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                {status && (
                  <Badge
                    variant={status === "运行中" ? "default" : "secondary"}
                  >
                    {status}
                  </Badge>
                )}
                {source === "plugin" && (
                  <Badge variant="outline" className="text-xs">
                    插件
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm text-muted-foreground mb-4">
          {description}
        </CardDescription>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onClick}
          className="w-full"
        >
          {disabled ? "敬请期待" : "打开工具"}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * 内置工具列表
 */
const builtinTools: DynamicToolCard[] = [
  {
    id: "image-analysis",
    title: "图像分析",
    description: "使用 AI 分析图片内容，支持视觉理解和描述",
    icon: "Image",
    source: "builtin",
  },
];

/**
 * 占位工具列表 (敬请期待)
 */
const placeholderTools: DynamicToolCard[] = [
  {
    id: "network-monitor",
    title: "网络监控工具",
    description: "监控和分析网络请求，提供详细的流量分析",
    icon: "Activity",
    source: "builtin",
    disabled: true,
  },
  {
    id: "config-sync",
    title: "配置同步工具",
    description: "在多个设备间同步 Lime 配置",
    icon: "Settings",
    source: "builtin",
    disabled: true,
  },
  {
    id: "more-tools",
    title: "更多工具",
    description: "更多实用工具正在开发中...",
    icon: "Plus",
    source: "builtin",
    disabled: true,
  },
];

export function ToolsPage({ onNavigate }: ToolsPageProps) {
  const [pluginTools, setPluginTools] = useState<DynamicToolCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  // 加载插件工具和已安装插件列表
  const loadPluginTools = useCallback(async () => {
    try {
      const plugins = await getPluginsForSurface("tools");
      const tools: DynamicToolCard[] = plugins.map((plugin: PluginUIInfo) => ({
        id: `plugin:${plugin.pluginId}`,
        title: plugin.name,
        description: plugin.description,
        icon: plugin.icon || "Package",
        source: "plugin" as const,
        pluginId: plugin.pluginId,
      }));
      setPluginTools(tools);
    } catch (error) {
      console.error("加载插件工具失败:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 从插件系统获取工具列表
  useEffect(() => {
    loadPluginTools();
  }, [loadPluginTools]);

  // 处理安装成功
  const handleInstallSuccess = useCallback(() => {
    loadPluginTools();
  }, [loadPluginTools]);

  // 处理插件启用/禁用
  const handleTogglePluginEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      try {
        if (enabled) {
          await enablePlugin(pluginId);
          toast.success("插件已启用");
        } else {
          await disablePlugin(pluginId);
          toast.success("插件已禁用");
        }
        loadPluginTools();
      } catch (error) {
        console.error("切换插件状态失败:", error);
        toast.error("操作失败");
      }
    },
    [loadPluginTools],
  );

  // 处理插件卸载
  const handleUninstallPlugin = useCallback(
    async (pluginId: string) => {
      try {
        await uninstallPlugin(pluginId);
        toast.success("插件已卸载");
        loadPluginTools();
      } catch (error) {
        console.error("卸载插件失败:", error);
        toast.error("卸载失败");
      }
    },
    [loadPluginTools],
  );

  // 合并内置工具和插件工具
  const allTools = [...builtinTools, ...pluginTools, ...placeholderTools];
  const activeToolsCount = builtinTools.length + pluginTools.length;
  /**
   * 处理工具卡片点击
   */
  const handleToolClick = (tool: DynamicToolCard) => {
    if (tool.disabled) return;

    if (tool.source === "plugin" && tool.pluginId) {
      // 插件工具: 导航到 plugin:xxx 页面
      onNavigate(`plugin:${tool.pluginId}`);
    } else {
      // 内置工具: 在当前页面显示工具组件
      setSelectedTool(tool.id);
    }
  };

  /**
   * 返回工具列表
   */
  const handleBackToList = () => {
    setSelectedTool(null);
  };

  /**
   * 渲染工具图标
   */
  const renderIcon = (iconName: string, disabled?: boolean) => {
    const Icon = getLucideIcon(iconName);
    return (
      <Icon
        className={`w-6 h-6 ${disabled ? "text-muted-foreground" : "text-primary"}`}
      />
    );
  };

  // 如果选中了内置工具，显示该工具
  if (selectedTool === "image-analysis") {
    return (
      <div className="space-y-4">
        {/* 返回按钮 */}
        <Button variant="ghost" onClick={handleBackToList} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回工具列表
        </Button>

        {/* 工具组件 */}
        <ImageAnalysisTool />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">工具箱</h1>
          <p className="text-muted-foreground mt-1">Lime 提供的实用工具集合</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          <Badge variant="outline">{activeToolsCount} 个工具</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {allTools.map((tool) => (
          <ToolCardContextMenu
            key={tool.id}
            tool={tool}
            onNavigate={onNavigate}
            onToggleEnabled={handleTogglePluginEnabled}
            onUninstall={handleUninstallPlugin}
            isEnabled={true}
          >
            <div>
              <ToolCard
                title={tool.title}
                description={tool.description}
                icon={renderIcon(tool.icon, tool.disabled)}
                status={tool.status}
                disabled={tool.disabled}
                source={tool.source}
                onClick={() => handleToolClick(tool)}
              />
            </div>
          </ToolCardContextMenu>
        ))}
      </div>

      <div className="mt-8 p-6 bg-muted/30 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">关于工具箱</h3>
        <p className="text-sm text-muted-foreground">
          工具箱是 Lime 的扩展功能模块，提供各种实用工具来增强您的使用体验。
          每个工具都经过精心设计，旨在解决特定的使用场景和需求。
          {pluginTools.length > 0 && (
            <span className="block mt-2">
              当前已安装 {pluginTools.length} 个插件工具。
            </span>
          )}
        </p>
      </div>

      {/* 插件安装对话框 */}
      <PluginInstallDialog
        isOpen={showInstallDialog}
        onClose={() => {
          setShowInstallDialog(false);
        }}
        onSuccess={handleInstallSuccess}
      />
    </div>
  );
}
