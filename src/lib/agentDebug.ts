import { reportFrontendDebugLog } from "@/lib/api/frontendDebug";

const AGENT_DEBUG_FLAG_KEY = "lime:agent-debug";

type AgentDebugLevel = "debug" | "info" | "warn" | "error";

interface AgentDebugOptions {
  level?: AgentDebugLevel;
  throttleMs?: number;
  dedupeKey?: string;
  consoleOnly?: boolean;
}

type SerializableDebugValue =
  | null
  | boolean
  | number
  | string
  | SerializableDebugValue[]
  | { [key: string]: SerializableDebugValue };

const logThrottleMap = new Map<string, number>();

function readAgentDebugFlag(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(AGENT_DEBUG_FLAG_KEY);
  } catch {
    return null;
  }
}

function isAgentDebugEnabled(): boolean {
  const flag = readAgentDebugFlag();
  if (flag === "0") {
    return false;
  }
  if (flag === "1") {
    return true;
  }
  if (import.meta.env.MODE === "test") {
    return false;
  }
  return Boolean(import.meta.env.DEV);
}

function sanitizeDebugValue(
  value: unknown,
  depth = 0,
): SerializableDebugValue | undefined {
  if (value == null) {
    return null;
  }

  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    if (typeof value === "string" && value.length > 300) {
      return `${value.slice(0, 300)}...`;
    }
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
        ? value.stack.split("\n").slice(0, 4).join(" | ")
        : null,
    };
  }

  if (depth >= 3) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 12)
      .map((item) => sanitizeDebugValue(item, depth + 1) ?? null);
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 24);
    const result: Record<string, SerializableDebugValue> = {};
    for (const [key, item] of entries) {
      const sanitized = sanitizeDebugValue(item, depth + 1);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
    return result;
  }

  return String(value);
}

function getConsoleMethod(level: AgentDebugLevel): typeof console.log {
  if (level === "error") {
    return console.error;
  }
  if (level === "warn") {
    return console.warn;
  }
  if (level === "debug") {
    return console.debug;
  }
  return console.info;
}

function shouldEmitLog(key: string, throttleMs: number): boolean {
  if (throttleMs <= 0) {
    return true;
  }
  const now = Date.now();
  const lastLoggedAt = logThrottleMap.get(key) ?? 0;
  if (now - lastLoggedAt < throttleMs) {
    return false;
  }
  logThrottleMap.set(key, now);
  return true;
}

export function logAgentDebug(
  component: string,
  phase: string,
  context?: Record<string, unknown>,
  options: AgentDebugOptions = {},
): void {
  if (!isAgentDebugEnabled()) {
    return;
  }

  const level = options.level ?? "info";
  const sanitizedContext = sanitizeDebugValue(context ?? {}) as
    | Record<string, SerializableDebugValue>
    | undefined;
  const dedupeKey =
    options.dedupeKey ??
    `${component}:${phase}:${JSON.stringify(sanitizedContext ?? {})}`;

  if (!shouldEmitLog(dedupeKey, options.throttleMs ?? 0)) {
    return;
  }

  getConsoleMethod(level)(
    `[AgentDebug] ${component}.${phase}`,
    sanitizedContext ?? {},
  );

  if (options.consoleOnly) {
    return;
  }

  void reportFrontendDebugLog({
    level,
    category: "agent",
    message: `${component}.${phase}`,
    context: sanitizedContext ?? {},
  }).catch(() => {
    // 调试日志不上抛，避免影响主流程
  });
}
