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
  onSelectCapability: (item: InputCapabilityDescriptor) => void;
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
  onSelectCapability,
  onNavigateToSettings,
}) => {
  const sections = React.useMemo(() => {
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
  }, [
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
  ]);
  const hasFilteredResults = sections.some(
    (section) => section.items.length > 0,
  );
  const isEmptySlashQuery =
    mode === "slash" && mentionQuery.trim().length === 0;
  const isEmptyMentionQuery =
    mode === "mention" && mentionQuery.trim().length === 0;
  const isRegistryLanding = isEmptySlashQuery || isEmptyMentionQuery;

  const resolveSectionTone = (sectionKey: string) => {
    if (sectionKey === "result-templates") {
      return "primary" as const;
    }

    if (sectionKey === "recent-mention") {
      return "continuation" as const;
    }

    if (sectionKey === "recent-slash-continuations") {
      return "continuation" as const;
    }

    if (sectionKey.startsWith("builtin-commands:")) {
      return "primary" as const;
    }

    if (
      sectionKey === "featured-service-skills" ||
      sectionKey.startsWith("service-skill-group:") ||
      sectionKey === "characters"
    ) {
      return "supporting" as const;
    }

    if (
      sectionKey === "installed-skills" ||
      sectionKey === "available-skills"
    ) {
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
    if (isEmptyMentionQuery) {
      if (sectionKey === "recent-mention") {
        return "优先继续刚调过的命令或做法，仍然回到当前生成线程。";
      }

      if (sectionKey === "featured-service-skills") {
        return "需要一套现成起手时，再从这里进入，不替代上面的 @命令。";
      }

      if (sectionKey === "installed-skills") {
        return "自己的固定方法也能通过 @ 直接接回生成，但优先级仍在命令之后。";
      }

      if (sectionKey === "available-skills") {
        return "还没沉淀成固定入口的做法放在这里，优先级低于上面的命令和已沉淀方法。";
      }

      if (sectionKey === "characters") {
        return "需要点名协作对象时再用，不会替代上面的命令入口。";
      }
    }

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
      return "没命中上面的继续项时，再从这里换一条已经沉淀下来的方法。";
    }

    return null;
  };

  const shouldCompactSectionItems = (sectionKey: string): boolean =>
    isEmptySlashQuery &&
    sectionKey === "supported-slash-commands:workspace-action";

  const shouldSubdueMethodItems = (sectionKey: string): boolean =>
    (isEmptySlashQuery && sectionKey === "installed-skills") ||
    (isEmptyMentionQuery &&
      ([
        "featured-service-skills",
        "installed-skills",
        "available-skills",
        "characters",
      ].includes(sectionKey) ||
        sectionKey.startsWith("service-skill-group:")));

  const shouldHighlightContinuationItems = (sectionKey: string): boolean =>
    (isEmptySlashQuery && sectionKey === "recent-slash-continuations") ||
    (isEmptyMentionQuery && sectionKey === "recent-mention");

  const resolveVisibleKindLabel = (
    item: InputCapabilityDescriptor,
  ): string | null => {
    if (item.kind !== "slash_command") {
      return null;
    }

    const normalizedKindLabel = item.kindLabel?.trim();
    if (!normalizedKindLabel) {
      return null;
    }

    return normalizedKindLabel === item.title.trim()
      ? null
      : normalizedKindLabel;
  };

  const handleSelectCapability = (item: InputCapabilityDescriptor) => {
    onSelectCapability(item);
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
            : "搜索 @命令、做法或协作角色..."
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
                : "暂无可用 @命令、做法或协作角色"}
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
                isRegistryLanding &&
                "[&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-slate-400",
              resolveSectionTone(section.key) === "methods" &&
                isRegistryLanding &&
                "[&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-normal [&_[cmdk-group-heading]]:text-slate-500",
              resolveSectionTone(section.key) === "continuation" &&
                isRegistryLanding &&
                "[&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-emerald-700",
            )}
          >
            {section.banner ? (
              <div
                className="mx-2 mb-2 rounded-[16px] border border-sky-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(239,246,255,0.92))] px-3 py-3"
                data-testid={`input-capability-section-banner-${section.key}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {section.banner.badge ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          {section.banner.badge}
                        </span>
                      ) : null}
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
                  {section.banner.actionLabel &&
                  section.banner.actionItemKey ? (
                    <button
                      type="button"
                      className="rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-medium leading-5 text-slate-700 transition-colors hover:border-sky-300 hover:bg-sky-50"
                      data-testid={`input-capability-section-banner-action-${section.key}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        const actionItem = section.items.find(
                          (item) => item.key === section.banner?.actionItemKey,
                        );
                        if (actionItem) {
                          handleSelectCapability(actionItem);
                        }
                      }}
                    >
                      {section.banner.actionLabel}
                    </button>
                  ) : null}
                </div>
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
            {section.items.map((item) => {
              const visibleKindLabel = resolveVisibleKindLabel(item);

              return (
                <CommandItem
                  key={item.key}
                  onSelect={() => handleSelectCapability(item)}
                  className={cn(
                    item.kind === "available_skill"
                      ? "cursor-pointer opacity-60"
                      : "cursor-pointer",
                    shouldCompactSectionItems(section.key) && "min-h-0 py-1.5",
                    shouldSubdueMethodItems(section.key) && "py-1.5",
                    isRegistryLanding &&
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
                      {visibleKindLabel ? (
                        <span
                          className={cn(
                            "text-[10px] text-muted-foreground",
                            shouldCompactSectionItems(section.key) &&
                              "text-[10px] text-slate-400",
                            shouldSubdueMethodItems(section.key) &&
                              "text-[10px] text-slate-400",
                          )}
                        >
                          {visibleKindLabel}
                        </span>
                      ) : null}
                    </div>
                    {!shouldCompactSectionItems(section.key) ? (
                      <div
                        className={cn(
                          "text-xs text-muted-foreground line-clamp-1",
                          isRegistryLanding &&
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
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
};
