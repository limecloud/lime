import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { WorkspaceSettings } from "@/types/workspace";
import { toast } from "sonner";
import {
  BUILTIN_TEAM_PROFILE_OPTIONS,
  BUILTIN_TEAM_SKILL_OPTIONS,
  getBuiltinTeamProfileOption,
  getBuiltinTeamSkillOption,
} from "../../../utils/teamPresets";
import {
  buildTeamDefinitionSummary,
  cloneTeamDefinitionAsCustom,
  createTeamDefinitionFromPreset,
  listBuiltinTeamDefinitions,
  normalizeTeamDefinition,
  type TeamDefinition,
  type TeamRoleDefinition,
} from "../../../utils/teamDefinitions";
import { getTeamSuggestion } from "../../../utils/teamSuggestion";
import {
  resolveCustomTeams,
  saveCustomTeams,
} from "../../../utils/teamStorage";

interface TeamSelectorPanelProps {
  activeTheme?: string;
  input?: string;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam: (team: TeamDefinition | null) => void;
  workspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
  onClose?: () => void;
}

interface TeamDraft {
  id?: string;
  label: string;
  description: string;
  theme?: string;
  presetId?: string;
  roles: TeamRoleDefinition[];
}

function createBlankDraft(theme?: string): TeamDraft {
  return {
    label: "",
    description: "",
    theme,
    presetId: undefined,
    roles: [
      {
        id: "planner",
        label: "分析",
        summary: "负责拆解任务、澄清边界与输出第一轮事实。",
      },
      {
        id: "executor",
        label: "执行",
        summary: "负责在明确范围内推进实现或产出草稿。",
      },
    ],
  };
}

function buildDraftFromTeam(team: TeamDefinition): TeamDraft {
  return {
    id: team.source === "custom" ? team.id : undefined,
    label: team.label,
    description: team.description,
    theme: team.theme,
    presetId: team.presetId,
    roles: team.roles.map((role, index) => ({
      id: role.id || `role-${index + 1}`,
      label: role.label,
      summary: role.summary,
      profileId: role.profileId,
      roleKey: role.roleKey,
      skillIds: role.skillIds ? [...role.skillIds] : [],
    })),
  };
}

function matchTeamQuery(team: TeamDefinition, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return (
    team.label.toLowerCase().includes(normalizedQuery) ||
    team.description.toLowerCase().includes(normalizedQuery) ||
    team.roles.some(
      (role) =>
        role.label.toLowerCase().includes(normalizedQuery) ||
        role.summary.toLowerCase().includes(normalizedQuery),
    )
  );
}

function parseSkillIdsInput(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function TeamCard({
  team,
  selected,
  expanded,
  selectedLabel,
  badgeLabel,
  onSelect,
  onToggleDetail,
  onCopy,
  onEdit,
  onDelete,
}: {
  team: TeamDefinition;
  selected: boolean;
  expanded?: boolean;
  selectedLabel?: string;
  badgeLabel?: string;
  onSelect: () => void;
  onToggleDetail?: () => void;
  onCopy?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-3 shadow-sm shadow-slate-950/5 transition-colors",
        selected
          ? "border-sky-300 bg-sky-50/60"
          : "border-slate-200/80 hover:border-slate-300",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onSelect}
          data-testid={`team-selector-option-${team.id}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">
              {team.label}
            </span>
            {badgeLabel ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {badgeLabel}
              </span>
            ) : null}
            {selected ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700">
                <Check className="h-3.5 w-3.5" />
                {selectedLabel || "当前选择"}
              </span>
            ) : null}
          </div>
          <div className="mt-1 break-words whitespace-normal text-xs leading-5 text-slate-600">
            {team.description}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {team.roles.map((role) => (
              <span
                key={`${team.id}-${role.id}`}
                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500"
              >
                {role.label}
              </span>
            ))}
          </div>
          {expanded ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 text-slate-600">
              <div className="font-medium text-slate-800">详细分工</div>
              <div className="mt-1 break-words whitespace-normal">
                {buildTeamDefinitionSummary(team)}
              </div>
              <div className="mt-2 space-y-1.5">
                {team.roles.map((role) => (
                  <div key={`${team.id}-detail-${role.id}`}>
                    <span className="font-medium text-slate-800">
                      {role.label}
                    </span>
                    <span> · {role.summary}</span>
                    {role.profileId || role.roleKey || role.skillIds?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {role.profileId ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                            画像 ·{" "}
                            {getBuiltinTeamProfileOption(role.profileId)
                              ?.label || role.profileId}
                          </span>
                        ) : null}
                        {role.roleKey ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                            Role · {role.roleKey}
                          </span>
                        ) : null}
                        {role.skillIds?.map((skillId) => (
                          <span
                            key={`${team.id}-${role.id}-${skillId}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500"
                          >
                            技能 ·{" "}
                            {getBuiltinTeamSkillOption(skillId)?.label ||
                              skillId}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {onToggleDetail ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={onToggleDetail}
              title={expanded ? "收起详情" : "查看详情"}
              aria-label={expanded ? "收起详情" : "查看详情"}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          ) : null}
          {onCopy ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={onCopy}
              title="复制为自定义分工"
              aria-label="复制为自定义分工"
            >
              <Copy className="h-4 w-4" />
            </button>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={onEdit}
              title="编辑分工"
              aria-label="编辑分工"
            >
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              onClick={onDelete}
              title="删除分工"
              aria-label="删除分工"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const TeamSelectorPanel: React.FC<TeamSelectorPanelProps> = ({
  activeTheme,
  input,
  selectedTeam = null,
  onSelectTeam,
  workspaceSettings,
  onPersistCustomTeams,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [customTeams, setCustomTeams] = useState<TeamDefinition[]>([]);
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const isProjectScopedCustomTeam = Boolean(
    workspaceSettings && onPersistCustomTeams,
  );

  useEffect(() => {
    setCustomTeams(resolveCustomTeams(workspaceSettings));
  }, [workspaceSettings]);

  const suggestion = useMemo(
    () =>
      getTeamSuggestion({
        input: input || "",
        activeTheme,
        subagentEnabled: false,
      }),
    [activeTheme, input],
  );

  const recommendedTeam = useMemo(
    () =>
      suggestion.shouldSuggest && suggestion.suggestedPresetId
        ? createTeamDefinitionFromPreset(suggestion.suggestedPresetId)
        : null,
    [suggestion.shouldSuggest, suggestion.suggestedPresetId],
  );

  const builtinTeams = useMemo(
    () =>
      listBuiltinTeamDefinitions().filter((team) =>
        matchTeamQuery(team, query),
      ),
    [query],
  );

  const filteredCustomTeams = useMemo(
    () => customTeams.filter((team) => matchTeamQuery(team, query)),
    [customTeams, query],
  );

  const currentSelectionSummary = buildTeamDefinitionSummary(selectedTeam);

  const updateDraftRole = (
    roleIndex: number,
    updater: (role: TeamRoleDefinition) => TeamRoleDefinition,
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            roles: current.roles.map((item, index) =>
              index === roleIndex ? updater(item) : item,
            ),
          }
        : current,
    );
  };

  const toggleDraftRoleSkill = (roleIndex: number, skillId: string) => {
    updateDraftRole(roleIndex, (role) => {
      const currentSkillIds = role.skillIds || [];
      const nextSkillIds = currentSkillIds.includes(skillId)
        ? currentSkillIds.filter((item) => item !== skillId)
        : [...currentSkillIds, skillId];

      return {
        ...role,
        skillIds: nextSkillIds,
      };
    });
  };

  const handleStartCreate = (base?: TeamDefinition | null) => {
    setDraft(
      base
        ? buildDraftFromTeam(cloneTeamDefinitionAsCustom(base))
        : createBlankDraft(activeTheme),
    );
  };

  const handleStartEdit = (team: TeamDefinition) => {
    setDraft(buildDraftFromTeam(team));
  };

  const persistCustomTeams = async (nextCustomTeams: TeamDefinition[]) => {
    if (onPersistCustomTeams) {
      await Promise.resolve(onPersistCustomTeams(nextCustomTeams));
      return;
    }

    saveCustomTeams(nextCustomTeams);
  };

  const handleSaveDraft = async () => {
    const normalized = normalizeTeamDefinition({
      id: draft?.id,
      source: "custom",
      label: draft?.label,
      description: draft?.description,
      theme: draft?.theme,
      presetId:
        draft?.presetId ||
        (draft?.id &&
          customTeams.find((team) => team.id === draft.id)?.presetId),
      roles: draft?.roles,
    });

    if (!normalized) {
      toast.error("请至少填写分工名称和 1 个角色");
      return;
    }

    const nextTeam = {
      ...normalized,
      source: "custom" as const,
      updatedAt: Date.now(),
      createdAt:
        customTeams.find((team) => team.id === normalized.id)?.createdAt ||
        Date.now(),
    };

    const nextCustomTeams = [
      ...customTeams.filter((team) => team.id !== nextTeam.id),
      nextTeam,
    ].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    try {
      await persistCustomTeams(nextCustomTeams);
      setCustomTeams(nextCustomTeams);
      setDraft(null);
      onSelectTeam(nextTeam);
      onClose?.();
      toast.success(
        isProjectScopedCustomTeam
          ? `已将分工「${nextTeam.label}」保存到当前项目`
          : `已保存分工「${nextTeam.label}」`,
      );
    } catch (error) {
      toast.error(
        `保存分工失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleDeleteCustom = async (team: TeamDefinition) => {
    const nextCustomTeams = customTeams.filter((item) => item.id !== team.id);

    try {
      await persistCustomTeams(nextCustomTeams);
      setCustomTeams(nextCustomTeams);
      setDraft((currentDraft) =>
        currentDraft?.id === team.id ? null : currentDraft,
      );
      if (selectedTeam?.id === team.id) {
        onSelectTeam(null);
      }
      toast.success(
        isProjectScopedCustomTeam
          ? `已从当前项目删除分工「${team.label}」`
          : `已删除分工「${team.label}」`,
      );
    } catch (error) {
      toast.error(
        `删除分工失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleClearSelection = () => {
    onSelectTeam(null);
    onClose?.();
  };

  const handleSelect = (team: TeamDefinition) => {
    onSelectTeam(team);
    onClose?.();
  };

  const recommendedSelected = Boolean(
    recommendedTeam && selectedTeam?.id === recommendedTeam.id,
  );

  const inspectorTeam = useMemo(() => {
    const teamById = new Map<string, TeamDefinition>();

    for (const candidate of [
      selectedTeam,
      recommendedTeam,
      ...filteredCustomTeams,
      ...builtinTeams,
    ]) {
      if (candidate && !teamById.has(candidate.id)) {
        teamById.set(candidate.id, candidate);
      }
    }

    const preferredId =
      expandedTeamId ||
      selectedTeam?.id ||
      recommendedTeam?.id ||
      filteredCustomTeams[0]?.id ||
      builtinTeams[0]?.id;

    if (!preferredId) {
      return null;
    }

    return teamById.get(preferredId) || null;
  }, [
    builtinTeams,
    expandedTeamId,
    filteredCustomTeams,
    recommendedTeam,
    selectedTeam,
  ]);

  const renderInspectorPanel = () => {
    if (!inspectorTeam) {
      return (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-5 py-6 text-sm text-slate-500">
          还没有可预览的分工。你可以从左侧模板中查看详情，或新建一个自定义
          分工。
        </div>
      );
    }

    const isCurrent = selectedTeam?.id === inspectorTeam.id;
    const isCustom = inspectorTeam.source === "custom";
    const badgeLabel =
      inspectorTeam.id === recommendedTeam?.id
        ? "按任务推荐"
        : isCustom
          ? "自定义"
          : "系统模板";

    return (
      <div
        className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5"
        data-testid="team-selector-inspector"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-slate-900">
                {inspectorTeam.label}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {badgeLabel}
              </span>
              {isCurrent ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                  <Check className="h-3.5 w-3.5" />
                  当前选择
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-600">
              {inspectorTeam.description ||
                "这套分工会作为主代理拆分子任务时的分工参考。"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isCurrent ? (
              <Button
                type="button"
                className="bg-slate-900 text-white hover:bg-slate-800"
                onClick={() => handleSelect(inspectorTeam)}
              >
                采用这套分工
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              onClick={() => handleStartCreate(inspectorTeam)}
            >
              <Copy className="mr-1.5 h-4 w-4" />
              复制为自定义
            </Button>
            {isCustom ? (
              <Button
                type="button"
                variant="outline"
                className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                onClick={() => handleStartEdit(inspectorTeam)}
              >
                <Pencil className="mr-1.5 h-4 w-4" />
                编辑
              </Button>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold tracking-[0.08em] text-slate-500">
            分工概览
          </div>
          <div className="mt-2 text-sm leading-6 text-slate-700">
            {buildTeamDefinitionSummary(inspectorTeam)}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.08em] text-slate-500">
            角色分工
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {inspectorTeam.roles.map((role) => (
              <div
                key={`${inspectorTeam.id}-inspector-${role.id}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {role.label}
                  </span>
                  {role.profileId ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      画像 ·{" "}
                      {getBuiltinTeamProfileOption(role.profileId)?.label ||
                        role.profileId}
                    </span>
                  ) : null}
                  {role.roleKey ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      Role · {role.roleKey}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  {role.summary}
                </div>
                {role.skillIds?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {role.skillIds.map((skillId) => (
                      <span
                        key={`${inspectorTeam.id}-${role.id}-${skillId}`}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500"
                      >
                        技能 ·{" "}
                        {getBuiltinTeamSkillOption(skillId)?.label || skillId}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {isCustom ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              className="border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
              onClick={() => {
                void handleDeleteCustom(inspectorTeam);
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              删除这套分工
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderDraftEditor = () => {
    if (!draft) {
      return renderInspectorPanel();
    }

    return (
      <section
        className="space-y-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/5"
        data-testid="team-selector-editor"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">
              {draft.id ? "编辑自定义分工" : "新建自定义分工"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              在右侧完整配置分工角色、画像和技能，左侧列表用于浏览与切换模板。
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={() => setDraft(null)}
            aria-label="关闭编辑器"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-xs font-medium text-slate-600">
              分工名称
            </label>
            <Input
              value={draft.label}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        label: event.target.value,
                      }
                    : current,
                )
              }
              placeholder="例如：前端联调团队"
              className="border-slate-200 bg-white"
            />
          </div>

          <div className="grid gap-2 md:col-span-2">
            <label className="text-xs font-medium text-slate-600">
              分工说明
            </label>
            <Textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        description: event.target.value,
                      }
                    : current,
                )
              }
              placeholder="说明这套分工适合什么类型任务。"
              className="min-h-[88px] border-slate-200 bg-white"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs font-medium text-slate-600">
              角色分工
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              onClick={() =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        roles: [
                          ...current.roles,
                          {
                            id: `role-${current.roles.length + 1}`,
                            label: "",
                            summary: "",
                            skillIds: [],
                          },
                        ],
                      }
                    : current,
                )
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              添加角色
            </Button>
          </div>

          <div className="space-y-3">
            {draft.roles.map((role, index) => (
              <div
                key={`${role.id}-${index}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                {(() => {
                  const selectedProfile = getBuiltinTeamProfileOption(
                    role.profileId,
                  );
                  const resolvedSkillIds = role.skillIds || [];
                  const suggestedSkillIds = selectedProfile?.skillIds || [];

                  return (
                    <>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-slate-500">
                          角色 {index + 1}
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
                          onClick={() =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    roles: current.roles.filter(
                                      (_, roleIndex) => roleIndex !== index,
                                    ),
                                  }
                                : current,
                            )
                          }
                          aria-label={`移除角色 ${index + 1}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid gap-3">
                        <Input
                          value={role.label}
                          onChange={(event) =>
                            updateDraftRole(index, (item) => ({
                              ...item,
                              label: event.target.value,
                            }))
                          }
                          placeholder="角色名称，例如：分析"
                          className="border-slate-200 bg-white"
                        />
                        <Textarea
                          value={role.summary}
                          onChange={(event) =>
                            updateDraftRole(index, (item) => ({
                              ...item,
                              summary: event.target.value,
                            }))
                          }
                          placeholder="说明这个角色负责什么。"
                          className="min-h-[84px] border-slate-200 bg-white"
                        />
                        <div className="grid gap-3 xl:grid-cols-2">
                          <div className="grid gap-2">
                            <label className="text-xs font-medium text-slate-600">
                              内置画像
                            </label>
                            <select
                              value={role.profileId || ""}
                              onChange={(event) => {
                                const nextProfileId =
                                  event.target.value.trim() || undefined;
                                const nextProfile =
                                  getBuiltinTeamProfileOption(nextProfileId);
                                updateDraftRole(index, (item) => ({
                                  ...item,
                                  profileId: nextProfileId,
                                  roleKey:
                                    item.roleKey?.trim() ||
                                    nextProfile?.roleKey ||
                                    "",
                                  skillIds:
                                    item.skillIds && item.skillIds.length > 0
                                      ? item.skillIds
                                      : nextProfile?.skillIds
                                        ? [...nextProfile.skillIds]
                                        : [],
                                }));
                              }}
                              data-testid={`team-role-profile-select-${index}`}
                              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-300"
                            >
                              <option value="">不指定内置画像</option>
                              {BUILTIN_TEAM_PROFILE_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label} · {option.id}
                                </option>
                              ))}
                            </select>
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500">
                              {selectedProfile ? (
                                <>
                                  <span className="font-medium text-slate-700">
                                    {selectedProfile.label}
                                  </span>
                                  <span> · {selectedProfile.description}</span>
                                </>
                              ) : (
                                "可选内置 subagent profile，用于对齐 Codex 风格的角色画像。"
                              )}
                            </div>
                          </div>

                          <div className="grid gap-2">
                            <label className="text-xs font-medium text-slate-600">
                              roleKey
                            </label>
                            <Input
                              value={role.roleKey || ""}
                              onChange={(event) =>
                                updateDraftRole(index, (item) => ({
                                  ...item,
                                  roleKey: event.target.value,
                                }))
                              }
                              data-testid={`team-role-role-key-input-${index}`}
                              placeholder="例如：explorer / executor / reviewer"
                              className="border-slate-200 bg-white"
                            />
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500">
                              用于运行时和工作台标记角色职责；建议与所选画像保持一致。
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-2">
                          <label className="text-xs font-medium text-slate-600">
                            skills
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {BUILTIN_TEAM_SKILL_OPTIONS.map((option) => {
                              const active = resolvedSkillIds.includes(
                                option.id,
                              );
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                                    active
                                      ? "border-sky-300 bg-sky-50 text-sky-700"
                                      : suggestedSkillIds.includes(option.id)
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
                                  )}
                                  onClick={() =>
                                    toggleDraftRoleSkill(index, option.id)
                                  }
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                          <Input
                            value={resolvedSkillIds.join(", ")}
                            onChange={(event) =>
                              updateDraftRole(index, (item) => ({
                                ...item,
                                skillIds: parseSkillIdsInput(
                                  event.target.value,
                                ),
                              }))
                            }
                            data-testid={`team-role-skill-ids-input-${index}`}
                            placeholder="多个 skill id 用逗号分隔，例如：source-grounding, structured-writing"
                            className="border-slate-200 bg-white"
                          />
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-500">
                            {selectedProfile && suggestedSkillIds.length > 0 ? (
                              <>推荐技能：{suggestedSkillIds.join("、")}</>
                            ) : (
                              "skillIds 会透传给运行时，用于约束子任务可用的技能集。"
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            onClick={() => setDraft(null)}
          >
            取消
          </Button>
          <Button
            type="button"
            className="bg-slate-900 text-white hover:bg-slate-800"
            onClick={() => {
              void handleSaveDraft();
            }}
          >
            保存分工
          </Button>
        </div>
      </section>
    );
  };

  return (
    <div
      className="flex h-[min(78vh,760px)] w-full flex-col bg-white"
      data-testid="team-selector-panel"
    >
      <div className="border-b border-slate-200/80 bg-[linear-gradient(180deg,rgb(255,255,255)_0%,rgb(248,250,252)_100%)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
              任务分工配置
            </div>
            <div className="mt-1 text-sm text-slate-700">
              只在当前任务适合拆分推进时，为当前任务提供任务分工结构参考。
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {isProjectScopedCustomTeam
                ? "自定义分工会保存到当前项目，便于项目级复用与评审。"
                : "自定义分工当前保存在本地设备，用于快速测试与个人偏好。"}
            </div>
          </div>
          {selectedTeam ? (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={handleClearSelection}
              title="清除分工选择"
              aria-label="清除分工选择"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {selectedTeam ? (
          <div
            className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5"
            data-testid="team-selector-current"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <Users className="h-3.5 w-3.5" />
              当前已选分工
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {selectedTeam.label}
            </div>
            {currentSelectionSummary ? (
              <div className="mt-1 text-xs leading-5 text-slate-600">
                {currentSelectionSummary}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-slate-200/80 bg-white p-4 lg:border-b-0 lg:border-r">
          <div className="space-y-4">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索分工、角色或职责"
              className="border-slate-200 bg-white"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="bg-slate-900 text-white hover:bg-slate-800"
                onClick={() =>
                  handleStartCreate(
                    selectedTeam || recommendedTeam || builtinTeams[0] || null,
                  )
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                新建自定义分工
              </Button>
              {selectedTeam ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  onClick={handleClearSelection}
                >
                  清除当前选择
                </Button>
              ) : null}
            </div>

            {recommendedTeam ? (
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                  <Sparkles className="h-3.5 w-3.5" />
                  推荐分工
                </div>
                <TeamCard
                  team={recommendedTeam}
                  selected={recommendedSelected}
                  expanded={expandedTeamId === recommendedTeam.id}
                  selectedLabel="已采用推荐"
                  badgeLabel="按任务推荐"
                  onSelect={() => handleSelect(recommendedTeam)}
                  onToggleDetail={() =>
                    setExpandedTeamId((currentId) =>
                      currentId === recommendedTeam.id
                        ? null
                        : recommendedTeam.id,
                    )
                  }
                  onCopy={() => handleStartCreate(recommendedTeam)}
                />
              </section>
            ) : null}

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                  {isProjectScopedCustomTeam ? "当前项目分工" : "我的分工"}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  onClick={() =>
                    handleStartCreate(
                      selectedTeam ||
                        recommendedTeam ||
                        builtinTeams[0] ||
                        null,
                    )
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  新建自定义
                </Button>
              </div>
              {filteredCustomTeams.length > 0 ? (
                <div className="space-y-2">
                  {filteredCustomTeams.map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      selected={selectedTeam?.id === team.id}
                      expanded={expandedTeamId === team.id}
                      badgeLabel="自定义"
                      onSelect={() => handleSelect(team)}
                      onToggleDetail={() =>
                        setExpandedTeamId((currentId) =>
                          currentId === team.id ? null : team.id,
                        )
                      }
                      onCopy={() => handleStartCreate(team)}
                      onEdit={() => handleStartEdit(team)}
                      onDelete={() => {
                        void handleDeleteCustom(team);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  <div>
                    {isProjectScopedCustomTeam
                      ? "当前项目还没有自定义分工。可以从推荐方案或系统模板复制一份后再改。"
                      : "还没有自定义分工。可以从推荐方案或系统模板复制一份后再改。"}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    onClick={() =>
                      handleStartCreate(
                        selectedTeam ||
                          recommendedTeam ||
                          builtinTeams[0] ||
                          null,
                      )
                    }
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    立即创建
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                系统模板
              </div>
              <div className="space-y-2">
                {builtinTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    selected={selectedTeam?.id === team.id}
                    expanded={expandedTeamId === team.id}
                    badgeLabel="系统"
                    onSelect={() => handleSelect(team)}
                    onToggleDetail={() =>
                      setExpandedTeamId((currentId) =>
                        currentId === team.id ? null : team.id,
                      )
                    }
                    onCopy={() => handleStartCreate(team)}
                  />
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto bg-slate-50 p-5">
          {renderDraftEditor()}
        </div>
      </div>
    </div>
  );
};
