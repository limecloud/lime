import { safeInvoke } from "@/lib/dev-bridge";
import type {
  AutoMemoryIndexResponse,
  CleanupMemoryResult,
  EffectiveMemorySourcesResponse,
  MemoryExtractionStatusResponse,
  MemoryAnalysisResult,
  MemoryAutoToggleResponse,
  MemdirCleanupResult,
  MemdirScaffoldResult,
  MemdirMemoryType,
  MemoryStatsResponse,
  MemoryOverviewResponse,
  RuntimeAgentsTemplateScaffoldResult,
  RuntimeAgentsTemplateTarget,
  TurnMemoryPrefetchRequest,
  TurnMemoryPrefetchResult,
  WorkingMemoryView,
  WorkspaceGitignoreEnsureResult,
} from "./memoryRuntimeTypes";

export type {
  AutoMemoryIndexResponse,
  AutoMemoryIndexItem,
  CleanupMemoryResult,
  CompactionBoundarySnapshot,
  DurableMemoryRecallEntry,
  EffectiveMemorySourcesResponse,
  EffectiveMemorySource,
  MemoryExtractionStatusResponse,
  MemoryAnalysisResult,
  MemoryAutoConfig,
  MemoryAutoToggleResponse,
  MemdirScaffoldFile,
  MemdirCleanupResult,
  MemdirScaffoldResult,
  MemdirMemoryType,
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
  TeamMemoryShadowEntry,
  TurnMemoryPrefetchRequest,
  TurnMemoryPrefetchResult,
  WorkingMemoryFileSummary,
  WorkingMemorySessionSummary,
  WorkingMemoryView,
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

export async function getContextWorkingMemory(
  sessionId?: string,
  limit?: number,
): Promise<WorkingMemoryView> {
  return safeInvoke("memory_runtime_get_working_memory", {
    sessionId,
    limit,
  });
}

export async function getContextMemoryExtractionStatus(): Promise<MemoryExtractionStatusResponse> {
  return safeInvoke("memory_runtime_get_extraction_status");
}

export async function prefetchContextMemoryForTurn(
  request: TurnMemoryPrefetchRequest,
): Promise<TurnMemoryPrefetchResult> {
  return safeInvoke("memory_runtime_prefetch_for_turn", {
    request,
  });
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
  memoryType?: MemdirMemoryType,
): Promise<AutoMemoryIndexResponse> {
  return safeInvoke("memory_update_auto_note", {
    note,
    topic,
    workingDir,
    memoryType,
  });
}

export async function cleanupContextMemdir(
  workingDir?: string,
): Promise<MemdirCleanupResult> {
  return safeInvoke("memory_cleanup_memdir", { workingDir });
}

export async function scaffoldContextMemdir(
  workingDir?: string,
  overwrite?: boolean,
): Promise<MemdirScaffoldResult> {
  return safeInvoke("memory_scaffold_memdir", { workingDir, overwrite });
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
