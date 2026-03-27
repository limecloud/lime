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
import type { CodexSlashCommandDefinition } from "../../../commands";
import type { BuiltinInputCommand } from "./builtinCommands";

interface CharacterMentionPanelProps {
  mode: "mention" | "slash";
  mentionQuery: string;
  builtinCommands: BuiltinInputCommand[];
  slashCommands: CodexSlashCommandDefinition[];
  mentionServiceSkills: ServiceSkillHomeItem[];
  filteredCharacters: Character[];
  installedSkills: Skill[];
  availableSkills: Skill[];
  commandRef: React.RefObject<HTMLDivElement>;
  onQueryChange: (query: string) => void;
  onSelectBuiltinCommand: (command: BuiltinInputCommand) => void;
  onSelectServiceSkill: (skill: ServiceSkillHomeItem) => void;
  onSelectSlashCommand: (command: CodexSlashCommandDefinition) => void;
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
  mentionServiceSkills,
  filteredCharacters,
  installedSkills,
  availableSkills,
  commandRef,
  onQueryChange,
  onSelectBuiltinCommand,
  onSelectServiceSkill,
  onSelectSlashCommand,
  onSelectCharacter,
  onSelectInstalledSkill,
  onSelectAvailableSkill,
  onNavigateToSettings,
}) => {
  const visibleBuiltinCommands = mode === "mention" ? builtinCommands : [];
  const visibleServiceSkills = mode === "mention" ? mentionServiceSkills : [];
  const visibleCharacters = mode === "mention" ? filteredCharacters : [];
  const visibleSlashCommands = mode === "slash" ? slashCommands : [];
  const hasFilteredResults =
    visibleSlashCommands.length > 0 ||
    visibleBuiltinCommands.length > 0 ||
    visibleServiceSkills.length > 0 ||
    visibleCharacters.length > 0 ||
    installedSkills.length > 0 ||
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
                去技能设置
              </button>
            ) : null}
          </div>
        ) : null}
        {visibleSlashCommands.length > 0 ? (
          <CommandGroup heading="Codex 命令">
            {visibleSlashCommands.map((command) => (
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
        {visibleServiceSkills.length > 0 ? (
          <CommandGroup heading="服务技能">
            {visibleServiceSkills.map((skill) => (
              <CommandItem
                key={skill.id}
                onSelect={() => onSelectServiceSkill(skill)}
                className="cursor-pointer"
              >
                <Sparkles className="mr-2 h-4 w-4 text-emerald-600" />
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
        {installedSkills.length > 0 ? (
          <CommandGroup heading="已安装技能">
            {installedSkills.map((skill) => (
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
