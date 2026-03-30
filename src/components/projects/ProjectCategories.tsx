/**
 * 项目分类过滤组件
 *
 * 显示项目类型过滤标签
 */

import { cn } from "@/lib/utils";
import { TYPE_CONFIGS, type UserType } from "@/lib/api/project";

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
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {allFilterItems.map((item) => {
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
