import type { Skill } from "@/lib/api/skills";
import {
  findCuratedTaskTemplateById,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "../utils/curatedTaskTemplates";
import {
  buildCuratedTaskLaunchRequestMetadata,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceEntry,
} from "../utils/curatedTaskReferenceSelection";
import type {
  BuiltinInputCommand,
  RuntimeSceneSlashCommand,
} from "./builtinCommands";
import { INPUTBAR_BUILTIN_COMMANDS } from "./builtinCommands";

export type InputCapabilitySelection =
  | {
      kind: "builtin_command";
      command: BuiltinInputCommand;
    }
  | {
      kind: "installed_skill";
      skill: Skill;
    }
  | {
      kind: "runtime_scene";
      command: RuntimeSceneSlashCommand;
    }
  | {
      kind: "curated_task";
      task: CuratedTaskTemplateItem;
      launchInputValues?: CuratedTaskInputValues;
      referenceMemoryIds?: string[];
      referenceEntries?: CuratedTaskReferenceEntry[];
    };

export interface InputCapabilityActivationOptions {
  replayText?: string;
}

export type SelectInputCapabilityHandler = (
  capability: InputCapabilitySelection,
  options?: InputCapabilityActivationOptions,
) => void;

export type InputCapabilitySendRoute =
  | {
      kind: "builtin_command";
      commandKey: string;
      commandPrefix: string;
    }
  | {
      kind: "installed_skill";
      skillKey: string;
      skillName: string;
    }
  | {
      kind: "runtime_scene";
      sceneKey: string;
      commandPrefix: string;
    }
  | {
      kind: "curated_task";
      taskId: string;
      taskTitle: string;
      prompt: string;
      launchInputValues?: CuratedTaskInputValues;
      referenceMemoryIds?: string[];
      referenceEntries?: CuratedTaskReferenceEntry[];
    };

export interface ResolvedInputCapabilityDispatch {
  displayContent?: string;
  capabilityRoute?: InputCapabilitySendRoute;
  requestMetadata?: Record<string, unknown>;
}

export function resolveInputCapabilitySendRoute(
  capability: InputCapabilitySelection | null,
): InputCapabilitySendRoute | undefined {
  if (!capability) {
    return undefined;
  }

  switch (capability.kind) {
    case "builtin_command":
      return {
        kind: "builtin_command",
        commandKey: capability.command.key,
        commandPrefix: capability.command.commandPrefix,
      };
    case "installed_skill":
      return {
        kind: "installed_skill",
        skillKey: capability.skill.key,
        skillName: capability.skill.name,
      };
    case "runtime_scene":
      return {
        kind: "runtime_scene",
        sceneKey: capability.command.key,
        commandPrefix: capability.command.commandPrefix,
      };
    case "curated_task": {
      const normalizedReferenceEntries = mergeCuratedTaskReferenceEntries(
        capability.referenceEntries ?? [],
      ).slice(0, 3);
      return {
        kind: "curated_task",
        taskId: capability.task.id,
        taskTitle: capability.task.title,
        prompt: capability.task.prompt,
        ...(capability.launchInputValues
          ? {
              launchInputValues: capability.launchInputValues,
            }
          : {}),
        ...(normalizeCuratedTaskReferenceMemoryIds(
          capability.referenceMemoryIds,
        )
          ? {
              referenceMemoryIds: normalizeCuratedTaskReferenceMemoryIds(
                capability.referenceMemoryIds,
              ),
            }
          : {}),
        ...(normalizedReferenceEntries.length > 0
          ? {
              referenceEntries: normalizedReferenceEntries,
            }
          : {}),
      };
    }
    default:
      return undefined;
  }
}

function createFallbackInstalledSkill(
  route: Extract<InputCapabilitySendRoute, { kind: "installed_skill" }>,
): Skill {
  return {
    key: route.skillKey,
    name: route.skillName || route.skillKey,
    description: "",
    directory: route.skillKey,
    installed: true,
    sourceKind: "other",
  };
}

function createFallbackBuiltinCommand(
  route: Extract<InputCapabilitySendRoute, { kind: "builtin_command" }>,
): BuiltinInputCommand {
  return {
    key: route.commandKey,
    label: route.commandKey,
    mentionLabel: route.commandKey,
    commandPrefix: route.commandPrefix,
    description: "",
    aliases: [],
  };
}

function createFallbackRuntimeSceneCommand(
  route: Extract<InputCapabilitySendRoute, { kind: "runtime_scene" }>,
): RuntimeSceneSlashCommand {
  return {
    key: route.sceneKey,
    label: route.sceneKey,
    commandPrefix: route.commandPrefix,
    description: "",
    aliases: [],
  };
}

function createFallbackCuratedTask(
  route: Extract<InputCapabilitySendRoute, { kind: "curated_task" }>,
): CuratedTaskTemplateItem {
  return {
    id: route.taskId,
    title: route.taskTitle || route.taskId,
    summary: "",
    outputHint: "",
    categoryLabel: "结果模板",
    prompt: route.prompt,
    requiredInputs: [],
    requiredInputFields: [],
    optionalReferences: [],
    outputContract: [],
    followUpActions: [],
    badge: "结果模板",
    actionLabel: "进入生成",
    statusLabel: "可直接开始",
    statusTone: "emerald",
    recentUsedAt: null,
    isRecent: false,
  };
}

export function resolveInputCapabilitySelectionFromRoute(params: {
  route: InputCapabilitySendRoute;
  skills?: Skill[];
  builtinCommands?: BuiltinInputCommand[];
  runtimeSceneCommands?: RuntimeSceneSlashCommand[];
}): InputCapabilitySelection {
  const {
    route,
    skills = [],
    builtinCommands = INPUTBAR_BUILTIN_COMMANDS,
    runtimeSceneCommands = [],
  } = params;

  if (route.kind === "builtin_command") {
    const command =
      builtinCommands.find(
        (item) =>
          item.key === route.commandKey ||
          item.commandPrefix === route.commandPrefix,
      ) ?? createFallbackBuiltinCommand(route);
    return {
      kind: "builtin_command",
      command,
    };
  }

  if (route.kind === "installed_skill") {
    const skill =
      skills.find((item) => item.key === route.skillKey) ??
      createFallbackInstalledSkill(route);
    return {
      kind: "installed_skill",
      skill,
    };
  }

  if (route.kind === "curated_task") {
    const taskTemplate =
      findCuratedTaskTemplateById(route.taskId) ??
      createFallbackCuratedTask(route);
    return {
      kind: "curated_task",
      task: {
        ...taskTemplate,
        prompt: route.prompt,
      },
      launchInputValues: route.launchInputValues,
      referenceMemoryIds: route.referenceMemoryIds,
      referenceEntries: route.referenceEntries,
    };
  }

  const command =
    runtimeSceneCommands.find(
      (item) =>
        item.key === route.sceneKey ||
        item.commandPrefix === route.commandPrefix,
    ) ?? createFallbackRuntimeSceneCommand(route);
  return {
    kind: "runtime_scene",
    command,
  };
}

export function resolveInputCapabilityDispatch(
  capability: InputCapabilitySelection | null,
  input: string,
): ResolvedInputCapabilityDispatch {
  const capabilityRoute = resolveInputCapabilitySendRoute(capability);
  const displayContent = capability && input.trim() ? input : undefined;
  const requestMetadata =
    capability?.kind === "curated_task"
      ? buildCuratedTaskLaunchRequestMetadata({
          taskId: capability.task.id,
          taskTitle: capability.task.title,
          inputValues: capability.launchInputValues,
          referenceMemoryIds: capability.referenceMemoryIds,
          referenceEntries: capability.referenceEntries,
        })
      : undefined;

  return {
    displayContent,
    capabilityRoute,
    requestMetadata,
  };
}
