/**
 * 项目分类过滤组件
 *
 * 显示项目类型过滤标签
 */

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { TYPE_CONFIGS, type UserType } from "@/lib/api/project";
import { getConfig } from "@/lib/api/appConfig";
import {
  DEFAULT_ENABLED_CONTENT_THEME_IDS,
  resolveEnabledContentThemes,
} from "@/lib/contentCreator/themeDefaults";

export type ProjectFilter = "all" | UserType | "favorites" | "archived";

interface ProjectCategoriesProps {
  currentFilter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
  counts?: Record<ProjectFilter, number>;
}

const allFilterItems: { id: ProjectFilter; label: string; icon?: string }[] = [
  { id: "all", label: "全部" },
  {
    id: "general",
    label: TYPE_CONFIGS.general.label,
    icon: TYPE_CONFIGS.general.icon,
  },
  {
    id: "social-media",
    label: TYPE_CONFIGS["social-media"].label,
    icon: TYPE_CONFIGS["social-media"].icon,
  },
  {
    id: "poster",
    label: TYPE_CONFIGS.poster.label,
    icon: TYPE_CONFIGS.poster.icon,
  },
  {
    id: "music",
    label: TYPE_CONFIGS.music.label,
    icon: TYPE_CONFIGS.music.icon,
  },
  {
    id: "knowledge",
    label: TYPE_CONFIGS.knowledge.label,
    icon: TYPE_CONFIGS.knowledge.icon,
  },
  {
    id: "planning",
    label: TYPE_CONFIGS.planning.label,
    icon: TYPE_CONFIGS.planning.icon,
  },
  {
    id: "document",
    label: TYPE_CONFIGS.document.label,
    icon: TYPE_CONFIGS.document.icon,
  },
  {
    id: "video",
    label: TYPE_CONFIGS.video.label,
    icon: TYPE_CONFIGS.video.icon,
  },
  {
    id: "novel",
    label: TYPE_CONFIGS.novel.label,
    icon: TYPE_CONFIGS.novel.icon,
  },
  { id: "favorites", label: "收藏", icon: "⭐" },
  { id: "archived", label: "归档", icon: "📦" },
];

export function ProjectCategories({
  currentFilter,
  onFilterChange,
  counts,
}: ProjectCategoriesProps) {
  // 从配置中读取启用的主题
  const [enabledThemes, setEnabledThemes] = useState<string[]>(
    DEFAULT_ENABLED_CONTENT_THEME_IDS,
  );

  // 加载配置
  useEffect(() => {
    const loadEnabledThemes = async () => {
      try {
        const config = await getConfig();
        setEnabledThemes(
          resolveEnabledContentThemes(config.content_creator?.enabled_themes),
        );
      } catch (e) {
        console.error("加载主题配置失败:", e);
      }
    };
    loadEnabledThemes();

    // 监听主题配置变更事件
    const handleThemeConfigChange = () => {
      loadEnabledThemes();
    };
    window.addEventListener("theme-config-changed", handleThemeConfigChange);

    return () => {
      window.removeEventListener(
        "theme-config-changed",
        handleThemeConfigChange,
      );
    };
  }, []);

  // 过滤后的标签列表
  const filterItems = useMemo(() => {
    return allFilterItems.filter((item) => {
      // all, favorites, archived 始终显示
      if (["all", "favorites", "archived"].includes(item.id)) {
        return true;
      }
      // 其他根据配置过滤
      return enabledThemes.includes(item.id);
    });
  }, [enabledThemes]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {filterItems.map((item) => {
        const count = counts?.[item.id];
        return (
          <button
            key={item.id}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
              "flex items-center gap-1.5",
              currentFilter === item.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
            onClick={() => onFilterChange(item.id)}
          >
            {item.icon && <span>{item.icon}</span>}
            <span>{item.label}</span>
            {count !== undefined && count > 0 && (
              <span
                className={cn(
                  "ml-1 px-1.5 py-0.5 text-xs rounded-full",
                  currentFilter === item.id
                    ? "bg-primary-foreground/20"
                    : "bg-background",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
