export interface MemorySourcesConfig {
  managed_policy_path?: string | null;
  project_memory_paths?: string[];
  project_rule_dirs?: string[];
  user_memory_path?: string | null;
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

export type MemoryEmbeddingProvider =
  | "auto"
  | "local_onnx"
  | "builtin"
  | "openai_api"
  | "provider"
  | "disabled";

export interface MemoryEmbeddingConfig {
  provider?: MemoryEmbeddingProvider;
  provider_id?: string | null;
  model?: string | null;
}

export interface MemoryConfig {
  enabled: boolean;
  disable_on_external_context?: boolean;
  max_entries?: number;
  retention_days?: number;
  auto_cleanup?: boolean;
  sources?: MemorySourcesConfig;
  auto?: MemoryAutoConfig;
  resolve?: MemoryResolveConfig;
  embedding?: MemoryEmbeddingConfig;
}
