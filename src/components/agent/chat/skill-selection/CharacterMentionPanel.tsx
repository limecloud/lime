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
import type {
  ServiceSkillGroup,
  ServiceSkillHomeItem,
} from "@/components/agent/chat/service-skills/types";
import type { CodexSlashCommandDefinition } from "../commands";
import type {
  BuiltinInputCommand,
  RuntimeSceneSlashCommand,
} from "./builtinCommands";
import type { CuratedTaskTemplateItem } from "../utils/curatedTaskTemplates";
import {
  buildInputCapabilitySections,
  type InputCapabilityDescriptor,
} from "./inputCapabilitySections";

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
  onSelectCuratedTask?: (task: CuratedTaskTemplateItem) => void;
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
    () =>
      buildInputCapabilitySections({
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
      }),
    [
      availableSkills,
      builtinCommands,
      filteredCharacters,
      installedSkills,
      mentionQuery,
      mentionServiceSkills,
      mode,
      sceneCommands,
      serviceSkillGroups,
      slashCommands,
    ],
  );
  const hasFilteredResults = sections.some((section) => section.items.length > 0);

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
        onSelectCuratedTask?.(item.task);
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

  const renderItemIcon = (item: InputCapabilityDescriptor) => {
    switch (item.icon) {
      case "command":
        return <CommandIcon className={item.iconClassName} />;
      case "image-plus":
        return <ImagePlus className={item.iconClassName} />;
      case "sparkles":
        return <Sparkles className={item.iconClassName} />;
      case "user":
        return <User className={item.iconClassName} />;
      case "zap":
        return <Zap className={item.iconClassName} />;
      default:
        return null;
    }
  };

  return (
    <Command ref={commandRef} className="bg-background">
      <CommandInput
        placeholder={
          mode === "slash"
            ? "搜索命令、结果模板或技能..."
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
                ? "暂无可用命令、结果模板或技能"
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
          <CommandGroup key={section.key} heading={section.heading}>
            {section.items.map((item) => (
              <CommandItem
                key={item.key}
                onSelect={() => handleSelectCapability(item)}
                className={
                  item.kind === "available_skill"
                    ? "cursor-pointer opacity-60"
                    : "cursor-pointer"
                }
              >
                {renderItemIcon(item)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{item.title}</div>
                    {item.kindLabel ? (
                      <span className="text-[10px] text-muted-foreground">
                        {item.kindLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {item.description}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
};
