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

const sourceConfig: Record<SkillSource, { label: string; className: string }> =
  {
    builtin: {
      label: "内置",
      className: "bg-orange-100 text-orange-800",
    },
    project: {
      label: "项目",
      className: "bg-stone-100 text-stone-800",
    },
    official: {
      label: "官方",
      className: "bg-green-100 text-green-800",
    },
    community: {
      label: "社区",
      className: "bg-sky-100 text-sky-800",
    },
    local: {
      label: "本地",
      className: "bg-slate-100 text-slate-800",
    },
  };

function SourceBadge({ source }: { source: SkillSource }) {
  const { label, className } = sourceConfig[source];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
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

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-slate-900 line-clamp-1">
              {skill.name}
            </h3>
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">
              {skill.description || "暂无描述"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SourceBadge source={source} />
              <StandardBadge skill={skill} />
            </div>
          </div>

          {skill.installed && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              已安装
            </span>
          )}
        </div>

        <div className="mt-auto pt-3">
          <div className="flex gap-2">
            {canManageInstallation && (
              <button
                onClick={handleAction}
                disabled={installing}
                className={`flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${
                  skill.installed
                    ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {installing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {skill.installed ? "卸载中" : "安装中"}
                  </>
                ) : (
                  <>
                    {skill.installed ? (
                      <>
                        <Trash2 className="h-3 w-3" />
                        卸载
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        安装
                      </>
                    )}
                  </>
                )}
              </button>
            )}

            {skill.installed && onExecute && (
              <button
                onClick={handleExecute}
                disabled={installing}
                className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Play className="h-3 w-3" />
                执行
              </button>
            )}

            {showViewContent && (
              <button
                onClick={handleViewContent}
                disabled={installing}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                title={inspectActionLabel}
              >
                <FileText className="h-3 w-3" />
                {inspectActionLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
