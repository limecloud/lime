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
import { cn } from "@/lib/utils";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type {
  ServiceSkillGroup,
  ServiceSkillHomeItem,
} from "@/components/agent/chat/service-skills/types";
import type { CodexSlashCommandDefinition } from "../commands";
import type {
  BuiltinInputCommand,
  RuntimeSceneSlashCommand,
} from "./builtinCommands";
import type {
  CuratedTaskInputValues,
  CuratedTaskTemplateItem,
} from "../utils/curatedTaskTemplates";
import {
  buildInputCapabilitySections,
  type InputCapabilityDescriptor,
} from "./inputCapabilitySections";
import type { CuratedTaskReferenceEntry } from "../utils/curatedTaskReferenceSelection";

interface CharacterMentionPanelProps {
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
  curatedTaskTemplatesVersion?: number;
  curatedTaskRecommendationSignalsVersion?: number;
  mentionEntryUsageVersion?: number;
  slashEntryUsageVersion?: number;
  commandRef: React.RefObject<HTMLDivElement>;
  onQueryChange: (query: string) => void;
  onSelectBuiltinCommand: (
    command: BuiltinInputCommand,
    options?: { replayText?: string },
  ) => void;
  onSelectServiceSkill: (skill: ServiceSkillHomeItem) => void;
  onSelectSlashCommand: (
    command: CodexSlashCommandDefinition,
    options?: { replayText?: string },
  ) => void;
  onSelectSceneCommand: (
    command: RuntimeSceneSlashCommand,
    options?: { replayText?: string },
  ) => void;
  onSelectCuratedTask?: (
    task: CuratedTaskTemplateItem,
    options?: {
      launchInputValues?: CuratedTaskInputValues;
      referenceMemoryIds?: string[];
      referenceEntries?: CuratedTaskReferenceEntry[];
      launcherPrefillHint?: string;
    },
  ) => void;
  onSelectCharacter: (character: Character) => void;
  onSelectInstalledSkill: (
    skill: Skill,
    options?: { replayText?: string },
  ) => void;
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
  serviceSkillGroups = [],
  filteredCharacters,
  installedSkills,
  availableSkills,
  projectId,
  sessionId,
  referenceEntries = [],
  curatedTaskTemplatesVersion = 0,
  curatedTaskRecommendationSignalsVersion = 0,
  mentionEntryUsageVersion = 0,
  slashEntryUsageVersion = 0,
  commandRef,
  onQueryChange,
  onSelectBuiltinCommand,
  onSelectServiceSkill,
  onSelectSlashCommand,
  onSelectSceneCommand,
  onSelectCuratedTask,
  onSelectCharacter,
  onSelectInstalledSkill,
  onSelectAvailableSkill,
  onNavigateToSettings,
}) => {
  const sections = React.useMemo(
    () => {
      void curatedTaskTemplatesVersion;
      void curatedTaskRecommendationSignalsVersion;
      void mentionEntryUsageVersion;
      void slashEntryUsageVersion;
      return buildInputCapabilitySections({
        mode,
        mentionQuery,
        builtinCommands,
        slashCommands,
        sceneCommands,
        mentionServiceSkills,
        serviceSkillGroups,
        filteredCharacters,
        installedSkills,
        availableSkills,
        projectId,
        sessionId,
        referenceEntries,
      });
    },
    [
      availableSkills,
      builtinCommands,
      curatedTaskTemplatesVersion,
      curatedTaskRecommendationSignalsVersion,
      filteredCharacters,
      installedSkills,
      mentionEntryUsageVersion,
      mentionQuery,
      mentionServiceSkills,
      mode,
      projectId,
      referenceEntries,
      sceneCommands,
      serviceSkillGroups,
      sessionId,
      slashEntryUsageVersion,
      slashCommands,
    ],
  );
  const hasFilteredResults = sections.some((section) => section.items.length > 0);
  const isEmptySlashQuery = mode === "slash" && mentionQuery.trim().length === 0;

  const resolveSectionTone = (sectionKey: string) => {
    if (sectionKey === "result-templates") {
      return "primary" as const;
    }

    if (sectionKey === "recent-slash-continuations") {
      return "continuation" as const;
    }

    if (sectionKey === "installed-skills") {
      return "methods" as const;
    }

    if (
      sectionKey === "supported-slash-commands:workspace-action" ||
      sectionKey === "recent-slash-operations"
    ) {
      return "supporting" as const;
    }

    return "default" as const;
  };

  const resolveSectionHelperText = (sectionKey: string): string | null => {
    if (!isEmptySlashQuery) {
      return null;
    }

    if (sectionKey === "supported-slash-commands:workspace-action") {
      return "整理当前任务时再用，不会替代上面的结果入口。";
    }

    if (sectionKey === "recent-slash-operations") {
      return "最近用过的工作台动作；如果是继续产出，优先看上面的做法。";
    }

    if (sectionKey === "recent-slash-continuations") {
      return "优先接着已经跑过的方法，通常比重新挑一条更省重来成本。";
    }

    if (sectionKey === "installed-skills") {
      return "更多本地做法；没命中上面的继续项时，再来这里挑一条新的。";
    }

    return null;
  };

  const shouldCompactSectionItems = (sectionKey: string): boolean =>
    isEmptySlashQuery && sectionKey === "supported-slash-commands:workspace-action";

  const shouldSubdueMethodItems = (sectionKey: string): boolean =>
    isEmptySlashQuery && sectionKey === "installed-skills";

  const shouldHighlightContinuationItems = (sectionKey: string): boolean =>
    isEmptySlashQuery && sectionKey === "recent-slash-continuations";

  const handleSelectCapability = (item: InputCapabilityDescriptor) => {
    switch (item.kind) {
      case "builtin_command":
        onSelectBuiltinCommand(item.command, { replayText: item.replayText });
        return;
      case "service_skill":
        onSelectServiceSkill(item.skill);
        return;
      case "slash_command":
        onSelectSlashCommand(item.command, { replayText: item.replayText });
        return;
      case "scene_command":
        onSelectSceneCommand(item.command, { replayText: item.replayText });
        return;
      case "curated_task":
        onSelectCuratedTask?.(item.task, {
          launchInputValues: item.launchInputValues,
          referenceMemoryIds: item.referenceMemoryIds,
          referenceEntries: item.referenceEntries,
          launcherPrefillHint: item.launcherPrefillHint,
        });
        return;
      case "character":
        onSelectCharacter(item.character);
        return;
      case "installed_skill":
        onSelectInstalledSkill(item.skill, { replayText: item.replayText });
        return;
      case "available_skill":
        onSelectAvailableSkill(item.skill);
        return;
      default:
        return;
    }
  };

  const renderItemIcon = (
    item: InputCapabilityDescriptor,
    sectionKey?: string,
  ) => {
    const iconClassName = cn(
      item.iconClassName,
      sectionKey && shouldSubdueMethodItems(sectionKey) && "text-slate-400",
    );

    switch (item.icon) {
      case "command":
        return <CommandIcon className={iconClassName} />;
      case "image-plus":
        return <ImagePlus className={iconClassName} />;
      case "sparkles":
        return <Sparkles className={iconClassName} />;
      case "user":
        return <User className={iconClassName} />;
      case "zap":
        return <Zap className={iconClassName} />;
      default:
        return null;
    }
  };

  return (
    <Command ref={commandRef} className="bg-background">
      <CommandInput
        placeholder={
          mode === "slash"
            ? "搜索结果模板、做法或操作..."
            : "搜索角色或技能..."
        }
        value={mentionQuery}
        onValueChange={onQueryChange}
      />
      <CommandList>
        {!hasFilteredResults ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            <div>
              {mode === "slash"
                ? "暂无可用结果模板、做法或操作"
                : "暂无可用角色或技能"}
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
        {sections.map((section) => (
          <CommandGroup
            key={section.key}
            heading={section.heading}
            className={cn(
              resolveSectionTone(section.key) === "supporting" &&
                isEmptySlashQuery &&
                "[&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-slate-400",
              resolveSectionTone(section.key) === "methods" &&
                isEmptySlashQuery &&
                "[&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-slate-500",
              resolveSectionTone(section.key) === "continuation" &&
                isEmptySlashQuery &&
                "[&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-emerald-700",
            )}
          >
            {section.banner ? (
              <div
                className="mx-2 mb-2 rounded-[16px] border border-sky-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(239,246,255,0.92))] px-3 py-3"
                data-testid={`input-capability-section-banner-${section.key}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    {section.banner.badge}
                  </span>
                  <div className="text-xs font-semibold leading-5 text-slate-900">
                    {section.banner.title}
                  </div>
                </div>
                <div className="mt-1.5 text-[11px] leading-5 text-slate-600">
                  {section.banner.summary}
                </div>
                {section.banner.footnote ? (
                  <div className="mt-1 text-[11px] leading-5 text-sky-700">
                    {section.banner.footnote}
                  </div>
                ) : null}
              </div>
            ) : null}
            {resolveSectionHelperText(section.key) ? (
              <div
                className="px-2 pb-1.5 text-[11px] leading-5 text-slate-400"
                data-testid={`input-capability-section-helper-${section.key}`}
              >
                {resolveSectionHelperText(section.key)}
              </div>
            ) : null}
            {section.items.map((item) => (
              <CommandItem
                key={item.key}
                onSelect={() => handleSelectCapability(item)}
                className={cn(
                  item.kind === "available_skill"
                    ? "cursor-pointer opacity-60"
                    : "cursor-pointer",
                  shouldCompactSectionItems(section.key) && "min-h-0 py-1.5",
                  shouldSubdueMethodItems(section.key) && "py-1.5",
                  isEmptySlashQuery &&
                    resolveSectionTone(section.key) === "primary" &&
                    "py-2",
                  shouldHighlightContinuationItems(section.key) &&
                    "rounded-md border border-emerald-100/80 bg-emerald-50/50",
                )}
              >
                {renderItemIcon(item, section.key)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "font-medium",
                        shouldCompactSectionItems(section.key) &&
                          "text-sm font-normal text-slate-700",
                        shouldSubdueMethodItems(section.key) &&
                          "text-sm font-normal text-slate-700",
                      )}
                    >
                      {item.title}
                    </div>
                    {item.kindLabel ? (
                      <span
                        className={cn(
                          "text-[10px] text-muted-foreground",
                          shouldCompactSectionItems(section.key) &&
                            "text-[10px] text-slate-400",
                          shouldSubdueMethodItems(section.key) &&
                            "text-[10px] text-slate-400",
                        )}
                      >
                        {item.kindLabel}
                      </span>
                    ) : null}
                  </div>
                  {!shouldCompactSectionItems(section.key) ? (
                    <div
                      className={cn(
                        "text-xs text-muted-foreground line-clamp-1",
                        isEmptySlashQuery &&
                          resolveSectionTone(section.key) === "primary" &&
                          "text-[11px] leading-5",
                        shouldSubdueMethodItems(section.key) &&
                          "text-[11px] leading-5 text-slate-500",
                      )}
                    >
                      {item.description}
                    </div>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
};
