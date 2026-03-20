export interface AmpModelMapping {
  from: string;
  to: string;
}

export interface AmpConfig {
  upstream_url: string | null;
  model_mappings: AmpModelMapping[];
  restrict_management_to_localhost: boolean;
}

export interface GeminiApiKeyEntry {
  id: string;
  api_key: string;
  base_url: string | null;
  proxy_url: string | null;
  excluded_models: string[];
  disabled: boolean;
}

export interface VertexModelAlias {
  name: string;
  alias: string;
}

export interface VertexApiKeyEntry {
  id: string;
  api_key: string;
  base_url: string | null;
  models: VertexModelAlias[];
  proxy_url: string | null;
  disabled: boolean;
}

export interface IFlowCredentialEntry {
  id: string;
  token_file: string | null;
  auth_type: string;
  cookies: string | null;
  proxy_url: string | null;
  disabled: boolean;
}

export interface CredentialEntry {
  id: string;
  token_file: string;
  disabled: boolean;
  proxy_url: string | null;
}

export interface ApiKeyEntry {
  id: string;
  api_key: string;
  base_url: string | null;
  disabled: boolean;
  proxy_url: string | null;
}

export interface CredentialPoolConfig {
  kiro: CredentialEntry[];
  gemini: CredentialEntry[];
  qwen: CredentialEntry[];
  openai: ApiKeyEntry[];
  claude: ApiKeyEntry[];
  gemini_api_keys: GeminiApiKeyEntry[];
  vertex_api_keys: VertexApiKeyEntry[];
  codex: CredentialEntry[];
  iflow: IFlowCredentialEntry[];
}

export interface KiroCredentialStatus {
  loaded: boolean;
  has_access_token: boolean;
  has_refresh_token: boolean;
  region: string | null;
  auth_method: string | null;
  expires_at: string | null;
  creds_path: string;
}

export interface EnvVariable {
  key: string;
  value: string;
  masked: string;
}

export interface CheckResult {
  changed: boolean;
  new_hash: string;
  reloaded: boolean;
}

export interface GeminiCredentialStatus {
  loaded: boolean;
  has_access_token: boolean;
  has_refresh_token: boolean;
  expiry_date: number | null;
  is_valid: boolean;
  creds_path: string;
}

export interface QwenCredentialStatus {
  loaded: boolean;
  has_access_token: boolean;
  has_refresh_token: boolean;
  expiry_date: number | null;
  is_valid: boolean;
  creds_path: string;
  user_id?: string;
  nick_name?: string;
  token_path?: string;
  status_message?: string;
}

export interface OpenAICustomStatus {
  enabled: boolean;
  has_api_key: boolean;
  base_url: string;
}

export interface ClaudeCustomStatus {
  enabled: boolean;
  has_api_key: boolean;
  base_url: string;
}
