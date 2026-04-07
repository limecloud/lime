import React from "react";
import {
  Command as CommandIcon,
  ImagePlus,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import { resolveServiceSkillEntryDescription } from "@/components/agent/chat/service-skills/entryAdapter";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
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

interface MentionServiceSkillGroup {
  key: string;
  title: string;
  sort: number;
  skills: ServiceSkillHomeItem[];
}

interface RecentSlashEntry {
  key: string;
  kind: SlashEntryUsageKind;
  kindLabel: string;
  commandPrefix: string;
  title: string;
  description: string;
  usedAt: number;
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

const FEATURED_SERVICE_SKILL_LIMIT = 4;
const RECENT_REPLAY_TEXT_PREVIEW_LIMIT = 48;

function compareRecentServiceSkills(
  left: ServiceSkillHomeItem,
  right: ServiceSkillHomeItem,
): number {
  const leftUsedAt = left.recentUsedAt ?? 0;
  const rightUsedAt = right.recentUsedAt ?? 0;
  if (leftUsedAt !== rightUsedAt) {
    return rightUsedAt - leftUsedAt;
  }
  return left.title.localeCompare(right.title, "zh-CN");
}

function compareRecentSlashEntries(
  left: RecentSlashEntry,
  right: RecentSlashEntry,
): number {
  if (left.usedAt !== right.usedAt) {
    return right.usedAt - left.usedAt;
  }
  return left.commandPrefix.localeCompare(right.commandPrefix, "zh-CN");
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
  if (skill.description?.trim()) {
    return `${skill.name} · ${skill.description}`;
  }
  return skill.name;
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
): MentionServiceSkillGroup[] {
  const groups = new Map<string, MentionServiceSkillGroup>();

  for (const skill of skills) {
    const groupKey = resolveServiceSkillGroupKey(skill);
    const current = groups.get(groupKey);
    if (current) {
      current.skills.push(skill);
      continue;
    }

    groups.set(groupKey, {
      key: groupKey,
      title: resolveServiceSkillGroupTitle(groupKey),
      sort: resolveServiceSkillGroupSort(groupKey),
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

interface CharacterMentionPanelProps {
  mode: "mention" | "slash";
  mentionQuery: string;
  builtinCommands: BuiltinInputCommand[];
  slashCommands: CodexSlashCommandDefinition[];
  sceneCommands: RuntimeSceneSlashCommand[];
  mentionServiceSkills: ServiceSkillHomeItem[];
  filteredCharacters: Character[];
  installedSkills: Skill[];
  availableSkills: Skill[];
  commandRef: React.RefObject<HTMLDivElement>;
  onQueryChange: (query: string) => void;
  onSelectBuiltinCommand: (
    command: BuiltinInputCommand,
    options?: { replayText?: string },
  ) => void;
  onSelectServiceSkill: (skill: ServiceSkillHomeItem) => void;
  onSelectSlashCommand: (command: CodexSlashCommandDefinition) => void;
  onSelectSceneCommand: (command: RuntimeSceneSlashCommand) => void;
  onSelectCharacter: (character: Character) => void;
  onSelectInstalledSkill: (skill: Skill) => void;
  onSelectAvailableSkill: (skill: Skill) => void;
  onNavigateToSettings?: () => void;
}

export const CharacterMentionPanel: React.FC<CharacterMentionPanelProps> = ({
  mode,
  mentionQuery,
  builtinCommands,
  slashCommands,
  sceneCommands,
  mentionServiceSkills,
  filteredCharacters,
  installedSkills,
  availableSkills,
  commandRef,
  onQueryChange,
  onSelectBuiltinCommand,
  onSelectServiceSkill,
  onSelectSlashCommand,
  onSelectSceneCommand,
  onSelectCharacter,
  onSelectInstalledSkill,
  onSelectAvailableSkill,
  onNavigateToSettings,
}) => {
  const isEmptyQuery = mentionQuery.trim().length === 0;
  const allSupportedSlashCommands = React.useMemo(
    () =>
      mode === "slash"
        ? slashCommands.filter((command) => command.support === "supported")
        : [],
    [mode, slashCommands],
  );
  const visibleRecentSlashEntries = React.useMemo(() => {
    if (mode !== "slash" || !isEmptyQuery) {
      return [];
    }

    const usageMap = getSlashEntryUsageMap();
    const recentEntries: RecentSlashEntry[] = [];

    for (const command of allSupportedSlashCommands) {
      const recentRecord = usageMap.get(
        getSlashEntryUsageRecordKey("command", command.key),
      );
      if (!recentRecord) {
        continue;
      }

      recentEntries.push({
        key: `command:${command.key}`,
        kind: "command",
        kindLabel: "快捷操作",
        commandPrefix: command.commandPrefix,
        title: command.label,
        description: command.description,
        usedAt: recentRecord.usedAt,
      });
    }

    for (const command of sceneCommands) {
      const recentRecord = usageMap.get(
        getSlashEntryUsageRecordKey("scene", command.key),
      );
      if (!recentRecord) {
        continue;
      }

      recentEntries.push({
        key: `scene:${command.key}`,
        kind: "scene",
        kindLabel: "场景",
        commandPrefix: command.commandPrefix,
        title: command.label,
        description: command.description,
        usedAt: recentRecord.usedAt,
      });
    }

    for (const skill of installedSkills) {
      const recentRecord = usageMap.get(
        getSlashEntryUsageRecordKey("skill", skill.key),
      );
      if (!recentRecord) {
        continue;
      }

      recentEntries.push({
        key: `skill:${skill.key}`,
        kind: "skill",
        kindLabel: "技能",
        commandPrefix: `/${skill.key}`,
        title: skill.name,
        description: resolveRecentSlashSkillDescription(skill),
        usedAt: recentRecord.usedAt,
      });
    }

    return recentEntries.sort(compareRecentSlashEntries);
  }, [
    allSupportedSlashCommands,
    installedSkills,
    isEmptyQuery,
    mode,
    sceneCommands,
  ]);
  const recentSlashCommandKeys = React.useMemo(
    () =>
      new Set(
        visibleRecentSlashEntries
          .filter((entry) => entry.kind === "command")
          .map((entry) => entry.commandPrefix),
      ),
    [visibleRecentSlashEntries],
  );
  const recentSlashSceneKeys = React.useMemo(
    () =>
      new Set(
        visibleRecentSlashEntries
          .filter((entry) => entry.kind === "scene")
          .map((entry) => entry.commandPrefix),
      ),
    [visibleRecentSlashEntries],
  );
  const recentSlashSkillKeys = React.useMemo(
    () =>
      new Set(
        visibleRecentSlashEntries
          .filter((entry) => entry.kind === "skill")
          .map((entry) => entry.commandPrefix),
      ),
    [visibleRecentSlashEntries],
  );
  const visibleSupportedSlashCommands = React.useMemo(
    () =>
      allSupportedSlashCommands.filter(
        (command) => !recentSlashCommandKeys.has(command.commandPrefix),
      ),
    [allSupportedSlashCommands, recentSlashCommandKeys],
  );
  const visibleUnsupportedSlashCommands = React.useMemo(
    () =>
      mode === "slash" && !isEmptyQuery
        ? slashCommands.filter((command) => command.support === "unsupported")
        : [],
    [isEmptyQuery, mode, slashCommands],
  );
  const visibleRecentServiceSkills = React.useMemo(() => {
    if (mode !== "mention" || !isEmptyQuery) {
      return [];
    }

    return mentionServiceSkills
      .filter((skill) => skill.isRecent && skill.recentUsedAt)
      .sort(compareRecentServiceSkills);
  }, [isEmptyQuery, mentionServiceSkills, mode]);
  const visibleRecentMentionEntries = React.useMemo(() => {
    if (mode !== "mention" || !isEmptyQuery) {
      return [];
    }

    const usageMap = getMentionEntryUsageMap();
    const recentEntries: RecentMentionEntry[] = [];

    for (const command of builtinCommands) {
      const recentRecord = usageMap.get(
        getMentionEntryUsageRecordKey("builtin_command", command.key),
      );
      if (!recentRecord) {
        continue;
      }

      recentEntries.push({
        key: `builtin-command:${command.key}`,
        kind: "builtin_command",
        kindLabel: "命令",
        title: command.commandPrefix,
        description: resolveRecentBuiltinCommandDescription(
          command,
          recentRecord.replayText,
        ),
        usedAt: recentRecord.usedAt,
        replayText: recentRecord.replayText,
        commandKey: command.key,
        commandPrefix: command.commandPrefix,
      });
    }

    for (const skill of visibleRecentServiceSkills) {
      if (!skill.recentUsedAt) {
        continue;
      }

      recentEntries.push({
        key: `service-skill:${skill.id}`,
        kind: "service_skill",
        kindLabel: "技能",
        title: skill.title,
        description: resolveServiceSkillEntryDescription(skill),
        usedAt: skill.recentUsedAt,
        skillId: skill.id,
      });
    }

    return recentEntries.sort(compareRecentMentionEntries);
  }, [builtinCommands, isEmptyQuery, mode, visibleRecentServiceSkills]);
  const recentMentionCommandKeys = React.useMemo(
    () =>
      new Set(
        visibleRecentMentionEntries
          .filter((entry) => entry.kind === "builtin_command")
          .map((entry) => entry.commandKey)
          .filter((entry): entry is string => Boolean(entry)),
      ),
    [visibleRecentMentionEntries],
  );
  const visibleBuiltinCommands = React.useMemo(() => {
    if (mode !== "mention") {
      return [];
    }

    if (!isEmptyQuery) {
      return builtinCommands;
    }

    return builtinCommands.filter(
      (command) => !recentMentionCommandKeys.has(command.key),
    );
  }, [builtinCommands, isEmptyQuery, mode, recentMentionCommandKeys]);
  const visibleFeaturedServiceSkills = React.useMemo(() => {
    if (mode !== "mention" || !isEmptyQuery) {
      return [];
    }

    const recentSkillIds = new Set(
      visibleRecentServiceSkills.map((skill) => skill.id),
    );

    return mentionServiceSkills
      .filter((skill) => !recentSkillIds.has(skill.id))
      .slice(0, FEATURED_SERVICE_SKILL_LIMIT);
  }, [isEmptyQuery, mentionServiceSkills, mode, visibleRecentServiceSkills]);
  const visibleServiceSkillGroups = React.useMemo(() => {
    if (mode !== "mention") {
      return [];
    }

    const excludedSkillIds = new Set(
      visibleRecentServiceSkills.map((skill) => skill.id),
    );
    for (const skill of visibleFeaturedServiceSkills) {
      excludedSkillIds.add(skill.id);
    }

    return groupMentionServiceSkills(
      mentionServiceSkills.filter((skill) => !excludedSkillIds.has(skill.id)),
    );
  }, [
    mentionServiceSkills,
    mode,
    visibleFeaturedServiceSkills,
    visibleRecentServiceSkills,
  ]);
  const visibleCharacters = mode === "mention" ? filteredCharacters : [];
  const visibleSceneCommands = React.useMemo(
    () =>
      mode === "slash"
        ? sceneCommands.filter(
            (command) => !recentSlashSceneKeys.has(command.commandPrefix),
          )
        : [],
    [mode, recentSlashSceneKeys, sceneCommands],
  );
  const visibleInstalledSkills = React.useMemo(() => {
    if (mode !== "slash" || !isEmptyQuery) {
      return installedSkills;
    }

    return installedSkills.filter(
      (skill) => !recentSlashSkillKeys.has(`/${skill.key}`),
    );
  }, [installedSkills, isEmptyQuery, mode, recentSlashSkillKeys]);
  const hasFilteredResults =
    visibleRecentSlashEntries.length > 0 ||
    visibleSupportedSlashCommands.length > 0 ||
    visibleUnsupportedSlashCommands.length > 0 ||
    visibleSceneCommands.length > 0 ||
    visibleRecentMentionEntries.length > 0 ||
    visibleBuiltinCommands.length > 0 ||
    visibleFeaturedServiceSkills.length > 0 ||
    visibleServiceSkillGroups.length > 0 ||
    visibleCharacters.length > 0 ||
    visibleInstalledSkills.length > 0 ||
    availableSkills.length > 0;

  return (
    <Command ref={commandRef} className="bg-background">
      <CommandInput
        placeholder={
          mode === "slash" ? "搜索命令或技能..." : "搜索角色或技能..."
        }
        value={mentionQuery}
        onValueChange={onQueryChange}
      />
      <CommandList>
        {!hasFilteredResults ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            <div>
              {mode === "slash" ? "暂无可用命令或技能" : "暂无可用角色或技能"}
            </div>
            {onNavigateToSettings ? (
              <button
                type="button"
                className="mt-2 text-primary hover:underline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onNavigateToSettings}
              >
                去技能中心
              </button>
            ) : null}
          </div>
        ) : null}
        {visibleRecentMentionEntries.length > 0 ? (
          <CommandGroup heading="最近使用">
            {visibleRecentMentionEntries.map((entry) => {
              if (entry.kind === "builtin_command") {
                return (
                  <CommandItem
                    key={entry.key}
                    onSelect={() => {
                      const command = builtinCommands.find(
                        (item) => item.key === entry.commandKey,
                      );
                      if (command) {
                        if (entry.replayText) {
                          onSelectBuiltinCommand(command, {
                            replayText: entry.replayText,
                          });
                        } else {
                          onSelectBuiltinCommand(command);
                        }
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <CommandIcon className="mr-2 h-4 w-4 text-sky-600" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{entry.commandPrefix}</div>
                        <span className="text-[10px] text-muted-foreground">
                          {entry.kindLabel}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {entry.description}
                      </div>
                    </div>
                  </CommandItem>
                );
              }

              return (
                <CommandItem
                  key={entry.key}
                  onSelect={() => {
                    const skill = mentionServiceSkills.find(
                      (item) => item.id === entry.skillId,
                    );
                    if (skill) {
                      onSelectServiceSkill(skill);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <Sparkles className="mr-2 h-4 w-4 text-emerald-600" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{entry.title}</div>
                      <span className="text-[10px] text-muted-foreground">
                        {entry.kindLabel}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {entry.description}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {visibleRecentSlashEntries.length > 0 ? (
          <CommandGroup heading="最近使用">
            {visibleRecentSlashEntries.map((entry) => {
              const iconClassName =
                entry.kind === "command"
                  ? "mr-2 h-4 w-4 text-emerald-600"
                  : entry.kind === "scene"
                    ? "mr-2 h-4 w-4 text-sky-600"
                    : "mr-2 h-4 w-4 text-primary";

              return (
                <CommandItem
                  key={entry.key}
                  onSelect={() => {
                    if (entry.kind === "command") {
                      const command = allSupportedSlashCommands.find(
                        (item) => item.commandPrefix === entry.commandPrefix,
                      );
                      if (command) {
                        onSelectSlashCommand(command);
                      }
                      return;
                    }

                    if (entry.kind === "scene") {
                      const sceneCommand = sceneCommands.find(
                        (item) => item.commandPrefix === entry.commandPrefix,
                      );
                      if (sceneCommand) {
                        onSelectSceneCommand(sceneCommand);
                      }
                      return;
                    }

                    const skill = installedSkills.find(
                      (item) => `/${item.key}` === entry.commandPrefix,
                    );
                    if (skill) {
                      onSelectInstalledSkill(skill);
                    }
                  }}
                  className="cursor-pointer"
                >
                  {entry.kind === "command" ? (
                    <CommandIcon className={iconClassName} />
                  ) : (
                    <Zap className={iconClassName} />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{entry.commandPrefix}</div>
                      <span className="text-[10px] text-muted-foreground">
                        {entry.kindLabel}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {entry.description}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {visibleSupportedSlashCommands.length > 0 ? (
          <CommandGroup heading={isEmptyQuery ? "快捷操作" : "Lime 命令"}>
            {visibleSupportedSlashCommands.map((command) => (
              <CommandItem
                key={command.key}
                onSelect={() => onSelectSlashCommand(command)}
                className="cursor-pointer"
              >
                <CommandIcon className="mr-2 h-4 w-4 text-emerald-600" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    <span>{command.commandPrefix}</span>
                    {command.support === "unsupported" ? (
                      <span className="text-[10px] font-normal text-muted-foreground">
                        暂未支持
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {command.description}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {visibleUnsupportedSlashCommands.length > 0 ? (
          <CommandGroup heading="暂未接入">
            {visibleUnsupportedSlashCommands.map((command) => (
              <CommandItem
                key={command.key}
                onSelect={() => onSelectSlashCommand(command)}
                className="cursor-pointer"
              >
                <CommandIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    <span>{command.commandPrefix}</span>
                    <span className="text-[10px] font-normal text-muted-foreground">
                      暂未支持
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {command.description}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {visibleSceneCommands.length > 0 ? (
          <CommandGroup heading="场景组合">
            {visibleSceneCommands.map((command) => (
              <CommandItem
                key={command.entryId ?? command.key}
                onSelect={() => onSelectSceneCommand(command)}
                className="cursor-pointer"
              >
                <Zap className="mr-2 h-4 w-4 text-sky-600" />
                <div className="flex-1">
                  <div className="font-medium">{command.commandPrefix}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {command.description}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {visibleBuiltinCommands.length > 0 ? (
          <CommandGroup heading="内建命令">
            {visibleBuiltinCommands.map((command) => (
              <CommandItem
                key={command.key}
                onSelect={() => onSelectBuiltinCommand(command)}
                className="cursor-pointer"
              >
                <ImagePlus className="mr-2 h-4 w-4 text-sky-600" />
                <div className="flex-1">
                  <div className="font-medium">{command.commandPrefix}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {command.description}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {visibleFeaturedServiceSkills.length > 0 ? (
          <CommandGroup heading="推荐技能">
            {visibleFeaturedServiceSkills.map((skill) => (
              <CommandItem
                key={`featured-${skill.id}`}
                onSelect={() => onSelectServiceSkill(skill)}
                className="cursor-pointer"
              >
                <Sparkles className="mr-2 h-4 w-4 text-sky-600" />
                <div className="flex-1">
                  <div className="font-medium">{skill.title}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {resolveServiceSkillEntryDescription(skill)}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {visibleServiceSkillGroups.map((group) => (
          <CommandGroup key={group.key} heading={`技能组 · ${group.title}`}>
            {group.skills.map((skill) => (
              <CommandItem
                key={skill.id}
                onSelect={() => onSelectServiceSkill(skill)}
                className="cursor-pointer"
              >
                <Sparkles className="mr-2 h-4 w-4 text-emerald-600" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{skill.title}</div>
                    <span className="text-[10px] text-muted-foreground">
                      {group.title}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {resolveServiceSkillEntryDescription(skill)}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {visibleCharacters.length > 0 ? (
          <CommandGroup heading="角色">
            {visibleCharacters.map((character) => (
              <CommandItem
                key={character.id}
                onSelect={() => onSelectCharacter(character)}
                className="cursor-pointer"
              >
                <User className="mr-2 h-4 w-4" />
                <div className="flex-1">
                  <div className="font-medium">{character.name}</div>
                  {character.description ? (
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {character.description}
                    </div>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {visibleInstalledSkills.length > 0 ? (
          <CommandGroup heading="已安装技能">
            {visibleInstalledSkills.map((skill) => (
              <CommandItem
                key={skill.directory}
                onSelect={() => onSelectInstalledSkill(skill)}
                className="cursor-pointer"
              >
                <Zap className="mr-2 h-4 w-4 text-primary" />
                <div className="flex-1">
                  <div className="font-medium">{skill.name}</div>
                  {skill.description ? (
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {skill.description}
                    </div>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {availableSkills.length > 0 ? (
          <CommandGroup heading="未安装技能">
            {availableSkills.map((skill) => (
              <CommandItem
                key={skill.directory}
                onSelect={() => onSelectAvailableSkill(skill)}
                className="cursor-pointer opacity-60"
              >
                <Zap className="mr-2 h-4 w-4" />
                <div className="flex-1">
                  <div className="font-medium">{skill.name}</div>
                  {skill.description ? (
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {skill.description}
                    </div>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  );
};
