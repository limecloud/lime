/**
 * @file SkillCard.tsx
 * @description Skill 卡片组件，展示单个 Skill 的信息和操作按钮
 *
 * 功能：
 * - 显示 Skill 基本信息（名称、描述、来源）
 * - 安装/卸载操作按钮（非内置）
 * - 执行按钮（仅已安装的 Skill 显示）
 * - 检查详情按钮（本地可查看内容，远程可安装前预检）
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
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { Skill } from "@/lib/api/skills";

/**
 * Skill 来源类型
 * - builtin: Lime 内置技能
 * - project: 当前项目 `.agents/skills` 中的技能
 * - official: 来自 lime/skills 官方仓库
 * - community: 来自其他 GitHub 仓库
 * - local: 本地安装，无仓库信息
 */
export type SkillSource =
  | "builtin"
  | "project"
  | "official"
  | "community"
  | "local";

/**
 * 判断 Skill 的来源类型
 *
 * @param skill - Skill 对象
 * @returns SkillSource - 来源类型
 *
 * 分类规则：
 * - "builtin": sourceKind="builtin"
 * - "project": catalogSource="project"
 * - "local": catalogSource="user"
 * - "official": catalogSource="remote" 且 repoOwner="lime" AND repoName="skills"
 * - "community": catalogSource="remote" 且仓库不是 lime/skills
 * - compat: catalogSource 缺失时回退到 repo 字段推断
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getSkillSource(skill: Skill): SkillSource {
  if (skill.sourceKind === "builtin") {
    return "builtin";
  }
  if (skill.catalogSource === "project") {
    return "project";
  }
  if (skill.catalogSource === "user") {
    return "local";
  }
  if (
    skill.catalogSource !== "remote" &&
    (!skill.repoOwner || !skill.repoName)
  ) {
    return "local";
  }
  if (skill.repoOwner === "lime" && skill.repoName === "skills") {
    return "official";
  }
  return "community";
}

/**
 * 是否可查看本地 Skill 内容
 *
 * 仅内置、项目级或用户级本地且可直接使用的 Skill 支持查看 SKILL.md。
 *
 * @param skill - Skill 对象
 * @returns 是否显示查看内容入口
 */
// eslint-disable-next-line react-refresh/only-export-components
export function canViewLocalSkillContent(skill: Skill): boolean {
  const source = getSkillSource(skill);
  return (
    skill.installed &&
    (source === "builtin" || source === "project" || source === "local")
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function canInspectSkill(skill: Skill): boolean {
  if (canViewLocalSkillContent(skill)) {
    return true;
  }

  const isRemoteCatalog =
    skill.catalogSource === "remote" ||
    (!skill.catalogSource && skill.repoOwner && skill.repoName);

  return Boolean(
    isRemoteCatalog && skill.repoOwner && skill.repoName && skill.repoBranch,
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function getInspectActionLabel(skill: Skill): string {
  return canViewLocalSkillContent(skill) ? "查看内容" : "检查详情";
}

/**
 * 是否允许用户安装或卸载 Skill
 *
 * 内置 Skill 和项目级 Skill 默认可用，不提供安装/卸载入口。
 *
 * @param skill - Skill 对象
 * @returns 是否显示安装/卸载操作
 */
// eslint-disable-next-line react-refresh/only-export-components
export function canManageSkillInstallation(skill: Skill): boolean {
  return skill.sourceKind !== "builtin" && skill.catalogSource !== "project";
}

/**
 * 来源标签配置
 */
const sourceConfig: Record<
  SkillSource,
  { label: string; className: string; surfaceClassName: string }
> = {
  builtin: {
    label: "内置",
    className: "bg-orange-100 text-orange-800",
    surfaceClassName: "from-orange-200/70 via-orange-50 to-white",
  },
  project: {
    label: "项目",
    className: "bg-stone-100 text-stone-800",
    surfaceClassName: "from-stone-200/70 via-stone-50 to-white",
  },
  official: {
    label: "官方",
    className: "bg-green-100 text-green-800",
    surfaceClassName: "from-emerald-200/70 via-emerald-50 to-white",
  },
  community: {
    label: "社区",
    className: "bg-sky-100 text-sky-800",
    surfaceClassName: "from-sky-200/70 via-sky-50 to-white",
  },
  local: {
    label: "本地",
    className: "bg-slate-100 text-slate-800",
    surfaceClassName: "from-slate-200/70 via-slate-50 to-white",
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
      className={`inline-flex items-center rounded-full border border-border/60 px-2.5 py-1 text-xs font-medium shadow-sm ${className}`}
    >
      {label}
    </span>
  );
}

function StandardBadge({ skill }: { skill: Skill }) {
  const compliance = skill.standardCompliance;
  if (!compliance) {
    return null;
  }
  const deprecatedFields = compliance.deprecatedFields ?? [];

  if (!compliance.isStandard) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" />
        待修复
      </span>
    );
  }

  if (deprecatedFields.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        含兼容字段
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />
      标准
    </span>
  );
}

function getCategoryLabel(skill: Skill): string | null {
  const category = skill.metadata?.lime_category;
  if (!category) {
    return null;
  }

  const labels: Record<string, string> = {
    media: "媒体",
    research: "调研",
    writing: "写作",
    social: "内容",
  };
  return labels[category] ?? category;
}

function ResourceBadges({ skill }: { skill: Skill }) {
  const summary = skill.resourceSummary;
  if (!summary) {
    return null;
  }

  const resources = [
    summary.hasScripts ? "scripts" : null,
    summary.hasReferences ? "references" : null,
    summary.hasAssets ? "assets" : null,
  ].filter(Boolean);

  if (resources.length === 0) {
    return null;
  }

  return (
    <>
      {resources.map((resource) => (
        <span
          key={resource}
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
        >
          {resource}
        </span>
      ))}
    </>
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
 * - 检查详情按钮（本地查看内容，远程执行安装前预检）
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
    if (onViewContent && canInspectSkill(skill)) {
      onViewContent(skill);
    }
  };

  const source = getSkillSource(skill);
  const showViewContent = Boolean(onViewContent && canInspectSkill(skill));
  const inspectActionLabel = getInspectActionLabel(skill);
  const categoryLabel = getCategoryLabel(skill);
  const validationErrors = skill.standardCompliance?.validationErrors ?? [];
  const deprecatedFields = skill.standardCompliance?.deprecatedFields ?? [];
  const hasResourceBadges = Boolean(
    skill.resourceSummary?.hasScripts ||
    skill.resourceSummary?.hasReferences ||
    skill.resourceSummary?.hasAssets,
  );
  const validationSummary =
    validationErrors[0] ??
    (deprecatedFields.length
      ? `兼容字段：${deprecatedFields.join(", ")}`
      : null);
  const sourceStyle = sourceConfig[source];
  const actionButtonBaseClassName =
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5 transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
      <div
        className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${sourceStyle.surfaceClassName} opacity-80`}
      />
      <div className="relative flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge source={source} />
              <StandardBadge skill={skill} />
              {categoryLabel && (
                <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                  {categoryLabel}
                </span>
              )}
            </div>

            <h3 className="mt-3 text-base font-semibold leading-6 text-slate-900">
              {skill.name}
            </h3>

            {skill.repoOwner && skill.repoName && (
              <p className="mt-1 text-xs text-slate-500">
                {skill.repoOwner}/{skill.repoName}
              </p>
            )}
          </div>

          {skill.installed && (
            <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm">
              {source === "project" ? "项目可用" : "已安装"}
            </span>
          )}
        </div>

        <p className="mt-4 min-h-[72px] text-sm leading-6 text-slate-600 line-clamp-3">
          {skill.description || "暂无描述"}
        </p>

        {hasResourceBadges && (
          <div className="mt-4 flex flex-wrap gap-2">
            <ResourceBadges skill={skill} />
          </div>
        )}

        {validationSummary && (
          <div className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/90 px-3 py-2.5 text-xs leading-5 text-amber-700">
            {validationSummary}
          </div>
        )}

        <div className="mt-auto pt-4">
          <div className="flex flex-wrap gap-2 border-t border-slate-200/70 pt-4">
            {canManageInstallation && (
              <button
                onClick={handleAction}
                disabled={installing}
                className={`min-w-[120px] flex-1 ${actionButtonBaseClassName} ${
                  skill.installed
                    ? "border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100"
                    : "border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] text-white shadow-sm shadow-emerald-950/15 hover:opacity-95"
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
                className={`${actionButtonBaseClassName} min-w-[100px] flex-1 border border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/30`}
                title="执行此 Skill"
              >
                <Play className="h-4 w-4" />
                执行
              </button>
            )}

            {/* 检查详情按钮 - 本地可查看内容，远程可安装前预检 */}
            {showViewContent && (
              <button
                onClick={handleViewContent}
                disabled={installing}
                className={`${actionButtonBaseClassName} min-w-[100px] flex-1 border border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/30`}
                title={inspectActionLabel}
              >
                <FileText className="h-4 w-4" />
                {inspectActionLabel}
              </button>
            )}

            {skill.readmeUrl && (
              <button
                onClick={openGithub}
                className={`${actionButtonBaseClassName} w-11 shrink-0 border border-slate-200 bg-white px-0 text-slate-600 hover:border-slate-300 hover:bg-slate-50`}
                title="在 GitHub 上查看"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
