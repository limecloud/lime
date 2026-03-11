import { safeInvoke } from "@/lib/dev-bridge";
import type {
  CheckResult,
  ClaudeCustomStatus,
  EnvVariable,
  GeminiCredentialStatus,
  KiroCredentialStatus,
  OpenAICustomStatus,
  QwenCredentialStatus,
} from "./providerRuntimeTypes";

export type {
  AmpConfig,
  AmpModelMapping,
  ApiKeyEntry,
  CheckResult,
  ClaudeCustomStatus,
  CredentialEntry,
  CredentialPoolConfig,
  EnvVariable,
  GeminiApiKeyEntry,
  GeminiCredentialStatus,
  IFlowCredentialEntry,
  KiroCredentialStatus,
  OpenAICustomStatus,
  QwenCredentialStatus,
  VertexApiKeyEntry,
  VertexModelAlias,
} from "./providerRuntimeTypes";

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
