import { useMemo } from "react";
import {
  ChevronRight,
  FileText,
  Image,
  PanelRightClose,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Skill } from "@/lib/api/skills";

type SkillGroupKey = "text" | "visual" | "audio" | "video" | "resource";
type ThemeWorkbenchRunState = "idle" | "auto_running" | "await_user_decision";

interface SkillGroup {
  key: SkillGroupKey;
  title: string;
  items: Skill[];
}

interface CurrentGate {
  key: string;
  title: string;
  status: "running" | "waiting" | "idle" | "done";
  description: string;
}

interface ThemeWorkbenchWorkspaceSummary {
  activeContextCount: number;
  searchResultCount: number;
  versionCount: number;
  runState: ThemeWorkbenchRunState;
}

const PANEL_CLASSNAME =
  "flex h-full w-[320px] min-w-[320px] flex-col overflow-hidden border-l border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.94)_0%,rgba(241,245,249,0.82)_100%)]";

const HEADER_CLASSNAME =
  "border-b border-slate-200/80 bg-white/88 px-4 py-3 backdrop-blur-sm";

const SECTION_CLASSNAME = "border-b border-slate-200/80 px-4 py-3";

const SCROLL_SECTION_CLASSNAME =
  "flex-1 min-h-0 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]";

const SECTION_TITLE_CLASSNAME =
  "mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";

const CARD_CLASSNAME =
  "rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.92)_100%)] p-3 shadow-sm shadow-slate-950/5";

const METRIC_CARD_CLASSNAME =
  "rounded-[16px] border border-slate-200/80 bg-white/94 p-3";

const ACTION_CARD_CLASSNAME =
  "rounded-[18px] border p-3 shadow-sm shadow-slate-950/5 transition-colors";

const ACTION_BUTTON_CLASSNAME =
  "mt-3 inline-flex h-9 w-full items-center justify-center rounded-full border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

function getGateStatusClassName(status: CurrentGate["status"]) {
  return cn(
    "ml-auto inline-flex min-h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold",
    status === "waiting" &&
      "border-amber-200 bg-amber-50/90 text-amber-700",
    status === "running" && "border-sky-200 bg-sky-50/90 text-sky-700",
    status === "idle" && "border-slate-200 bg-slate-100/90 text-slate-600",
    status === "done" &&
      "border-emerald-200 bg-emerald-50/90 text-emerald-700",
  );
}

function getActionCardClassName(featured = false) {
  return cn(
    ACTION_CARD_CLASSNAME,
    featured
      ? "border-emerald-200/90 bg-[linear-gradient(180deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_100%)]"
      : "border-slate-200/80 bg-white/92 hover:border-slate-300 hover:bg-white",
  );
}

function getActionIconClassName(featured = false) {
  return cn(
    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border",
    featured
      ? "border-emerald-200 bg-emerald-100/90 text-emerald-700"
      : "border-slate-200 bg-slate-100/90 text-slate-600",
  );
}

function getActionButtonClassName(featured = false) {
  return cn(
    ACTION_BUTTON_CLASSNAME,
    featured
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100/80"
      : "border-slate-200/80 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
  );
}

function resolveSkillGroup(skill: Skill): SkillGroupKey {
  const feature = `${skill.key} ${skill.name} ${skill.description}`.toLowerCase();
  if (
    feature.includes("cover") ||
    feature.includes("image") ||
    feature.includes("illustration")
  ) {
    return "visual";
  }
  if (
    feature.includes("broadcast") ||
    feature.includes("audio") ||
    feature.includes("podcast")
  ) {
    return "audio";
  }
  if (feature.includes("video")) {
    return "video";
  }
  if (
    feature.includes("resource") ||
    feature.includes("research") ||
    feature.includes("library") ||
    feature.includes("url") ||
    feature.includes("search")
  ) {
    return "resource";
  }
  return "text";
}

function getGroupTitle(groupKey: SkillGroupKey): string {
  if (groupKey === "text") return "文字能力";
  if (groupKey === "visual") return "视觉能力";
  if (groupKey === "audio") return "音频能力";
  if (groupKey === "video") return "视频能力";
  return "检索与资源";
}

function resolveGateStatusText(status: CurrentGate["status"]): string {
  if (status === "waiting") return "等待决策";
  if (status === "running") return "自动执行";
  if (status === "idle") return "待启动";
  return "已完成";
}

function resolveRunStateText(runState: ThemeWorkbenchRunState): string {
  if (runState === "auto_running") return "执行中";
  if (runState === "await_user_decision") return "待决策";
  return "空闲";
}

function resolveSkillIcon(skill: Skill): LucideIcon {
  const group = resolveSkillGroup(skill);
  if (group === "resource") {
    return Search;
  }
  if (group === "visual") {
    return Image;
  }
  if (group === "text") {
    return FileText;
  }
  return Sparkles;
}

function resolveSkillActionLabel(skill: Skill): string {
  const group = resolveSkillGroup(skill);
  if (group === "resource") {
    return "开始检索";
  }
  if (group === "visual") {
    return "生成素材";
  }
  return "立即执行";
}

function buildSkillFeatureProbe(skill: Skill): string {
  return `${skill.key} ${skill.name} ${skill.description || ""}`.toLowerCase();
}

function pickRecommendedSkills(skills: Skill[], gateKey: string): Skill[] {
  const tagsByGate: Record<string, string[]> = {
    topic_select: ["research", "social_post_with_cover"],
    write_mode: ["social_post_with_cover", "typesetting", "cover"],
    publish_confirm: ["typesetting", "cover", "social_post_with_cover"],
  };

  const preferredTags = tagsByGate[gateKey] || [
    "social_post_with_cover",
    "research",
  ];
  const selected: Skill[] = [];

  preferredTags.forEach((tag) => {
    const found = skills.find((skill) => {
      if (selected.some((item) => item.key === skill.key)) {
        return false;
      }
      return buildSkillFeatureProbe(skill).includes(tag);
    });
    if (found) {
      selected.push(found);
    }
  });

  if (selected.length < 2) {
    skills.forEach((skill) => {
      if (selected.length >= 2) {
        return;
      }
      if (!selected.some((item) => item.key === skill.key)) {
        selected.push(skill);
      }
    });
  }

  return selected.slice(0, 2);
}

interface ThemeWorkbenchSkillsPanelProps {
  skills: Skill[];
  currentGate: CurrentGate;
  disabled?: boolean;
  workspaceSummary?: ThemeWorkbenchWorkspaceSummary;
  onTriggerSkill?: (skill: Skill) => void;
  onRequestCollapse?: () => void;
}

export function ThemeWorkbenchSkillsPanel({
  skills,
  currentGate,
  disabled = false,
  workspaceSummary,
  onTriggerSkill,
  onRequestCollapse,
}: ThemeWorkbenchSkillsPanelProps) {
  const fallbackSkills: Skill[] = useMemo(
    () => [
      {
        key: "social_post_with_cover",
        name: "social_post_with_cover",
        description: "社媒主稿与封面图生成",
        directory: "social_post_with_cover",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "cover_generate",
        name: "cover_generate",
        description: "封面图生成",
        directory: "cover_generate",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "research",
        name: "research",
        description: "信息检索与趋势分析",
        directory: "research",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "typesetting",
        name: "typesetting",
        description: "主稿排版与润色",
        directory: "typesetting",
        installed: true,
        sourceKind: "builtin",
      },
    ],
    [],
  );

  const availableSkills = useMemo(() => {
    const installed = skills.filter((skill) => skill.installed);
    return installed.length > 0 ? installed : fallbackSkills;
  }, [fallbackSkills, skills]);

  const recommendedSkills = useMemo(
    () => pickRecommendedSkills(availableSkills, currentGate.key),
    [availableSkills, currentGate.key],
  );

  const groupedSkills = useMemo<SkillGroup[]>(() => {
    const recommendedSkillKeys = new Set(
      recommendedSkills.map((skill) => skill.key),
    );
    const buckets: Record<SkillGroupKey, Skill[]> = {
      text: [],
      visual: [],
      audio: [],
      video: [],
      resource: [],
    };

    availableSkills.forEach((skill) => {
      if (recommendedSkillKeys.has(skill.key)) {
        return;
      }
      buckets[resolveSkillGroup(skill)].push(skill);
    });

    return (Object.keys(buckets) as SkillGroupKey[])
      .map((key) => ({
        key,
        title: getGroupTitle(key),
        items: buckets[key],
      }))
      .filter((group) => group.items.length > 0);
  }, [availableSkills, recommendedSkills]);

  return (
    <aside className={PANEL_CLASSNAME}>
      <div className={HEADER_CLASSNAME}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              Theme Workbench
            </div>
            <div className="mt-1 text-base font-semibold text-slate-900">
              操作面板
            </div>
          </div>
          {onRequestCollapse ? (
            <button
              type="button"
              aria-label="折叠操作面板"
              onClick={onRequestCollapse}
              className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-500 shadow-sm shadow-slate-950/5 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            >
              <PanelRightClose size={16} />
            </button>
          ) : null}
        </div>
        <div className="mt-2 text-[12px] leading-5 text-slate-500">
          右侧聚焦当前阶段推荐动作，中间主稿区保持结果优先，减少来回跳转。
        </div>
      </div>

      <section className={SECTION_CLASSNAME}>
        <div className={SECTION_TITLE_CLASSNAME}>阶段摘要</div>
        <div className={CARD_CLASSNAME}>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-slate-100/90 text-slate-600">
              <ChevronRight size={14} />
            </div>
            <div className="min-w-0 text-sm font-semibold text-slate-900">
              {currentGate.title}
            </div>
            <span className={getGateStatusClassName(currentGate.status)}>
              {resolveGateStatusText(currentGate.status)}
            </span>
          </div>
          <div className="mt-2 text-[12px] leading-5 text-slate-500">
            {currentGate.description}
          </div>
          {workspaceSummary ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className={METRIC_CARD_CLASSNAME}>
                <div className="text-base font-semibold leading-none text-slate-900">
                  {workspaceSummary.activeContextCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  启用上下文
                </div>
              </div>
              <div className={METRIC_CARD_CLASSNAME}>
                <div className="text-base font-semibold leading-none text-slate-900">
                  {workspaceSummary.searchResultCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  搜索结果
                </div>
              </div>
              <div className={METRIC_CARD_CLASSNAME}>
                <div className="text-base font-semibold leading-none text-slate-900">
                  {workspaceSummary.versionCount}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  版本快照
                </div>
              </div>
              <div className={METRIC_CARD_CLASSNAME}>
                <div className="text-base font-semibold leading-none text-slate-900">
                  {resolveRunStateText(workspaceSummary.runState)}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  运行状态
                </div>
              </div>
            </div>
          ) : null}
          <div className="mt-3 text-[11px] leading-5 text-slate-500">
            {disabled
              ? "当前有任务执行中，建议等当前处理完成后再触发新的技能。"
              : "先看推荐动作，再按需要选择更多能力，避免重复操作。"}
          </div>
        </div>
      </section>

      <section className={SCROLL_SECTION_CLASSNAME}>
        <div className={SECTION_TITLE_CLASSNAME}>推荐动作</div>
        <div className="flex flex-col gap-3">
          {recommendedSkills.map((skill) => {
            const Icon = resolveSkillIcon(skill);
            return (
              <div key={skill.key} className={getActionCardClassName(true)}>
                <div className="flex items-start gap-3">
                  <div className={getActionIconClassName(true)}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-5 text-slate-900">
                      {skill.name}
                    </div>
                    <div className="mt-1 text-[12px] leading-5 text-slate-500">
                      {skill.description || "使用当前能力继续推进当前工作台任务。"}
                    </div>
                    <span className="mt-2 inline-flex min-h-6 items-center rounded-full border border-emerald-200 bg-emerald-50/90 px-2.5 text-[10px] font-semibold text-emerald-700">
                      推荐优先执行
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`执行技能 ${skill.key}`}
                  disabled={disabled}
                  onClick={() => onTriggerSkill?.(skill)}
                  className={getActionButtonClassName(true)}
                >
                  {resolveSkillActionLabel(skill)}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 text-[12px] font-semibold text-slate-900">
          可执行能力
        </div>
        {groupedSkills.length === 0 ? (
          <div className="mt-2 text-[11px] leading-5 text-slate-500">
            当前可用技能已全部展示在推荐动作中，可直接开始执行。
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {groupedSkills.map((group) => (
              <div key={group.key}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">
                  {group.title}
                </div>
                <div className="flex flex-col gap-3">
                  {group.items.map((skill) => {
                    const Icon = resolveSkillIcon(skill);
                    return (
                      <div key={skill.key} className={getActionCardClassName()}>
                        <div className="flex items-start gap-3">
                          <div className={getActionIconClassName()}>
                            <Icon size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold leading-5 text-slate-900">
                              {skill.name}
                            </div>
                            <div className="mt-1 text-[12px] leading-5 text-slate-500">
                              {skill.description ||
                                "使用当前能力继续处理工作台内容。"}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`执行技能 ${skill.key}`}
                          disabled={disabled}
                          onClick={() => onTriggerSkill?.(skill)}
                          className={getActionButtonClassName()}
                        >
                          {resolveSkillActionLabel(skill)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
