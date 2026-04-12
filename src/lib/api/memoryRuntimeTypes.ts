export interface MemoryProfileConfig {
  current_status?: string;
  strengths?: string[];
  explanation_style?: string[];
  challenge_preference?: string[];
}

export interface MemorySourcesConfig {
  managed_policy_path?: string | null;
  project_memory_paths?: string[];
  project_rule_dirs?: string[];
  user_memory_path?: string | null;
  project_local_memory_path?: string | null;
}

export interface MemoryAutoConfig {
  enabled?: boolean;
  entrypoint?: string;
  max_loaded_lines?: number;
  root_dir?: string | null;
}

export interface MemoryResolveConfig {
  additional_dirs?: string[];
  follow_imports?: boolean;
  import_max_depth?: number;
  load_additional_dirs_memory?: boolean;
}

export interface MemoryConfig {
  enabled: boolean;
  max_entries?: number;
  retention_days?: number;
  auto_cleanup?: boolean;
  profile?: MemoryProfileConfig;
  sources?: MemorySourcesConfig;
  auto?: MemoryAutoConfig;
  resolve?: MemoryResolveConfig;
}

export interface MemoryStatsResponse {
  total_entries: number;
  storage_used: number;
  memory_count: number;
}

export interface MemoryCategoryStat {
  category: "identity" | "context" | "preference" | "experience" | "activity";
  count: number;
}

export interface MemoryEntryPreview {
  id: string;
  session_id: string;
  file_type: string;
  category: "identity" | "context" | "preference" | "experience" | "activity";
  title: string;
  summary: string;
  updated_at: number;
  tags: string[];
}

export interface MemoryOverviewResponse {
  stats: MemoryStatsResponse;
  categories: MemoryCategoryStat[];
  entries: MemoryEntryPreview[];
}

export interface CleanupMemoryResult {
  cleaned_entries: number;
  freed_space: number;
}

export interface MemoryAnalysisResult {
  analyzed_sessions: number;
  analyzed_messages: number;
  generated_entries: number;
  deduplicated_entries: number;
}

export interface EffectiveMemorySource {
  kind: string;
  path: string;
  exists: boolean;
  loaded: boolean;
  line_count: number;
  import_count: number;
  warnings: string[];
  preview?: string | null;
}

export interface EffectiveMemorySourcesResponse {
  working_dir: string;
  total_sources: number;
  loaded_sources: number;
  follow_imports: boolean;
  import_max_depth: number;
  sources: EffectiveMemorySource[];
}

export interface AutoMemoryIndexItem {
  title: string;
  relative_path: string;
  exists: boolean;
  summary?: string | null;
}

export interface AutoMemoryIndexResponse {
  enabled: boolean;
  root_dir: string;
  entrypoint: string;
  max_loaded_lines: number;
  entry_exists: boolean;
  total_lines: number;
  preview_lines: string[];
  items: AutoMemoryIndexItem[];
}

export interface MemoryAutoToggleResponse {
  enabled: boolean;
}

export interface WorkingMemoryFileSummary {
  file_type: string;
  path: string;
  exists: boolean;
  entry_count: number;
  updated_at: number;
  summary: string;
}

export interface WorkingMemorySessionSummary {
  session_id: string;
  total_entries: number;
  updated_at: number;
  files: WorkingMemoryFileSummary[];
  highlights: MemoryEntryPreview[];
}

export interface WorkingMemoryView {
  memory_dir: string;
  total_sessions: number;
  total_entries: number;
  sessions: WorkingMemorySessionSummary[];
}

export interface CompactionBoundarySnapshot {
  session_id: string;
  source: string;
  summary_preview: string;
  turn_count?: number;
  created_at: number;
  trigger?: string;
  detail?: string;
}

export interface MemoryExtractionStatusResponse {
  enabled: boolean;
  status: "disabled" | "idle" | "collecting" | "ready" | string;
  status_summary: string;
  working_session_count: number;
  working_entry_count: number;
  latest_working_memory_at?: number;
  latest_compaction?: CompactionBoundarySnapshot | null;
  recent_compactions: CompactionBoundarySnapshot[];
}

export interface DurableMemoryRecallEntry {
  id: string;
  session_id: string;
  category: string;
  title: string;
  summary: string;
  updated_at: number;
  tags: string[];
}

export interface TeamMemoryShadowEntry {
  key: string;
  content: string;
  updated_at?: number;
}

export interface TurnMemoryPrefetchRequest {
  session_id: string;
  working_dir?: string;
  user_message?: string;
  request_metadata?: Record<string, unknown>;
  max_durable_entries?: number;
  max_working_chars?: number;
}

export interface TurnMemoryPrefetchResult {
  session_id: string;
  rules_source_paths: string[];
  working_memory_excerpt?: string | null;
  durable_memories: DurableMemoryRecallEntry[];
  team_memory_entries: TeamMemoryShadowEntry[];
  latest_compaction?: CompactionBoundarySnapshot | null;
  prompt?: string | null;
}

export type RuntimeAgentsTemplateTarget =
  | "global"
  | "workspace"
  | "workspace_local";

export type RuntimeAgentsTemplateScaffoldStatus =
  | "created"
  | "exists"
  | "overwritten";

export interface RuntimeAgentsTemplateScaffoldResult {
  target: RuntimeAgentsTemplateTarget;
  path: string;
  status: RuntimeAgentsTemplateScaffoldStatus;
  createdParentDir: boolean;
}

export type WorkspaceGitignoreEnsureStatus = "created" | "added" | "exists";

export interface WorkspaceGitignoreEnsureResult {
  path: string;
  entry: string;
  status: WorkspaceGitignoreEnsureStatus;
}
