/**
 * @file SkillCard.tsx
 * @description Skill 卡片组件，展示单个 Skill 的信息和操作按钮
 *
 * 功能：
 * - 显示 Skill 基本信息（名称、描述、来源）
 * - 安装/卸载操作按钮（非内置）
 * - 执行按钮（仅已安装的 Skill 显示）
 * - 查看内容按钮（内置或本地且已安装的 Skill 显示）
 * - GitHub 链接按钮
 *
 * @module components/skills
 * @requirements 6.1, 6.3
 */

import {
  Download,
  Trash2,
  ExternalLink,
  Loader2,
  Play,
  FileText,
} from "lucide-react";
import type { Skill } from "@/lib/api/skills";

/**
 * Skill 来源类型
 * - builtin: ProxyCast 内置技能
 * - official: 来自 proxycast/skills 官方仓库
 * - community: 来自其他 GitHub 仓库
 * - local: 本地安装，无仓库信息
 */
export type SkillSource = "builtin" | "official" | "community" | "local";

/**
 * 判断 Skill 的来源类型
 *
 * @param skill - Skill 对象
 * @returns SkillSource - 来源类型
 *
 * 分类规则：
 * - "builtin": sourceKind="builtin"
 * - "official": repoOwner="proxycast" AND repoName="skills"
 * - "community": repoOwner 和 repoName 存在但不是 proxycast/skills
 * - "local": repoOwner 或 repoName 缺失
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getSkillSource(skill: Skill): SkillSource {
  if (skill.sourceKind === "builtin") {
    return "builtin";
  }
  if (!skill.repoOwner || !skill.repoName) {
    return "local";
  }
  if (skill.repoOwner === "proxycast" && skill.repoName === "skills") {
    return "official";
  }
  return "community";
}

/**
 * 是否可查看本地 Skill 内容
 *
 * 仅内置或本地且已安装的 Skill 支持查看 SKILL.md。
 *
 * @param skill - Skill 对象
 * @returns 是否显示查看内容入口
 */
// eslint-disable-next-line react-refresh/only-export-components
export function canViewLocalSkillContent(skill: Skill): boolean {
  const source = getSkillSource(skill);
  return skill.installed && (source === "builtin" || source === "local");
}

/**
 * 是否允许用户安装或卸载 Skill
 *
 * 内置 Skill 默认可用，不提供安装/卸载入口。
 *
 * @param skill - Skill 对象
 * @returns 是否显示安装/卸载操作
 */
// eslint-disable-next-line react-refresh/only-export-components
export function canManageSkillInstallation(skill: Skill): boolean {
  return skill.sourceKind !== "builtin";
}

/**
 * 来源标签配置
 */
const sourceConfig: Record<SkillSource, { label: string; className: string }> =
  {
    builtin: {
      label: "内置",
      className:
        "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    },
    official: {
      label: "官方",
      className:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    },
    community: {
      label: "社区",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    },
    local: {
      label: "本地",
      className:
        "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-400",
    },
  };

/**
 * 来源标签组件
 *
 * @param source - Skill 来源类型
 * @returns 带颜色的来源标签
 */
function SourceBadge({ source }: { source: SkillSource }) {
  const { label, className } = sourceConfig[source];

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

interface SkillCardProps {
  skill: Skill;
  onInstall: (directory: string) => void;
  onUninstall: (directory: string) => void;
  onExecute?: (skill: Skill) => void;
  onViewContent?: (skill: Skill) => void;
  installing: boolean;
}

/**
 * Skill 卡片组件
 *
 * 展示单个 Skill 的信息和操作按钮，包括：
 * - 安装/卸载按钮（非内置）
 * - 执行按钮（仅已安装的 Skill 显示）
 * - 查看内容按钮（仅内置或本地且已安装的 Skill 显示）
 * - GitHub 链接按钮
 *
 * @param props - 组件属性
 * @returns React 组件
 *
 * @requirements 6.1, 6.3
 */
export function SkillCard({
  skill,
  onInstall,
  onUninstall,
  onExecute,
  onViewContent,
  installing,
}: SkillCardProps) {
  const canManageInstallation = canManageSkillInstallation(skill);

  const handleAction = () => {
    if (installing || !canManageInstallation) return;
    if (skill.installed) {
      onUninstall(skill.directory);
    } else {
      onInstall(skill.directory);
    }
  };

  const openGithub = () => {
    if (skill.readmeUrl) {
      window.open(skill.readmeUrl, "_blank");
    }
  };

  /**
   * 处理执行按钮点击
   * 仅已安装的 Skill 可以执行
   */
  const handleExecute = () => {
    if (skill.installed && onExecute) {
      onExecute(skill);
    }
  };

  const handleViewContent = () => {
    if (onViewContent && canViewLocalSkillContent(skill)) {
      onViewContent(skill);
    }
  };

  const source = getSkillSource(skill);
  const showViewContent = Boolean(
    onViewContent && canViewLocalSkillContent(skill),
  );

  return (
    <div className="rounded-lg border bg-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-lg">{skill.name}</h3>
            <SourceBadge source={source} />
          </div>
          {skill.repoOwner && skill.repoName && (
            <p className="text-xs text-muted-foreground">
              {skill.repoOwner}/{skill.repoName}
            </p>
          )}
        </div>
        {skill.installed && (
          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            已安装
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
        {skill.description || "暂无描述"}
      </p>

      <div className="flex items-center gap-2">
        {canManageInstallation && (
          <button
            onClick={handleAction}
            disabled={installing}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              skill.installed
                ? "border border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {installing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {skill.installed ? "卸载中..." : "安装中..."}
              </>
            ) : (
              <>
                {skill.installed ? (
                  <>
                    <Trash2 className="h-4 w-4" />
                    卸载
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    安装
                  </>
                )}
              </>
            )}
          </button>
        )}

        {/* 执行按钮 - 仅已安装的 Skill 显示 */}
        {skill.installed && onExecute && (
          <button
            onClick={handleExecute}
            disabled={installing}
            className="flex items-center justify-center gap-2 rounded-lg border border-blue-500 px-3 py-2 text-sm font-medium text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
            title="执行此 Skill"
          >
            <Play className="h-4 w-4" />
            执行
          </button>
        )}

        {/* 查看内容按钮 - 仅内置或本地且已安装的 Skill 显示 */}
        {showViewContent && (
          <button
            onClick={handleViewContent}
            disabled={installing}
            className="flex items-center justify-center gap-2 rounded-lg border border-amber-500 px-3 py-2 text-sm font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
            title="查看 SKILL.md"
          >
            <FileText className="h-4 w-4" />
            查看内容
          </button>
        )}

        {skill.readmeUrl && (
          <button
            onClick={openGithub}
            className="rounded-lg border p-2 hover:bg-muted"
            title="在 GitHub 上查看"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
