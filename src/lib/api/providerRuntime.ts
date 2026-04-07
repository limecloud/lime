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
  const credential = await safeInvoke<{
    loaded: boolean;
    has_access_token?: boolean;
    has_refresh_token?: boolean;
    is_valid?: boolean;
    expiry_info?: string | null;
    creds_path?: string | null;
    credentials_path?: string | null;
    status_message?: string | null;
    extra?: Record<string, unknown> | null;
  }>("get_oauth_credentials", {
    provider: "qwen",
  });
  const extra = credential.extra ?? {};
  const parsedExpiryDate = (() => {
    if (!credential.expiry_info) {
      return null;
    }

    const numericExpiry = Number(credential.expiry_info);
    if (Number.isFinite(numericExpiry)) {
      return numericExpiry;
    }

    const timestamp = Date.parse(credential.expiry_info);
    return Number.isNaN(timestamp) ? null : timestamp;
  })();

  return {
    loaded: credential.loaded,
    has_access_token: credential.has_access_token ?? false,
    has_refresh_token: credential.has_refresh_token ?? false,
    expiry_date: parsedExpiryDate,
    is_valid: credential.is_valid ?? false,
    creds_path: credential.creds_path ?? credential.credentials_path ?? "",
    user_id:
      typeof extra.user_id === "string"
        ? extra.user_id
        : typeof extra.userId === "string"
          ? extra.userId
          : undefined,
    nick_name:
      typeof extra.nick_name === "string"
        ? extra.nick_name
        : typeof extra.nickName === "string"
          ? extra.nickName
          : undefined,
    token_path:
      credential.creds_path ?? credential.credentials_path ?? undefined,
    status_message: credential.status_message ?? undefined,
  };
}

export async function reloadQwenCredentials(): Promise<string> {
  const credential = await safeInvoke<{
    status_message?: string | null;
  }>("reload_oauth_credentials", {
    provider: "qwen",
  });
  return credential.status_message ?? "ok";
}

export async function refreshQwenToken(): Promise<string> {
  const credential = await safeInvoke<{
    status_message?: string | null;
  }>("refresh_oauth_token", {
    provider: "qwen",
  });
  return credential.status_message ?? "ok";
}

export async function getQwenEnvVariables(): Promise<EnvVariable[]> {
  return safeInvoke("get_oauth_env_variables", {
    provider: "qwen",
  });
}

export async function getQwenTokenFileHash(): Promise<string> {
  return safeInvoke("get_oauth_token_file_hash", {
    provider: "qwen",
  });
}

export async function checkAndReloadQwenCredentials(
  lastHash: string,
): Promise<CheckResult> {
  return safeInvoke("check_and_reload_oauth_credentials", {
    provider: "qwen",
    lastHash,
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
