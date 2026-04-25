import {
  getSeededSkillCatalog,
  listSkillCatalogCommandEntries,
  listSkillCatalogSceneEntries,
  type SkillCatalog,
  type SkillCatalogCommandEntry,
  type SkillCatalogSceneEntry,
} from "@/lib/api/skillCatalog";

export interface BuiltinInputCommand {
  key: string;
  label: string;
  mentionLabel: string;
  commandPrefix: string;
  description: string;
  aliases: string[];
  entryId?: string;
}

export interface RuntimeSceneSlashCommand {
  key: string;
  label: string;
  commandPrefix: string;
  description: string;
  aliases: string[];
  entryId?: string;
  linkedSkillId?: string;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function collectBuiltinCommandHaystacks(
  command: BuiltinInputCommand,
): string[] {
  return [
    command.label,
    command.mentionLabel,
    command.commandPrefix,
    command.description,
    ...command.aliases,
  ];
}

function collectSceneCommandHaystacks(
  command: RuntimeSceneSlashCommand,
): string[] {
  return [
    command.label,
    command.commandPrefix,
    command.description,
    ...command.aliases,
  ];
}

function resolveMentionTriggerPrefix(
  entry: SkillCatalogCommandEntry,
): string | null {
  const mentionTrigger = entry.triggers.find(
    (trigger) => trigger.mode === "mention",
  );
  return mentionTrigger?.prefix?.trim() || null;
}

function toBuiltinInputCommand(
  entry: SkillCatalogCommandEntry,
): BuiltinInputCommand | null {
  const commandPrefix = resolveMentionTriggerPrefix(entry);
  if (!commandPrefix) {
    return null;
  }

  return {
    key: entry.commandKey,
    label: entry.title,
    mentionLabel: entry.title,
    commandPrefix,
    description: entry.summary,
    aliases: entry.aliases ?? [],
    entryId: entry.id,
  };
}

function toRuntimeSceneSlashCommand(
  entry: SkillCatalogSceneEntry,
): RuntimeSceneSlashCommand | null {
  const commandPrefix = entry.commandPrefix.trim();
  if (!commandPrefix.startsWith("/")) {
    return null;
  }

  return {
    key: entry.sceneKey,
    label: entry.title,
    commandPrefix,
    description: entry.summary,
    aliases: entry.aliases ?? [],
    entryId: entry.id,
    linkedSkillId: entry.linkedSkillId,
  };
}

export function listBuiltinCommandsFromSkillCatalog(
  catalog: SkillCatalog,
): BuiltinInputCommand[] {
  return listSkillCatalogCommandEntries(catalog)
    .map((entry) => toBuiltinInputCommand(entry))
    .filter((entry): entry is BuiltinInputCommand => Boolean(entry));
}

export function listRuntimeSceneSlashCommandsFromSkillCatalog(
  catalog: SkillCatalog,
): RuntimeSceneSlashCommand[] {
  return listSkillCatalogSceneEntries(catalog)
    .map((entry) => toRuntimeSceneSlashCommand(entry))
    .filter((entry): entry is RuntimeSceneSlashCommand => Boolean(entry));
}

export const INPUTBAR_BUILTIN_COMMANDS: BuiltinInputCommand[] =
  listBuiltinCommandsFromSkillCatalog(getSeededSkillCatalog());

export function filterBuiltinCommands(
  query: string,
  commands: BuiltinInputCommand[] = INPUTBAR_BUILTIN_COMMANDS,
): BuiltinInputCommand[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter((command) =>
    collectBuiltinCommandHaystacks(command).some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function filterRuntimeSceneSlashCommands(
  query: string,
  commands: RuntimeSceneSlashCommand[],
): RuntimeSceneSlashCommand[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter((command) =>
    collectSceneCommandHaystacks(command).some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}
