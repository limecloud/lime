import type { AgentRuntimeToolInventory } from "@/lib/api/agentRuntime";

const WEB_SEARCH_TOOL_NAMES = ["WebSearch", "web_search"] as const;
const SUBAGENT_CORE_TOOL_NAMES = ["Agent", "SendMessage"] as const;
const SUBAGENT_TEAM_TOOL_NAMES = [
  "TeamCreate",
  "TeamDelete",
  "ListPeers",
] as const;
const TASK_TOOL_NAMES = [
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TaskOutput",
  "TaskStop",
] as const;

type RuntimeToolAvailabilitySource =
  | "runtime_tools"
  | "registry_tools"
  | "none";

export const RUNTIME_TOOL_AVAILABILITY_OVERRIDE_STORAGE_KEY =
  "lime:debug:runtime-tool-availability:v1";

export interface RuntimeToolAvailability {
  source: RuntimeToolAvailabilitySource;
  known: boolean;
  agentInitialized: boolean;
  availableToolCount: number;
  webSearch: boolean;
  subagentCore: boolean;
  subagentTeamTools: boolean;
  subagentRuntime: boolean;
  taskRuntime: boolean;
  missingSubagentCoreTools: string[];
  missingSubagentTeamTools: string[];
  missingTaskTools: string[];
}

function isRuntimeToolAvailabilitySource(
  value: unknown,
): value is RuntimeToolAvailabilitySource {
  return (
    value === "runtime_tools" || value === "registry_tools" || value === "none"
  );
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRuntimeToolAvailabilityOverride(): Partial<RuntimeToolAvailability> | null {
  if (
    !import.meta.env.DEV ||
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return null;
  }

  const raw = window.localStorage.getItem(
    RUNTIME_TOOL_AVAILABILITY_OVERRIDE_STORAGE_KEY,
  );
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const override: Partial<RuntimeToolAvailability> = {};

    if (isRuntimeToolAvailabilitySource(parsed.source)) {
      override.source = parsed.source;
    }
    if (typeof parsed.known === "boolean") {
      override.known = parsed.known;
    }
    if (typeof parsed.agentInitialized === "boolean") {
      override.agentInitialized = parsed.agentInitialized;
    }
    if (
      typeof parsed.availableToolCount === "number" &&
      Number.isFinite(parsed.availableToolCount)
    ) {
      override.availableToolCount = parsed.availableToolCount;
    }
    if (typeof parsed.webSearch === "boolean") {
      override.webSearch = parsed.webSearch;
    }
    if (typeof parsed.subagentCore === "boolean") {
      override.subagentCore = parsed.subagentCore;
    }
    if (typeof parsed.subagentTeamTools === "boolean") {
      override.subagentTeamTools = parsed.subagentTeamTools;
    }
    if (typeof parsed.subagentRuntime === "boolean") {
      override.subagentRuntime = parsed.subagentRuntime;
    }
    if (typeof parsed.taskRuntime === "boolean") {
      override.taskRuntime = parsed.taskRuntime;
    }

    const missingSubagentCoreTools = normalizeStringList(
      parsed.missingSubagentCoreTools,
    );
    if (missingSubagentCoreTools) {
      override.missingSubagentCoreTools = missingSubagentCoreTools;
    }

    const missingSubagentTeamTools = normalizeStringList(
      parsed.missingSubagentTeamTools,
    );
    if (missingSubagentTeamTools) {
      override.missingSubagentTeamTools = missingSubagentTeamTools;
    }

    const missingTaskTools = normalizeStringList(parsed.missingTaskTools);
    if (missingTaskTools) {
      override.missingTaskTools = missingTaskTools;
    }

    return Object.keys(override).length > 0 ? override : null;
  } catch {
    return null;
  }
}

function applyRuntimeToolAvailabilityOverride(
  base: RuntimeToolAvailability,
): RuntimeToolAvailability {
  const override = readRuntimeToolAvailabilityOverride();
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    missingSubagentCoreTools:
      override.missingSubagentCoreTools ?? base.missingSubagentCoreTools,
    missingSubagentTeamTools:
      override.missingSubagentTeamTools ?? base.missingSubagentTeamTools,
    missingTaskTools: override.missingTaskTools ?? base.missingTaskTools,
  };
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function collectRuntimeToolNames(
  toolInventory?: AgentRuntimeToolInventory | null,
): {
  source: RuntimeToolAvailabilitySource;
  toolNames: Set<string>;
} {
  const runtimeTools = toolInventory?.runtime_tools || [];
  if (runtimeTools.length > 0) {
    return {
      source: "runtime_tools",
      toolNames: new Set(
        runtimeTools.map((entry) => normalizeToolName(entry.name)),
      ),
    };
  }

  const registryTools = toolInventory?.registry_tools || [];
  if (registryTools.length > 0) {
    return {
      source: "registry_tools",
      toolNames: new Set(
        registryTools.map((entry) => normalizeToolName(entry.name)),
      ),
    };
  }

  return {
    source: "none",
    toolNames: new Set<string>(),
  };
}

function missingToolNames(
  toolNames: Set<string>,
  expectedNames: readonly string[],
): string[] {
  return expectedNames.filter(
    (toolName) => !toolNames.has(normalizeToolName(toolName)),
  );
}

export function deriveRuntimeToolAvailability(
  toolInventory?: AgentRuntimeToolInventory | null,
): RuntimeToolAvailability {
  const { source, toolNames } = collectRuntimeToolNames(toolInventory);
  const missingSubagentCoreTools = missingToolNames(
    toolNames,
    SUBAGENT_CORE_TOOL_NAMES,
  );
  const missingSubagentTeamTools = missingToolNames(
    toolNames,
    SUBAGENT_TEAM_TOOL_NAMES,
  );
  const missingTaskTools = missingToolNames(toolNames, TASK_TOOL_NAMES);
  const webSearch =
    missingToolNames(toolNames, WEB_SEARCH_TOOL_NAMES).length <
    WEB_SEARCH_TOOL_NAMES.length;
  const subagentCore = missingSubagentCoreTools.length === 0;
  const subagentTeamTools = missingSubagentTeamTools.length === 0;
  const taskRuntime = missingTaskTools.length === 0;
  const agentInitialized = Boolean(toolInventory?.agent_initialized);

  return applyRuntimeToolAvailabilityOverride({
    source,
    known: agentInitialized && source !== "none",
    agentInitialized,
    availableToolCount: toolNames.size,
    webSearch,
    subagentCore,
    subagentTeamTools,
    subagentRuntime: subagentCore && subagentTeamTools,
    taskRuntime,
    missingSubagentCoreTools,
    missingSubagentTeamTools,
    missingTaskTools,
  });
}
