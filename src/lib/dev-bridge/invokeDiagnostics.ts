const INVOKE_ERROR_TEXT_LIMIT = 800;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer ***"],
  [/\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._-]+["']?/gi, "api_key=***"],
  [
    /\baccess[_-]?token\s*[:=]\s*["']?[A-Za-z0-9._-]+["']?/gi,
    "access_token=***",
  ],
  [
    /\brefresh[_-]?token\s*[:=]\s*["']?[A-Za-z0-9._-]+["']?/gi,
    "refresh_token=***",
  ],
  [/\btoken\s*[:=]\s*["']?[A-Za-z0-9._-]{10,}["']?/gi, "token=***"],
  [/\bsk-[A-Za-z0-9]{12,}\b/g, "sk-***"],
];

export function sanitizeText(input: string): string {
  let sanitized = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[depth_limited]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = sanitizeValue(nestedValue, depth + 1);
    }
    return output;
  }
  return sanitizeText(String(value));
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const core = error.message || error.name || "Unknown error";
    return sanitizeText(core).slice(0, INVOKE_ERROR_TEXT_LIMIT);
  }
  return sanitizeText(String(error || "Unknown error")).slice(
    0,
    INVOKE_ERROR_TEXT_LIMIT,
  );
}

export function isPersistedAtomCommand(command: string): boolean {
  return (
    command === "persisted_atom_read" || command === "persisted_atom_update"
  );
}

function ownDataValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function invokeArgsPreview(
  command: string,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!args) return undefined;
  if (command === "app_server_handle_json_lines") {
    const lines = ownDataValue(ownDataValue(args, "request"), "lines");
    if (Array.isArray(lines)) {
      return {
        request: {
          lines: lines.map((line) => {
            if (typeof line !== "string") return "[invalid JSON-RPC]";
            try {
              const request = JSON.parse(line);
              if (
                typeof request?.method === "string" &&
                (request.method.startsWith("dictationHistory/") ||
                  request.method.startsWith("voiceTranscription/"))
              ) {
                // 音频和听写文本只进入领域存储，不复制到诊断缓存。
                return JSON.stringify({
                  jsonrpc: request.jsonrpc,
                  id: request.id,
                  method: request.method,
                });
              }
              if (request?.method === "account/login/start") {
                // 登录凭据不得经 JSON 字符串旁路进入本地诊断缓冲。
                return JSON.stringify({
                  jsonrpc: request.jsonrpc,
                  id: request.id,
                  method: request.method,
                  params: { type: request.params?.type },
                });
              }
              return sanitizeText(line);
            } catch {
              return "[invalid JSON-RPC]";
            }
          }),
        },
      };
    }
  }
  if (!isPersistedAtomCommand(command))
    return sanitizeValue(args) as Record<string, unknown>;
  // 草稿、媒体、scope 与任意身份文本不能进入持久化诊断缓冲。
  const candidateKey = ownDataValue(args, "key");
  const key =
    candidateKey === "composer-drafts-v1" ||
    candidateKey === "app-shell-summary-panel-pinned" ||
    candidateKey === "app-shell-file-tree-open" ||
    candidateKey === "local-env-selections-by-workspace" ||
    candidateKey === "local-env-recent-actions-by-key"
      ? candidateKey
      : "unknown";
  if (command === "persisted_atom_read") return { key };
  const candidate = ownDataValue(ownDataValue(args, "mutation"), "op");
  const op =
    typeof candidate === "string" &&
    (key === "app-shell-summary-panel-pinned" ||
    key === "app-shell-file-tree-open"
      ? ["set"]
      : key === "local-env-selections-by-workspace"
        ? ["set", "delete"]
        : key === "local-env-recent-actions-by-key"
          ? ["record"]
          : key === "composer-drafts-v1"
            ? ["put", "promote", "consume", "clear"]
            : []
    ).includes(candidate)
      ? candidate
      : "unknown";
  return { key, op };
}

export function invokeDiagnosticError(command: string, error: unknown): string {
  // 不检查草稿调用错误的 message/data；它们可能回显完整用户内容。
  return isPersistedAtomCommand(command)
    ? "Persisted atom IPC request failed"
    : toErrorMessage(error);
}

export function invokeConsoleError(command: string, error: unknown): unknown {
  return isPersistedAtomCommand(command)
    ? invokeDiagnosticError(command, error)
    : error;
}
