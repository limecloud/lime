import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import { buildServiceSkillRecommendationBuckets } from "@/components/agent/chat/service-skills/recommendedServiceSkills";
import { buildServiceSkillCapabilityDescription } from "@/components/agent/chat/service-skills/skillPresentation";
import {
  buildServiceSkillLaunchPrefillSummary,
  resolveServiceSkillLaunchPrefill,
} from "@/components/agent/chat/service-skills/serviceSkillLaunchPrefill";
import type {
  ServiceSkillGroup,
  ServiceSkillHomeItem,
  ServiceSkillSlotValues,
} from "@/components/agent/chat/service-skills/types";
import { resolveMentionCommandPrefillReplayText } from "@/components/agent/chat/utils/mentionCommandReplayText";
import type { CodexSlashCommandDefinition } from "../commands";
import type {
  BuiltinInputCommand,
  RuntimeSceneSlashCommand,
} from "./builtinCommands";
import {
  getMentionEntryUsageMap,
  getMentionEntryUsageRecordKey,
} from "./mentionEntryUsage";
import {
  getSlashEntryUsageMap,
  getSlashEntryUsageRecordKey,
  type SlashEntryUsageKind,
} from "./slashEntryUsage";
import {
  buildCuratedTaskRecentUsageDescription,
  buildCuratedTaskCapabilityDescription,
  filterCuratedTaskTemplates,
  listFeaturedHomeCuratedTaskTemplates,
  listCuratedTaskTemplates,
  resolveCuratedTaskTemplateLaunchPrefill,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "../utils/curatedTaskTemplates";
import { listCuratedTaskRecommendationSignals } from "../utils/curatedTaskRecommendationSignals";
import { buildInstalledSkillCapabilityDescription } from "@/components/skills/installedSkillPresentation";
import {
  extractCuratedTaskReferenceMemoryIds,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceEntry,
} from "../utils/curatedTaskReferenceSelection";
import {
  buildSceneAppExecutionReviewPrefillSnapshot,
} from "../utils/sceneAppCuratedTaskReference";
import { buildReviewFeedbackProjection } from "../utils/reviewFeedbackProjection";

const FEATURED_SERVICE_SKILL_LIMIT = 4;
const RECENT_REPLAY_TEXT_PREVIEW_LIMIT = 48;

type InputCapabilityIcon = "command" | "image-plus" | "sparkles" | "user" | "zap";

type InputCapabilityBase = {
  key: string;
  title: string;
  description: string;
  icon: InputCapabilityIcon;
  iconClassName: string;
  kindLabel?: string;
};

export type InputCapabilityDescriptor =
  | (InputCapabilityBase & {
      kind: "builtin_command";
      command: BuiltinInputCommand;
      replayText?: string;
    })
  | (InputCapabilityBase & {
      kind: "service_skill";
      skill: ServiceSkillHomeItem;
    })
  | (InputCapabilityBase & {
      kind: "slash_command";
      command: CodexSlashCommandDefinition;
      replayText?: string;
    })
  | (InputCapabilityBase & {
      kind: "scene_command";
      command: RuntimeSceneSlashCommand;
      replayText?: string;
    })
  | (InputCapabilityBase & {
      kind: "curated_task";
      task: CuratedTaskTemplateItem;
      launchInputValues?: CuratedTaskInputValues;
      referenceMemoryIds?: string[];
      referenceEntries?: CuratedTaskReferenceEntry[];
      launcherPrefillHint?: string;
    })
  | (InputCapabilityBase & {
      kind: "character";
      character: Character;
    })
  | (InputCapabilityBase & {
      kind: "installed_skill";
      skill: Skill;
      replayText?: string;
    })
  | (InputCapabilityBase & {
      kind: "available_skill";
      skill: Skill;
    });

export interface InputCapabilitySection {
  key: string;
  heading: string;
  items: InputCapabilityDescriptor[];
  banner?: {
    badge?: string;
    title: string;
    summary: string;
    footnote?: string;
    actionLabel?: string;
    actionItemKey?: string;
  };
}

interface MentionServiceSkillGroup {
  key: string;
  title: string;
  sort: number;
  skills: ServiceSkillHomeItem[];
}

interface RecentSlashEntry {
  key: string;
  kind: SlashEntryUsageKind | "curated_task";
  kindLabel: string;
  title: string;
  description: string;
  usedAt: number;
  commandPrefix?: string;
  replayText?: string;
  taskId?: string;
}

interface RecentMentionEntry {
  key: string;
  kind: "builtin_command" | "service_skill";
  kindLabel: string;
  title: string;
  description: string;
  usedAt: number;
  replayText?: string;
  commandKey?: string;
  commandPrefix?: string;
  skillId?: string;
}

type InputCommandCapabilityGroupKey =
  | "search_read"
  | "generate_expression"
  | "media_transform"
  | "preview_publish"
  | "browser_execution"
  | "other";

type SlashCommandSectionGroupKey =
  | "workspace_action"
  | "prompt_action"
  | "status_help";

interface InputCommandSectionMeta {
  key: string;
  heading: string;
  kindLabel: string;
  icon: InputCapabilityIcon;
  iconClassName: string;
  order: number;
}

const INPUT_COMMAND_SECTION_META: Record<
  InputCommandCapabilityGroupKey,
  InputCommandSectionMeta
> = {
  search_read: {
    key: "search-read",
    heading: "搜索 / 读取",
    kindLabel: "搜索 / 读取",
    icon: "command",
    iconClassName: "mr-2 h-4 w-4 text-sky-600",
    order: 10,
  },
  generate_expression: {
    key: "generate-expression",
    heading: "生成 / 表达",
    kindLabel: "生成 / 表达",
    icon: "image-plus",
    iconClassName: "mr-2 h-4 w-4 text-amber-600",
    order: 20,
  },
  media_transform: {
    key: "media-transform",
    heading: "媒体转换",
    kindLabel: "媒体转换",
    icon: "sparkles",
    iconClassName: "mr-2 h-4 w-4 text-cyan-600",
    order: 30,
  },
  preview_publish: {
    key: "preview-publish",
    heading: "预览 / 发布",
    kindLabel: "预览 / 发布",
    icon: "zap",
    iconClassName: "mr-2 h-4 w-4 text-rose-600",
    order: 40,
  },
  browser_execution: {
    key: "browser-execution",
    heading: "浏览器 / 执行",
    kindLabel: "浏览器 / 执行",
    icon: "command",
    iconClassName: "mr-2 h-4 w-4 text-slate-600",
    order: 50,
  },
  other: {
    key: "other-capabilities",
    heading: "其他能力",
    kindLabel: "其他能力",
    icon: "command",
    iconClassName: "mr-2 h-4 w-4 text-primary",
    order: 90,
  },
};

const INPUT_COMMAND_GROUP_BY_KEY: Record<
  string,
  InputCommandCapabilityGroupKey
> = {
  modal_resource_search: "search_read",
  research: "search_read",
  deep_search: "search_read",
  research_report: "search_read",
  competitor_research: "search_read",
  site_search: "search_read",
  read_pdf: "search_read",
  summary: "search_read",
  translation: "search_read",
  analysis: "search_read",
  web_scrape: "search_read",
  webpage_read: "search_read",
  url_parse: "search_read",
  image_generate: "generate_expression",
  image_storyboard: "generate_expression",
  cover_generate: "generate_expression",
  poster_generate: "generate_expression",
  video_generate: "generate_expression",
  presentation_generate: "generate_expression",
  form_generate: "generate_expression",
  webpage_generate: "generate_expression",
  broadcast_generate: "generate_expression",
  image_edit: "media_transform",
  image_variation: "media_transform",
  voice_runtime: "media_transform",
  transcription_generate: "media_transform",
  typesetting: "media_transform",
  channel_preview_runtime: "preview_publish",
  upload_runtime: "preview_publish",
  publish_runtime: "preview_publish",
  publish_compliance: "preview_publish",
  browser_runtime: "browser_execution",
  code_runtime: "browser_execution",
};

const SLASH_COMMAND_SECTION_META: Record<
  SlashCommandSectionGroupKey,
  InputCommandSectionMeta
> = {
  workspace_action: {
    key: "workspace-action",
    heading: "工作台操作",
    kindLabel: "工作台操作",
    icon: "command",
    iconClassName: "mr-2 h-4 w-4 text-emerald-600",
    order: 10,
  },
  prompt_action: {
    key: "prompt-action",
    heading: "提示命令",
    kindLabel: "提示命令",
    icon: "sparkles",
    iconClassName: "mr-2 h-4 w-4 text-amber-600",
    order: 20,
  },
  status_help: {
    key: "status-help",
    heading: "状态 / 帮助",
    kindLabel: "状态 / 帮助",
    icon: "zap",
    iconClassName: "mr-2 h-4 w-4 text-slate-600",
    order: 30,
  },
};

interface BuildInputCapabilitySectionsParams {
  mode: "mention" | "slash";
  mentionQuery: string;
  builtinCommands: BuiltinInputCommand[];
  slashCommands: CodexSlashCommandDefinition[];
  sceneCommands: RuntimeSceneSlashCommand[];
  mentionServiceSkills: ServiceSkillHomeItem[];
  serviceSkillGroups?: ServiceSkillGroup[];
  filteredCharacters: Character[];
  installedSkills: Skill[];
  availableSkills: Skill[];
  projectId?: string | null;
  sessionId?: string | null;
  referenceEntries?: CuratedTaskReferenceEntry[];
}

function compareRecentSlashEntries(
  left: RecentSlashEntry,
  right: RecentSlashEntry,
): number {
  if (left.usedAt !== right.usedAt) {
    return right.usedAt - left.usedAt;
  }
  return (left.commandPrefix ?? left.title).localeCompare(
    right.commandPrefix ?? right.title,
    "zh-CN",
  );
}

function compareRecentMentionEntries(
  left: RecentMentionEntry,
  right: RecentMentionEntry,
): number {
  if (left.usedAt !== right.usedAt) {
    return right.usedAt - left.usedAt;
  }
  return left.title.localeCompare(right.title, "zh-CN");
}

function resolveDisplayTitleFromCommandLike(item: {
  label?: string;
  commandPrefix: string;
}): string {
  const label = item.label?.trim();
  return label && label !== item.commandPrefix ? label : item.commandPrefix;
}

function mergeCapabilityKindLabel(
  primary: string | undefined,
  secondary: string | undefined,
): string | undefined {
  const parts = [primary?.trim(), secondary?.trim()].filter(
    (value): value is string => Boolean(value),
  );

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" · ");
}

function compareSlashCommandsForEmptyQuery(
  left: CodexSlashCommandDefinition,
  right: CodexSlashCommandDefinition,
): number {
  const emptyQueryOrder: Record<string, number> = {
    new: 10,
    clear: 20,
    compact: 30,
  };

  return (
    (emptyQueryOrder[left.key] ?? 999) - (emptyQueryOrder[right.key] ?? 999)
  );
}

function resolveBuiltinCommandPrefillReplayText(params: {
  command: BuiltinInputCommand;
  replayText?: string;
  slotValues?: ServiceSkillSlotValues;
}): string | undefined {
  return resolveMentionCommandPrefillReplayText({
    commandKey: params.command.key,
    replayText: params.replayText,
    slotValues: params.slotValues,
  });
}

function resolveRecentBuiltinCommandDescription(
  command: BuiltinInputCommand,
  replayText?: string,
): string {
  const normalizedReplayText = replayText?.replace(/\s+/g, " ").trim();
  if (normalizedReplayText) {
    const preview =
      normalizedReplayText.length <= RECENT_REPLAY_TEXT_PREVIEW_LIMIT
        ? normalizedReplayText
        : `${normalizedReplayText
            .slice(0, RECENT_REPLAY_TEXT_PREVIEW_LIMIT)
            .trimEnd()}...`;
    return `上次输入：${preview}`;
  }

  if (command.description?.trim()) {
    return `${command.label} · ${command.description}`;
  }
  return command.label;
}

function resolveRecentSlashSkillDescription(skill: Skill): string {
  return `${skill.name} · ${buildInstalledSkillCapabilityDescription(skill)}`;
}

function resolveRecentSlashEntryDescription(params: {
  replayText?: string;
  fallbackDescription?: string;
  fallbackTitle: string;
}): string {
  const normalizedReplayText = params.replayText?.replace(/\s+/g, " ").trim();
  if (normalizedReplayText) {
    const preview =
      normalizedReplayText.length <= RECENT_REPLAY_TEXT_PREVIEW_LIMIT
        ? normalizedReplayText
        : `${normalizedReplayText
            .slice(0, RECENT_REPLAY_TEXT_PREVIEW_LIMIT)
            .trimEnd()}...`;
    return `上次输入：${preview}`;
  }

  const fallbackDescription = params.fallbackDescription?.trim();
  if (fallbackDescription) {
    return fallbackDescription;
  }

  return params.fallbackTitle;
}

function resolveInputCommandSectionMeta(
  command: Pick<BuiltinInputCommand, "key">,
): InputCommandSectionMeta {
  return (
    INPUT_COMMAND_SECTION_META[INPUT_COMMAND_GROUP_BY_KEY[command.key] ?? "other"]
  );
}

function resolveSlashCommandSectionMeta(
  command: Pick<CodexSlashCommandDefinition, "kind">,
): InputCommandSectionMeta {
  switch (command.kind) {
    case "local_action":
      return SLASH_COMMAND_SECTION_META.workspace_action;
    case "prompt_action":
      return SLASH_COMMAND_SECTION_META.prompt_action;
    case "info":
    default:
      return SLASH_COMMAND_SECTION_META.status_help;
  }
}

function groupItemsBySectionMeta<T>(
  items: T[],
  resolveMeta: (item: T) => InputCommandSectionMeta,
): Array<{ meta: InputCommandSectionMeta; items: T[] }> {
  const groups = new Map<string, { meta: InputCommandSectionMeta; items: T[] }>();

  for (const item of items) {
    const meta = resolveMeta(item);
    const current = groups.get(meta.key);
    if (current) {
      current.items.push(item);
      continue;
    }

    groups.set(meta.key, {
      meta,
      items: [item],
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.meta.order !== right.meta.order) {
      return left.meta.order - right.meta.order;
    }
    return left.meta.heading.localeCompare(right.meta.heading, "zh-CN");
  });
}

function truncateSectionBannerText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function resolveCuratedTaskLaunchContext(params: {
  task: CuratedTaskTemplateItem;
  referenceEntries?: CuratedTaskReferenceEntry[];
}) {
  const launchPrefill = resolveCuratedTaskTemplateLaunchPrefill(params.task);
  const mergedReferenceEntries = mergeCuratedTaskReferenceEntries([
    ...(params.referenceEntries ?? []),
    ...(launchPrefill?.referenceEntries ?? []),
  ]);
  const mergedReferenceMemoryIds =
    normalizeCuratedTaskReferenceMemoryIds([
      ...(params.referenceEntries
        ? extractCuratedTaskReferenceMemoryIds(params.referenceEntries) ?? []
        : []),
      ...(launchPrefill?.referenceMemoryIds ?? []),
      ...(extractCuratedTaskReferenceMemoryIds(mergedReferenceEntries) ?? []),
    ]) ?? [];

  return {
    launchPrefill,
    mergedReferenceEntries,
    mergedReferenceMemoryIds,
  };
}

function buildCuratedTaskSceneAppBaselineSummary(params: {
  task: CuratedTaskTemplateItem;
  referenceEntries?: CuratedTaskReferenceEntry[];
}): string | null {
  const snapshot = buildSceneAppExecutionReviewPrefillSnapshot({
    referenceEntries: params.referenceEntries,
    taskId: params.task.id,
  });
  if (!snapshot) {
    return null;
  }

  const highlights = [
    snapshot.statusLabel ? `当前判断：${snapshot.statusLabel}` : null,
    snapshot.destinationsLabel
      ? `更适合去向：${snapshot.destinationsLabel}`
      : snapshot.operatingAction
        ? `经营动作：${snapshot.operatingAction}`
        : null,
  ].filter((item): item is string => Boolean(item));

  return [`当前结果基线：${snapshot.sourceTitle}`, ...highlights]
    .filter((item) => item.trim().length > 0)
    .join(" · ");
}

function buildCuratedTaskSlashDescription(params: {
  task: CuratedTaskTemplateItem;
  reasonSummary?: string;
  referenceEntries?: CuratedTaskReferenceEntry[];
  fallbackDescription?: string;
}): string {
  const sceneAppBaselineSummary = buildCuratedTaskSceneAppBaselineSummary({
    task: params.task,
    referenceEntries: params.referenceEntries,
  });

  return [
    sceneAppBaselineSummary,
    params.reasonSummary,
    params.fallbackDescription,
  ]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join(" · ");
}

const SERVICE_SKILL_GROUP_META: Record<
  string,
  { title: string; sort: number }
> = {
  github: { title: "GitHub", sort: 10 },
  zhihu: { title: "知乎", sort: 20 },
  "linux-do": { title: "Linux.do", sort: 30 },
  bilibili: { title: "Bilibili", sort: 40 },
  "36kr": { title: "36Kr", sort: 50 },
  smzdm: { title: "什么值得买", sort: 60 },
  "yahoo-finance": { title: "Yahoo Finance", sort: 70 },
  general: { title: "通用技能", sort: 90 },
};

function resolveServiceSkillGroupKey(skill: ServiceSkillHomeItem): string {
  const normalized = skill.groupKey?.trim();
  return normalized ? normalized : "general";
}

function resolveServiceSkillGroupTitle(groupKey: string): string {
  return SERVICE_SKILL_GROUP_META[groupKey]?.title ?? groupKey;
}

function resolveServiceSkillGroupSort(groupKey: string): number {
  return SERVICE_SKILL_GROUP_META[groupKey]?.sort ?? 80;
}

function groupMentionServiceSkills(
  skills: ServiceSkillHomeItem[],
  serviceSkillGroups: ServiceSkillGroup[] = [],
): MentionServiceSkillGroup[] {
  const serviceSkillGroupMap = new Map(
    serviceSkillGroups.map((group) => [group.key, group] as const),
  );
  const groups = new Map<string, MentionServiceSkillGroup>();

  for (const skill of skills) {
    const groupKey = resolveServiceSkillGroupKey(skill);
    const groupMeta = serviceSkillGroupMap.get(groupKey);
    const current = groups.get(groupKey);
    if (current) {
      current.skills.push(skill);
      continue;
    }

    groups.set(groupKey, {
      key: groupKey,
      title: groupMeta?.title ?? resolveServiceSkillGroupTitle(groupKey),
      sort: groupMeta?.sort ?? resolveServiceSkillGroupSort(groupKey),
      skills: [skill],
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.sort !== right.sort) {
      return left.sort - right.sort;
    }
    return left.title.localeCompare(right.title, "zh-CN");
  });
}

export function buildInputCapabilitySections(
  params: BuildInputCapabilitySectionsParams,
): InputCapabilitySection[] {
  const isEmptyQuery = params.mentionQuery.trim().length === 0;

  if (params.mode === "slash") {
    return buildSlashCapabilitySections(params, isEmptyQuery);
  }

  return buildMentionCapabilitySections(params, isEmptyQuery);
}

function buildMentionCapabilitySections(
  params: BuildInputCapabilitySectionsParams,
  isEmptyQuery: boolean,
): InputCapabilitySection[] {
  const mentionUsageMap = getMentionEntryUsageMap();
  const serviceSkillRecommendationBuckets = isEmptyQuery
    ? buildServiceSkillRecommendationBuckets(params.mentionServiceSkills, {
        featuredLimit: FEATURED_SERVICE_SKILL_LIMIT,
        surface: "mention",
      })
    : {
        recentSkills: [],
        featuredSkills: [],
        remainingSkills: [],
      };
  const visibleRecentServiceSkills =
    serviceSkillRecommendationBuckets.recentSkills;
  const visibleRecentMentionEntries: RecentMentionEntry[] = [];

  if (isEmptyQuery) {
    for (const command of params.builtinCommands) {
      const recentRecord = mentionUsageMap.get(
        getMentionEntryUsageRecordKey("builtin_command", command.key),
      );
      if (!recentRecord) {
        continue;
      }

      const resolvedReplayText = resolveBuiltinCommandPrefillReplayText({
        command,
        replayText: recentRecord.replayText,
        slotValues: recentRecord.slotValues,
      });

      visibleRecentMentionEntries.push({
        key: `builtin-command:${command.key}`,
        kind: "builtin_command",
        kindLabel: resolveInputCommandSectionMeta(command).kindLabel,
        title: command.commandPrefix,
        description: resolveRecentBuiltinCommandDescription(
          command,
          resolvedReplayText,
        ),
        usedAt: recentRecord.usedAt,
        replayText: resolvedReplayText,
        commandKey: command.key,
        commandPrefix: command.commandPrefix,
      });
    }

    for (const skill of visibleRecentServiceSkills) {
      if (!skill.recentUsedAt) {
        continue;
      }

      const recentPrefill = resolveServiceSkillLaunchPrefill({
        skill,
      });
      visibleRecentMentionEntries.push({
        key: `service-skill:${skill.id}`,
        kind: "service_skill",
        kindLabel: "技能",
        title: skill.title,
        description: [
          buildServiceSkillLaunchPrefillSummary({
            skill,
            slotValues: recentPrefill?.slotValues,
            launchUserInput: recentPrefill?.launchUserInput,
          }),
          buildServiceSkillCapabilityDescription(skill),
        ]
          .filter((segment) => segment.length > 0)
          .join(" · "),
        usedAt: skill.recentUsedAt,
        skillId: skill.id,
      });
    }
  }

  visibleRecentMentionEntries.sort(compareRecentMentionEntries);

  const recentMentionCommandKeys = new Set(
    visibleRecentMentionEntries
      .filter((entry) => entry.kind === "builtin_command")
      .map((entry) => entry.commandKey)
      .filter((entry): entry is string => Boolean(entry)),
  );

  const visibleBuiltinCommands = isEmptyQuery
    ? params.builtinCommands.filter(
        (command) => !recentMentionCommandKeys.has(command.key),
      )
    : params.builtinCommands;
  const visibleFeaturedServiceSkills =
    serviceSkillRecommendationBuckets.featuredSkills;
  const visibleServiceSkillGroups = groupMentionServiceSkills(
    isEmptyQuery
      ? serviceSkillRecommendationBuckets.remainingSkills
      : params.mentionServiceSkills,
    params.serviceSkillGroups,
  );

  const sections: InputCapabilitySection[] = [];

  if (visibleRecentMentionEntries.length > 0) {
    sections.push({
      key: "recent-mention",
      heading: "最近使用",
      items: visibleRecentMentionEntries.flatMap<InputCapabilityDescriptor>(
        (entry) => {
          if (entry.kind === "builtin_command") {
            const command = params.builtinCommands.find(
              (item) => item.key === entry.commandKey,
            );
            const meta = command
              ? resolveInputCommandSectionMeta(command)
              : null;
            return command
              ? [
                {
                  key: entry.key,
                  kind: "builtin_command" as const,
                  title: entry.commandPrefix || command.commandPrefix,
                  description: entry.description,
                  icon: meta?.icon ?? "command",
                  iconClassName:
                    meta?.iconClassName ?? "mr-2 h-4 w-4 text-sky-600",
                  kindLabel: entry.kindLabel,
                  command,
                  replayText: entry.replayText,
                },
              ]
              : [];
          }

          const skill = params.mentionServiceSkills.find(
            (item) => item.id === entry.skillId,
          );
          return skill
            ? [
                {
                  key: entry.key,
                  kind: "service_skill" as const,
                  title: entry.title,
                  description: entry.description,
                  icon: "sparkles" as const,
                  iconClassName: "mr-2 h-4 w-4 text-emerald-600",
                  kindLabel: entry.kindLabel,
                  skill,
                },
              ]
            : [];
        },
      ),
    });
  }

  for (const group of groupItemsBySectionMeta(
    visibleBuiltinCommands,
    resolveInputCommandSectionMeta,
  )) {
    sections.push({
      key: `builtin-commands:${group.meta.key}`,
      heading: group.meta.heading,
      items: group.items.map((command) => {
        const recentRecord = mentionUsageMap.get(
          getMentionEntryUsageRecordKey("builtin_command", command.key),
        );
        const resolvedReplayText = resolveBuiltinCommandPrefillReplayText({
          command,
          replayText: recentRecord?.replayText,
          slotValues: recentRecord?.slotValues,
        });

        return {
          key: command.key,
          kind: "builtin_command" as const,
          title: command.commandPrefix,
          description: resolveRecentBuiltinCommandDescription(
            command,
            resolvedReplayText,
          ),
          icon: group.meta.icon,
          iconClassName: group.meta.iconClassName,
          kindLabel: group.meta.kindLabel,
          command,
          replayText: resolvedReplayText,
        };
      }),
    });
  }

  if (visibleFeaturedServiceSkills.length > 0) {
    sections.push({
      key: "featured-service-skills",
      heading: "推荐做法",
      items: visibleFeaturedServiceSkills.map((skill) => ({
        key: `featured-${skill.id}`,
        kind: "service_skill" as const,
        title: skill.title,
        description: buildServiceSkillCapabilityDescription(skill),
        icon: "sparkles" as const,
        iconClassName: "mr-2 h-4 w-4 text-sky-600",
        skill,
      })),
    });
  }

  for (const group of visibleServiceSkillGroups) {
    sections.push({
      key: `service-skill-group:${group.key}`,
      heading: group.title,
      items: group.skills.map((skill) => ({
        key: skill.id,
        kind: "service_skill" as const,
        title: skill.title,
        description: buildServiceSkillCapabilityDescription(skill),
        icon: "sparkles" as const,
        iconClassName: "mr-2 h-4 w-4 text-emerald-600",
        kindLabel: group.title,
        skill,
      })),
    });
  }

  if (params.filteredCharacters.length > 0) {
    sections.push({
      key: "characters",
      heading: "角色",
      items: params.filteredCharacters.map((character) => ({
        key: character.id,
        kind: "character" as const,
        title: character.name,
        description: character.description?.trim() || character.name,
        icon: "user" as const,
        iconClassName: "mr-2 h-4 w-4",
        character,
      })),
    });
  }

  if (params.installedSkills.length > 0) {
    sections.push({
      key: "installed-skills",
      heading: "我的方法",
      items: params.installedSkills.map((skill) => ({
        key: skill.directory,
        kind: "installed_skill" as const,
        title: skill.name,
        description: buildInstalledSkillCapabilityDescription(skill),
        icon: "zap" as const,
        iconClassName: "mr-2 h-4 w-4 text-primary",
        skill,
      })),
    });
  }

  if (params.availableSkills.length > 0) {
    sections.push({
      key: "available-skills",
      heading: "更多做法",
      items: params.availableSkills.map((skill) => ({
        key: skill.directory,
        kind: "available_skill" as const,
        title: skill.name,
        description: skill.description?.trim() || skill.name,
        icon: "zap" as const,
        iconClassName: "mr-2 h-4 w-4",
        skill,
      })),
    });
  }

  return sections.filter((section) => section.items.length > 0);
}

function buildSlashCapabilitySections(
  params: BuildInputCapabilitySectionsParams,
  isEmptyQuery: boolean,
): InputCapabilitySection[] {
  const filteredCuratedTaskTemplates = filterCuratedTaskTemplates(
    params.mentionQuery,
    listCuratedTaskTemplates(),
  );
  const featuredCuratedTaskTemplates = listFeaturedHomeCuratedTaskTemplates(
    filteredCuratedTaskTemplates,
    {
      projectId: params.projectId,
      sessionId: params.sessionId,
      referenceEntries: params.referenceEntries,
      limit: filteredCuratedTaskTemplates.length,
    },
  );
  const curatedTaskTemplates = featuredCuratedTaskTemplates.map(
    (item) => item.template,
  );
  const featuredCuratedTaskTemplateMap = new Map(
    featuredCuratedTaskTemplates.map((item) => [item.template.id, item] as const),
  );
  const latestReviewSignal = listCuratedTaskRecommendationSignals({
    projectId: params.projectId,
    sessionId: params.sessionId,
  })
    .filter((signal) => signal.source === "review_feedback")
    .sort((left, right) => right.createdAt - left.createdAt)[0];
  const allSupportedSlashCommands = params.slashCommands.filter(
    (command) => command.support === "supported",
  );
  const slashUsageMap = getSlashEntryUsageMap();
  const visibleRecentSlashEntries: RecentSlashEntry[] = [];

  if (isEmptyQuery) {
    for (const command of allSupportedSlashCommands) {
      const recentRecord = slashUsageMap.get(
        getSlashEntryUsageRecordKey("command", command.key),
      );
      if (!recentRecord) {
        continue;
      }

      visibleRecentSlashEntries.push({
        key: `command:${command.key}`,
        kind: "command",
        kindLabel: resolveSlashCommandSectionMeta(command).kindLabel,
        commandPrefix: command.commandPrefix,
        title: command.label,
        description: resolveRecentSlashEntryDescription({
          replayText: recentRecord.replayText,
          fallbackDescription: command.description,
          fallbackTitle: command.label,
        }),
        usedAt: recentRecord.usedAt,
        replayText: recentRecord.replayText,
      });
    }

    for (const command of params.sceneCommands) {
      const recentRecord = slashUsageMap.get(
        getSlashEntryUsageRecordKey("scene", command.key),
      );
      if (!recentRecord) {
        continue;
      }

      visibleRecentSlashEntries.push({
        key: `scene:${command.key}`,
        kind: "scene",
        kindLabel: "结果模板",
        commandPrefix: command.commandPrefix,
        title: command.label,
        description: resolveRecentSlashEntryDescription({
          replayText: recentRecord.replayText,
          fallbackDescription: command.description,
          fallbackTitle: command.label,
        }),
        usedAt: recentRecord.usedAt,
        replayText: recentRecord.replayText,
      });
    }

    for (const skill of params.installedSkills) {
      const recentRecord = slashUsageMap.get(
        getSlashEntryUsageRecordKey("skill", skill.key),
      );
      if (!recentRecord) {
        continue;
      }

      visibleRecentSlashEntries.push({
        key: `skill:${skill.key}`,
        kind: "skill",
        kindLabel: "技能",
        commandPrefix: `/${skill.key}`,
        title: skill.name,
        description: resolveRecentSlashEntryDescription({
          replayText: recentRecord.replayText,
          fallbackDescription: resolveRecentSlashSkillDescription(skill),
          fallbackTitle: skill.name,
        }),
        usedAt: recentRecord.usedAt,
        replayText: recentRecord.replayText,
      });
    }

    for (const template of curatedTaskTemplates) {
      if (typeof template.recentUsedAt !== "number") {
        continue;
      }

      const launchPrefill = resolveCuratedTaskTemplateLaunchPrefill(template);
      visibleRecentSlashEntries.push({
        key: `curated-task:${template.id}`,
        kind: "curated_task",
        kindLabel: "结果模板",
        title: template.title,
        description: [
          buildCuratedTaskRecentUsageDescription({
            task: template,
            prefill: launchPrefill,
          }),
          resolveRecentSlashEntryDescription({
            fallbackDescription: buildCuratedTaskCapabilityDescription(template, {
              includeSummary: false,
              includeResultDestination: true,
              includeFollowUpActions: true,
              followUpLimit: 1,
            }),
            fallbackTitle: template.title,
          }),
        ]
          .filter((segment) => segment.length > 0)
          .join(" · "),
        usedAt: template.recentUsedAt,
        taskId: template.id,
      });
    }
  }

  visibleRecentSlashEntries.sort(compareRecentSlashEntries);

  const recentSlashCommandKeys = new Set(
    visibleRecentSlashEntries
      .filter((entry) => entry.kind === "command")
      .map((entry) => entry.commandPrefix),
  );
  const recentSlashSceneKeys = new Set(
    visibleRecentSlashEntries
      .filter((entry) => entry.kind === "scene")
      .map((entry) => entry.commandPrefix),
  );
  const recentSlashSkillKeys = new Set(
    visibleRecentSlashEntries
      .filter((entry) => entry.kind === "skill")
      .map((entry) => entry.commandPrefix),
  );
  const recentCuratedTaskIds = new Set(
    visibleRecentSlashEntries
      .filter((entry) => entry.kind === "curated_task")
      .map((entry) => entry.taskId)
      .filter((entry): entry is string => Boolean(entry)),
  );

  const visibleSupportedSlashCommands = (
    isEmptyQuery
      ? allSupportedSlashCommands.filter(
          (command) => command.kind === "local_action",
        )
      : allSupportedSlashCommands
  )
    .filter((command) => !recentSlashCommandKeys.has(command.commandPrefix))
    .sort((left, right) =>
      isEmptyQuery ? compareSlashCommandsForEmptyQuery(left, right) : 0,
    );
  const visibleUnsupportedSlashCommands = !isEmptyQuery
    ? params.slashCommands.filter((command) => command.support === "unsupported")
    : [];
  const visibleSceneCommands = params.sceneCommands.filter(
    (command) => !recentSlashSceneKeys.has(command.commandPrefix),
  );
  const visibleInstalledSkills = isEmptyQuery
    ? params.installedSkills.filter(
        (skill) => !recentSlashSkillKeys.has(`/${skill.key}`),
      )
    : params.installedSkills;
  const visibleCuratedTaskTemplates = isEmptyQuery
    ? curatedTaskTemplates.filter((template) => !recentCuratedTaskIds.has(template.id))
    : curatedTaskTemplates;
  const highlightedReviewTemplates = visibleCuratedTaskTemplates
    .filter(
      (task) =>
        featuredCuratedTaskTemplateMap.get(task.id)?.reasonLabel ===
        "围绕最近复盘",
    )
    .slice(0, 2);

  const sections: InputCapabilitySection[] = [];

  const buildRecentSlashCapabilityItems = (
    entries: RecentSlashEntry[],
  ): InputCapabilityDescriptor[] =>
    entries.flatMap<InputCapabilityDescriptor>((entry) => {
      if (entry.kind === "command") {
        const command = allSupportedSlashCommands.find(
          (item) => item.commandPrefix === entry.commandPrefix,
        );
        const meta = command ? resolveSlashCommandSectionMeta(command) : null;
        return command
          ? [
              {
                key: entry.key,
                kind: "slash_command" as const,
                title: entry.title,
                description: entry.description,
                icon: meta?.icon ?? "command",
                iconClassName:
                  meta?.iconClassName ?? "mr-2 h-4 w-4 text-emerald-600",
                kindLabel: mergeCapabilityKindLabel(
                  entry.kindLabel,
                  entry.commandPrefix ?? command.commandPrefix,
                ),
                command,
                replayText: entry.replayText,
              },
            ]
          : [];
      }

      if (entry.kind === "scene") {
        const command = params.sceneCommands.find(
          (item) => item.commandPrefix === entry.commandPrefix,
        );
        return command
          ? [
              {
                key: entry.key,
                kind: "scene_command" as const,
                title: entry.title,
                description: entry.description,
                icon: "zap" as const,
                iconClassName: "mr-2 h-4 w-4 text-sky-600",
                kindLabel: mergeCapabilityKindLabel(
                  entry.kindLabel,
                  entry.commandPrefix ?? command.commandPrefix,
                ),
                command,
                replayText: entry.replayText,
              },
            ]
          : [];
      }

      if (entry.kind === "curated_task") {
        const task = curatedTaskTemplates.find((item) => item.id === entry.taskId);
        if (!task) {
          return [];
        }
        const launchContext = resolveCuratedTaskLaunchContext({
          task,
          referenceEntries: params.referenceEntries,
        });
        return [
          {
            key: entry.key,
            kind: "curated_task" as const,
            title: task.title,
            description: buildCuratedTaskSlashDescription({
              task,
              referenceEntries: launchContext.mergedReferenceEntries,
              fallbackDescription: entry.description,
            }),
            icon: "sparkles" as const,
            iconClassName: "mr-2 h-4 w-4 text-amber-600",
            kindLabel: entry.kindLabel,
            task,
            launchInputValues: launchContext.launchPrefill?.inputValues,
            referenceMemoryIds: launchContext.mergedReferenceMemoryIds,
            referenceEntries: launchContext.mergedReferenceEntries,
            launcherPrefillHint: launchContext.launchPrefill?.hint,
          },
        ];
      }

      const skill = params.installedSkills.find(
        (item) => `/${item.key}` === entry.commandPrefix,
      );
      return skill
        ? [
            {
              key: entry.key,
              kind: "installed_skill" as const,
              title: skill.name,
              description: entry.description,
              icon: "zap" as const,
              iconClassName: "mr-2 h-4 w-4 text-primary",
              kindLabel: mergeCapabilityKindLabel(
                entry.kindLabel,
                entry.commandPrefix ?? `/${skill.key}`,
              ),
              skill,
              replayText: entry.replayText,
            },
          ]
        : [];
    });

  const visibleRecentContinuationEntries = isEmptyQuery
    ? visibleRecentSlashEntries.filter((entry) => entry.kind !== "command")
    : visibleRecentSlashEntries;
  const visibleRecentCommandEntries = isEmptyQuery
    ? visibleRecentSlashEntries.filter((entry) => entry.kind === "command")
    : [];

  if (visibleUnsupportedSlashCommands.length > 0) {
    sections.push({
      key: "unsupported-slash-commands",
      heading: "暂未接入",
      items: visibleUnsupportedSlashCommands.map((command) => ({
        key: command.key,
        kind: "slash_command" as const,
        title: command.commandPrefix,
        description: command.description,
        icon: "command" as const,
        iconClassName: "mr-2 h-4 w-4 text-muted-foreground",
        kindLabel: "暂未支持",
        command,
      })),
    });
  }

  const visibleResultTemplateItems: InputCapabilityDescriptor[] = [
    ...visibleSceneCommands.map((command) => ({
      key: command.entryId ?? command.key,
      kind: "scene_command" as const,
      title: resolveDisplayTitleFromCommandLike(command),
      description: command.description,
      icon: "zap" as const,
      iconClassName: "mr-2 h-4 w-4 text-sky-600",
      kindLabel: command.commandPrefix,
      command,
    })),
    ...visibleCuratedTaskTemplates.map((task) => {
      const launchContext = resolveCuratedTaskLaunchContext({
        task,
        referenceEntries: params.referenceEntries,
      });
      return {
        key: task.id,
        kind: "curated_task" as const,
        title: task.title,
        description: buildCuratedTaskSlashDescription({
          task,
          reasonSummary: featuredCuratedTaskTemplateMap.get(task.id)?.reasonSummary,
          referenceEntries: launchContext.mergedReferenceEntries,
          fallbackDescription: buildCuratedTaskCapabilityDescription(task, {
            includeResultDestination: true,
          }),
        }),
        icon: "sparkles" as const,
        iconClassName: "mr-2 h-4 w-4 text-amber-600",
        task,
        launchInputValues: launchContext.launchPrefill?.inputValues,
        referenceMemoryIds: launchContext.mergedReferenceMemoryIds,
        referenceEntries: launchContext.mergedReferenceEntries,
        launcherPrefillHint: launchContext.launchPrefill?.hint,
      };
    }),
  ];

  const resultTemplatesSection: InputCapabilitySection | null =
    visibleResultTemplateItems.length > 0
      ? {
      key: "result-templates",
      heading: isEmptyQuery ? "先拿结果" : "结果模板",
      items: visibleResultTemplateItems,
      ...(latestReviewSignal && highlightedReviewTemplates.length > 0
        ? {
            banner: (() => {
              const projection = buildReviewFeedbackProjection({
                signal: latestReviewSignal,
              });
              const primarySuggestedItem =
                (projection?.suggestedTasks[0]
                  ? visibleResultTemplateItems.find(
                      (item) => item.key === projection.suggestedTasks[0]?.taskId,
                    )
                  : null) ??
                visibleResultTemplateItems.find(
                  (item) => item.key === highlightedReviewTemplates[0]?.id,
                ) ??
                null;

              return {
                title: `最近复盘已更新：${latestReviewSignal.title}`,
                summary: truncateSectionBannerText(
                  [
                    latestReviewSignal.summary,
                    projection?.suggestionText ?? "",
                  ]
                    .filter((segment) => segment.trim().length > 0)
                    .join(" "),
                ),
                footnote: `更适合继续：${highlightedReviewTemplates
                  .map((task) => task.title)
                  .join(" / ")}`,
                actionLabel: primarySuggestedItem
                  ? `继续去「${primarySuggestedItem.title}」`
                  : undefined,
                actionItemKey: primarySuggestedItem?.key,
              };
            })(),
          }
        : {}),
        }
      : null;

  const installedSkillsSection: InputCapabilitySection | null =
    visibleInstalledSkills.length > 0
      ? {
          key: "installed-skills",
          heading: isEmptyQuery ? "已经沉淀的方法" : "我的方法",
          items: visibleInstalledSkills.map((skill) => ({
            key: skill.directory,
            kind: "installed_skill" as const,
            title: skill.name,
            description: buildInstalledSkillCapabilityDescription(skill),
            icon: "zap" as const,
            iconClassName: "mr-2 h-4 w-4 text-primary",
            skill,
          })),
        }
      : null;

  if (isEmptyQuery && resultTemplatesSection) {
    sections.push(resultTemplatesSection);
  }

  if (visibleRecentContinuationEntries.length > 0) {
    sections.push({
      key: "recent-slash-continuations",
      heading: isEmptyQuery ? "继续上次做法" : "最近使用",
      items: buildRecentSlashCapabilityItems(visibleRecentContinuationEntries),
    });
  }

  if (isEmptyQuery && installedSkillsSection) {
    sections.push(installedSkillsSection);
  }

  for (const group of groupItemsBySectionMeta(
    visibleSupportedSlashCommands,
    resolveSlashCommandSectionMeta,
  )) {
    sections.push({
      key: `supported-slash-commands:${group.meta.key}`,
      heading: group.meta.heading,
      items: group.items.map((command) => {
        const recentRecord = slashUsageMap.get(
          getSlashEntryUsageRecordKey("command", command.key),
        );
        return {
          key: command.key,
          kind: "slash_command" as const,
          title: resolveDisplayTitleFromCommandLike(command),
          description: resolveRecentSlashEntryDescription({
            replayText: recentRecord?.replayText,
            fallbackDescription: command.description,
            fallbackTitle: command.label,
          }),
          icon: group.meta.icon,
          iconClassName: group.meta.iconClassName,
          kindLabel: mergeCapabilityKindLabel(
            group.meta.kindLabel,
            command.commandPrefix,
          ),
          command,
          replayText: recentRecord?.replayText,
        };
      }),
    });
  }

  if (visibleRecentCommandEntries.length > 0) {
    sections.push({
      key: "recent-slash-operations",
      heading: "最近操作",
      items: buildRecentSlashCapabilityItems(visibleRecentCommandEntries),
    });
  }

  if (!isEmptyQuery && installedSkillsSection) {
    sections.push(installedSkillsSection);
  }

  if (!isEmptyQuery && resultTemplatesSection) {
    sections.push(resultTemplatesSection);
  }

  if (params.availableSkills.length > 0) {
    sections.push({
      key: "available-skills",
      heading: "更多做法",
      items: params.availableSkills.map((skill) => ({
        key: skill.directory,
        kind: "available_skill" as const,
        title: skill.name,
        description: skill.description?.trim() || skill.name,
        icon: "zap" as const,
        iconClassName: "mr-2 h-4 w-4",
        skill,
      })),
    });
  }

  return sections.filter((section) => section.items.length > 0);
}
