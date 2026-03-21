import { safeInvoke } from "@/lib/dev-bridge";
import type {
  AutoMemoryIndexResponse,
  CleanupMemoryResult,
  EffectiveMemorySourcesResponse,
  MemoryAnalysisResult,
  MemoryAutoToggleResponse,
  MemoryStatsResponse,
  MemoryOverviewResponse,
  RuntimeAgentsTemplateScaffoldResult,
  RuntimeAgentsTemplateTarget,
  WorkspaceGitignoreEnsureResult,
} from "./memoryRuntimeTypes";

export type {
  AutoMemoryIndexResponse,
  AutoMemoryIndexItem,
  CleanupMemoryResult,
  EffectiveMemorySourcesResponse,
  EffectiveMemorySource,
  MemoryAnalysisResult,
  MemoryAutoConfig,
  MemoryAutoToggleResponse,
  MemoryCategoryStat,
  MemoryConfig,
  MemoryEntryPreview,
  MemoryOverviewResponse,
  MemoryProfileConfig,
  MemoryResolveConfig,
  MemorySourcesConfig,
  MemoryStatsResponse,
  RuntimeAgentsTemplateScaffoldResult,
  RuntimeAgentsTemplateScaffoldStatus,
  RuntimeAgentsTemplateTarget,
  WorkspaceGitignoreEnsureResult,
  WorkspaceGitignoreEnsureStatus,
} from "./memoryRuntimeTypes";

export async function getContextMemoryOverview(
  limit?: number,
): Promise<MemoryOverviewResponse> {
  return safeInvoke("memory_runtime_get_overview", { limit });
}

export async function getContextMemoryStats(): Promise<MemoryStatsResponse> {
  return safeInvoke("memory_runtime_get_stats");
}

export async function analyzeContextMemory(
  fromTimestamp?: number,
  toTimestamp?: number,
): Promise<MemoryAnalysisResult> {
  return safeInvoke("memory_runtime_request_analysis", {
    fromTimestamp,
    toTimestamp,
  });
}

export async function cleanupContextMemory(): Promise<CleanupMemoryResult> {
  return safeInvoke("memory_runtime_cleanup");
}

export async function getContextMemoryEffectiveSources(
  workingDir?: string,
  activeRelativePath?: string,
): Promise<EffectiveMemorySourcesResponse> {
  return safeInvoke("memory_get_effective_sources", {
    workingDir,
    activeRelativePath,
  });
}

export async function getContextMemoryAutoIndex(
  workingDir?: string,
): Promise<AutoMemoryIndexResponse> {
  return safeInvoke("memory_get_auto_index", { workingDir });
}

export async function toggleContextMemoryAuto(
  enabled: boolean,
): Promise<MemoryAutoToggleResponse> {
  return safeInvoke("memory_toggle_auto", { enabled });
}

export async function updateContextMemoryAutoNote(
  note: string,
  topic?: string,
  workingDir?: string,
): Promise<AutoMemoryIndexResponse> {
  return safeInvoke("memory_update_auto_note", { note, topic, workingDir });
}

export async function scaffoldRuntimeAgentsTemplate(
  target: RuntimeAgentsTemplateTarget,
  workingDir?: string,
  overwrite?: boolean,
): Promise<RuntimeAgentsTemplateScaffoldResult> {
  return safeInvoke("memory_scaffold_runtime_agents_template", {
    target,
    workingDir,
    overwrite,
  });
}

export async function ensureWorkspaceLocalAgentsGitignore(
  workingDir?: string,
): Promise<WorkspaceGitignoreEnsureResult> {
  return safeInvoke("memory_ensure_workspace_local_agents_gitignore", {
    workingDir,
  });
}
