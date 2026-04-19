import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import { buildServiceSkillRecommendationBuckets } from "@/components/agent/chat/service-skills/recommendedServiceSkills";
import { buildServiceSkillCapabilityDescription } from "@/components/agent/chat/service-skills/skillPresentation";
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
  buildCuratedTaskCapabilityDescription,
  filterCuratedTaskTemplates,
  listCuratedTaskTemplates,
  type CuratedTaskTemplateItem,
} from "../utils/curatedTaskTemplates";
import { buildInstalledSkillCapabilityDescription } from "@/components/skills/installedSkillPresentation";

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
        kindLabel: "命令",
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

      visibleRecentMentionEntries.push({
        key: `service-skill:${skill.id}`,
        kind: "service_skill",
        kindLabel: "技能",
        title: skill.title,
        description: buildServiceSkillCapabilityDescription(skill),
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
            return command
            ? [
                {
                  key: entry.key,
                  kind: "builtin_command" as const,
                  title: entry.commandPrefix || command.commandPrefix,
                  description: entry.description,
                  icon: "command" as const,
                  iconClassName: "mr-2 h-4 w-4 text-sky-600",
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

  if (visibleBuiltinCommands.length > 0) {
    sections.push({
      key: "builtin-commands",
      heading: "内建命令",
      items: visibleBuiltinCommands.map((command) => {
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
          icon: "image-plus" as const,
          iconClassName: "mr-2 h-4 w-4 text-sky-600",
          command,
          replayText: resolvedReplayText,
        };
      }),
    });
  }

  if (visibleFeaturedServiceSkills.length > 0) {
    sections.push({
      key: "featured-service-skills",
      heading: "推荐技能",
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
      heading: `技能组 · ${group.title}`,
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
      heading: "已安装技能",
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
      heading: "未安装技能",
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
  const curatedTaskTemplates = filterCuratedTaskTemplates(
    params.mentionQuery,
    listCuratedTaskTemplates(),
  );
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
        kindLabel: "快捷操作",
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

      visibleRecentSlashEntries.push({
        key: `curated-task:${template.id}`,
        kind: "curated_task",
        kindLabel: "结果模板",
        title: template.title,
        description: resolveRecentSlashEntryDescription({
          fallbackDescription: template.summary,
          fallbackTitle: template.title,
        }),
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

  const visibleSupportedSlashCommands = allSupportedSlashCommands.filter(
    (command) => !recentSlashCommandKeys.has(command.commandPrefix),
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

  const sections: InputCapabilitySection[] = [];

  if (visibleRecentSlashEntries.length > 0) {
    sections.push({
      key: "recent-slash",
      heading: "最近使用",
      items: visibleRecentSlashEntries.flatMap<InputCapabilityDescriptor>(
        (entry) => {
          if (entry.kind === "command") {
            const command = allSupportedSlashCommands.find(
              (item) => item.commandPrefix === entry.commandPrefix,
            );
            return command
            ? [
                {
                  key: entry.key,
                  kind: "slash_command" as const,
                  title: entry.commandPrefix ?? command.commandPrefix,
                  description: entry.description,
                  icon: "command" as const,
                  iconClassName: "mr-2 h-4 w-4 text-emerald-600",
                  kindLabel: entry.kindLabel,
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
                  title: entry.commandPrefix ?? command.commandPrefix,
                  description: entry.description,
                  icon: "zap" as const,
                  iconClassName: "mr-2 h-4 w-4 text-sky-600",
                  kindLabel: entry.kindLabel,
                  command,
                  replayText: entry.replayText,
                },
              ]
            : [];
        }

        if (entry.kind === "curated_task") {
          const task = curatedTaskTemplates.find(
            (item) => item.id === entry.taskId,
          );
          return task
            ? [
                {
                  key: entry.key,
                  kind: "curated_task" as const,
                  title: task.title,
                  description: buildCuratedTaskCapabilityDescription(task),
                  icon: "sparkles" as const,
                  iconClassName: "mr-2 h-4 w-4 text-amber-600",
                  kindLabel: entry.kindLabel,
                  task,
                },
              ]
            : [];
        }

        const skill = params.installedSkills.find(
          (item) => `/${item.key}` === entry.commandPrefix,
        );
        return skill
          ? [
              {
                key: entry.key,
                kind: "installed_skill" as const,
                title: entry.commandPrefix ?? `/${skill.key}`,
                description: entry.description,
                icon: "zap" as const,
                iconClassName: "mr-2 h-4 w-4 text-primary",
                kindLabel: entry.kindLabel,
                skill,
                replayText: entry.replayText,
              },
            ]
          : [];
        },
      ),
    });
  }

  if (visibleSupportedSlashCommands.length > 0) {
    sections.push({
      key: "supported-slash-commands",
      heading: isEmptyQuery ? "快捷操作" : "Lime 命令",
      items: visibleSupportedSlashCommands.map((command) => ({
        key: command.key,
        kind: "slash_command" as const,
        title: command.commandPrefix,
        description: command.description,
        icon: "command" as const,
        iconClassName: "mr-2 h-4 w-4 text-emerald-600",
        command,
      })),
    });
  }

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
      title: command.commandPrefix,
      description: command.description,
      icon: "zap" as const,
      iconClassName: "mr-2 h-4 w-4 text-sky-600",
      command,
    })),
    ...visibleCuratedTaskTemplates.map((task) => ({
      key: task.id,
      kind: "curated_task" as const,
      title: task.title,
      description: buildCuratedTaskCapabilityDescription(task),
      icon: "sparkles" as const,
      iconClassName: "mr-2 h-4 w-4 text-amber-600",
      kindLabel: task.badge,
      task,
    })),
  ];

  if (visibleResultTemplateItems.length > 0) {
    sections.push({
      key: "result-templates",
      heading: "结果模板",
      items: visibleResultTemplateItems,
    });
  }

  if (visibleInstalledSkills.length > 0) {
    sections.push({
      key: "installed-skills",
      heading: "已安装技能",
      items: visibleInstalledSkills.map((skill) => ({
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
      heading: "未安装技能",
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
