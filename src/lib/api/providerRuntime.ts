import { safeInvoke } from "@/lib/dev-bridge";

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

export interface CredentialEntry {
  id: string;
  token_file: string;
  disabled: boolean;
  proxy_url: string | null;
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

export async function refreshKiroToken(): Promise<string> {
  return safeInvoke("refresh_kiro_token");
}

export async function reloadCredentials(): Promise<string> {
  return safeInvoke("reload_credentials");
}

export async function getKiroCredentials(): Promise<KiroCredentialStatus> {
  return safeInvoke("get_kiro_credentials");
}

export async function getEnvVariables(): Promise<EnvVariable[]> {
  return safeInvoke("get_env_variables");
}

export async function getTokenFileHash(): Promise<string> {
  return safeInvoke("get_token_file_hash");
}

export async function checkAndReloadCredentials(
  lastHash: string,
): Promise<CheckResult> {
  return safeInvoke("check_and_reload_credentials", { last_hash: lastHash });
}

export async function getGeminiCredentials(): Promise<GeminiCredentialStatus> {
  return safeInvoke("get_gemini_credentials");
}

export async function reloadGeminiCredentials(): Promise<string> {
  return safeInvoke("reload_gemini_credentials");
}

export async function refreshGeminiToken(): Promise<string> {
  return safeInvoke("refresh_gemini_token");
}

export async function getGeminiEnvVariables(): Promise<EnvVariable[]> {
  return safeInvoke("get_gemini_env_variables");
}

export async function getGeminiTokenFileHash(): Promise<string> {
  return safeInvoke("get_gemini_token_file_hash");
}

export async function checkAndReloadGeminiCredentials(
  lastHash: string,
): Promise<CheckResult> {
  return safeInvoke("check_and_reload_gemini_credentials", {
    last_hash: lastHash,
  });
}

export async function getQwenCredentials(): Promise<QwenCredentialStatus> {
  return safeInvoke("get_qwen_credentials");
}

export async function reloadQwenCredentials(): Promise<string> {
  return safeInvoke("reload_qwen_credentials");
}

export async function refreshQwenToken(): Promise<string> {
  return safeInvoke("refresh_qwen_token");
}

export async function getQwenEnvVariables(): Promise<EnvVariable[]> {
  return safeInvoke("get_qwen_env_variables");
}

export async function getQwenTokenFileHash(): Promise<string> {
  return safeInvoke("get_qwen_token_file_hash");
}

export async function checkAndReloadQwenCredentials(
  lastHash: string,
): Promise<CheckResult> {
  return safeInvoke("check_and_reload_qwen_credentials", {
    last_hash: lastHash,
  });
}

export async function getOpenAICustomStatus(): Promise<OpenAICustomStatus> {
  return safeInvoke("get_openai_custom_status");
}

export async function setOpenAICustomConfig(
  apiKey: string | null,
  baseUrl: string | null,
  enabled: boolean,
): Promise<string> {
  return safeInvoke("set_openai_custom_config", {
    api_key: apiKey,
    base_url: baseUrl,
    enabled,
  });
}

export async function getClaudeCustomStatus(): Promise<ClaudeCustomStatus> {
  return safeInvoke("get_claude_custom_status");
}

export async function setClaudeCustomConfig(
  apiKey: string | null,
  baseUrl: string | null,
  enabled: boolean,
): Promise<string> {
  return safeInvoke("set_claude_custom_config", {
    api_key: apiKey,
    base_url: baseUrl,
    enabled,
  });
}
