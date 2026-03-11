import * as Sentry from "@sentry/browser";
import {
  getConfig,
  type Config,
  type CrashReportingConfig as TauriCrashReportingConfig,
} from "@/lib/api/appConfig";
import { reportFrontendCrash as reportFrontendCrashToBackend } from "@/lib/api/frontendCrash";
import configEventManager from "@/lib/configEventManager";
import { getRuntimeAppVersion } from "@/lib/appVersion";

export type CrashContext = Record<string, unknown>;

interface ResolvedCrashReportingConfig {
  enabled: boolean;
  dsn: string | null;
  environment: string;
  sampleRate: number;
  sendPii: boolean;
}

interface FrontendCrashReportPayload {
  message: string;
  name?: string;
  stack?: string;
  component?: string;
  workflow_step?: string;
  creation_mode?: string;
  context?: Record<string, unknown>;
}

export interface FrontendCrashBufferEntry {
  timestamp: string;
  message: string;
  name?: string;
  stack_preview?: string;
  workflow_step?: string;
  creation_mode?: string;
  source?: string;
  page_url?: string;
}

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

const FRONTEND_CRASH_BUFFER_KEY = "proxycast_frontend_crash_buffer_v1";
const FRONTEND_CRASH_BUFFER_LIMIT = 80;

const DEFAULT_CRASH_REPORTING_CONFIG: ResolvedCrashReportingConfig = {
  enabled: true,
  dsn: null,
  environment: import.meta.env.DEV ? "development" : "production",
  sampleRate: 1,
  sendPii: false,
};

let initialized = false;
let sentryEnabled = false;
let listenersAttached = false;
let runtimeContext: CrashContext = {};
let currentResolvedConfig: ResolvedCrashReportingConfig = {
  ...DEFAULT_CRASH_REPORTING_CONFIG,
};
let configListenerDisposer: (() => void) | null = null;

function sanitizeText(input: string): string {
  let sanitized = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

export function sanitizeCrashValue(value: unknown, depth = 0): unknown {
  if (depth > 5) {
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
    return value.map((item) => sanitizeCrashValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = sanitizeCrashValue(nestedValue, depth + 1);
    }
    return output;
  }

  return String(value);
}

function resolveCrashReportingConfig(
  config: Config | null,
): ResolvedCrashReportingConfig {
  const crashConfig: TauriCrashReportingConfig | undefined =
    config?.crash_reporting;

  const dsnCandidate =
    crashConfig?.dsn ??
    (import.meta.env.VITE_SENTRY_DSN as string | undefined) ??
    null;

  const dsn =
    typeof dsnCandidate === "string" && dsnCandidate.trim()
      ? dsnCandidate.trim()
      : null;

  const sampleRateRaw = Number(
    crashConfig?.sample_rate ?? DEFAULT_CRASH_REPORTING_CONFIG.sampleRate,
  );
  const sampleRate = Number.isFinite(sampleRateRaw)
    ? Math.min(1, Math.max(0, sampleRateRaw))
    : DEFAULT_CRASH_REPORTING_CONFIG.sampleRate;

  const environment =
    crashConfig?.environment?.trim() ||
    DEFAULT_CRASH_REPORTING_CONFIG.environment;

  return {
    enabled: crashConfig?.enabled ?? DEFAULT_CRASH_REPORTING_CONFIG.enabled,
    dsn,
    environment,
    sampleRate,
    sendPii: crashConfig?.send_pii ?? DEFAULT_CRASH_REPORTING_CONFIG.sendPii,
  };
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error("Unknown frontend error");
}

function getRuntimeTags(context: CrashContext): Record<string, string> {
  const platform =
    typeof navigator === "undefined"
      ? "unknown"
      : sanitizeText(navigator.platform || "unknown");

  const tags: Record<string, string> = {
    platform,
    app_version: getRuntimeAppVersion(),
  };

  const workflowStep = context.workflow_step;
  const creationMode = context.creation_mode;

  if (typeof workflowStep === "string" && workflowStep.trim()) {
    tags.workflow_step = sanitizeText(workflowStep);
  }
  if (typeof creationMode === "string" && creationMode.trim()) {
    tags.creation_mode = sanitizeText(creationMode);
  }

  return tags;
}

function attachGlobalErrorListeners(): void {
  if (listenersAttached || typeof window === "undefined") {
    return;
  }
  listenersAttached = true;

  window.addEventListener("error", (event) => {
    const normalized = normalizeError(
      event.error ?? event.message ?? "window error",
    );
    void reportFrontendError(normalized, {
      source: "window.onerror",
      workflow_step: "global_runtime",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const normalized = normalizeError(event.reason);
    void reportFrontendError(normalized, {
      source: "window.unhandledrejection",
      workflow_step: "global_promise",
    });
  });
}

async function loadRuntimeConfig(): Promise<ResolvedCrashReportingConfig> {
  try {
    const config = await getConfig();
    return resolveCrashReportingConfig(config);
  } catch (error) {
    console.warn("[CrashReporting] 读取配置失败，使用默认配置:", error);
    return { ...DEFAULT_CRASH_REPORTING_CONFIG };
  }
}

function buildCrashReportPayload(
  error: Error,
  context: CrashContext,
): FrontendCrashReportPayload {
  const mergedContext = sanitizeCrashValue(context) as Record<string, unknown>;
  const message = sanitizeText(error.message || "Unknown frontend error");

  return {
    message,
    name: sanitizeText(error.name || "Error"),
    stack: error.stack ? sanitizeText(error.stack) : undefined,
    component:
      typeof mergedContext.component === "string"
        ? String(mergedContext.component)
        : undefined,
    workflow_step:
      typeof mergedContext.workflow_step === "string"
        ? String(mergedContext.workflow_step)
        : undefined,
    creation_mode:
      typeof mergedContext.creation_mode === "string"
        ? String(mergedContext.creation_mode)
        : undefined,
    context: mergedContext,
  };
}

function readFrontendCrashBufferFromStorage(): FrontendCrashBufferEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(FRONTEND_CRASH_BUFFER_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is FrontendCrashBufferEntry =>
          item &&
          typeof item === "object" &&
          typeof item.timestamp === "string" &&
          typeof item.message === "string",
      )
      .slice(-FRONTEND_CRASH_BUFFER_LIMIT);
  } catch {
    return [];
  }
}

function writeFrontendCrashBufferToStorage(
  items: FrontendCrashBufferEntry[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      FRONTEND_CRASH_BUFFER_KEY,
      JSON.stringify(items.slice(-FRONTEND_CRASH_BUFFER_LIMIT)),
    );
  } catch {
    // ignore
  }
}

function persistFrontendCrashToLocalBuffer(
  report: FrontendCrashReportPayload,
): void {
  const stackPreview = report.stack
    ? sanitizeText(report.stack).split("\n").slice(0, 3).join(" | ")
    : undefined;
  const entry: FrontendCrashBufferEntry = {
    timestamp: new Date().toISOString(),
    message: sanitizeText(report.message),
    name: report.name ? sanitizeText(report.name) : undefined,
    stack_preview: stackPreview,
    workflow_step: report.workflow_step
      ? sanitizeText(report.workflow_step)
      : undefined,
    creation_mode: report.creation_mode
      ? sanitizeText(report.creation_mode)
      : undefined,
    source:
      typeof report.context?.source === "string"
        ? sanitizeText(String(report.context.source))
        : undefined,
    page_url:
      typeof window !== "undefined"
        ? sanitizeText(window.location.href)
        : undefined,
  };

  const current = readFrontendCrashBufferFromStorage();
  current.push(entry);
  writeFrontendCrashBufferToStorage(current);
}

function persistFrontendCrash(report: FrontendCrashReportPayload): void {
  persistFrontendCrashToLocalBuffer(report);
  void reportFrontendCrashToBackend(report).catch((error) => {
    console.warn("[CrashReporting] 写入后端崩溃日志失败:", error);
  });
}

function isSameResolvedConfig(
  left: ResolvedCrashReportingConfig,
  right: ResolvedCrashReportingConfig,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.dsn === right.dsn &&
    left.environment === right.environment &&
    left.sampleRate === right.sampleRate &&
    left.sendPii === right.sendPii
  );
}

async function disableSentryClient(reason: string): Promise<void> {
  if (Sentry.getClient()) {
    try {
      await Sentry.close(2000);
    } catch (error) {
      console.warn("[CrashReporting] 关闭 Sentry 客户端失败:", error);
    }
  }
  sentryEnabled = false;
  console.info(`[CrashReporting] 远端上报已停用: ${reason}`);
}

function initSentryClient(config: ResolvedCrashReportingConfig): void {
  Sentry.init({
    dsn: config.dsn as string,
    enabled: true,
    environment: config.environment,
    sampleRate: config.sampleRate,
    sendDefaultPii: config.sendPii,
    defaultIntegrations: false,
    beforeSend(event: any) {
      const sanitizedEvent = sanitizeCrashValue(event) as Sentry.Event;
      const tags = {
        ...(sanitizedEvent.tags ?? {}),
        ...getRuntimeTags(runtimeContext),
      };
      sanitizedEvent.tags = tags;
      return sanitizedEvent as any;
    },
  });
}

async function applyResolvedConfig(
  nextConfig: ResolvedCrashReportingConfig,
  reason: string,
): Promise<void> {
  const unchanged = isSameResolvedConfig(currentResolvedConfig, nextConfig);
  currentResolvedConfig = { ...nextConfig };

  const shouldEnableRemote = nextConfig.enabled && Boolean(nextConfig.dsn);
  if (!shouldEnableRemote) {
    if (sentryEnabled || Sentry.getClient()) {
      await disableSentryClient(reason);
    } else {
      sentryEnabled = false;
    }
    return;
  }

  if (!unchanged && Sentry.getClient()) {
    await disableSentryClient("reconfigure");
  } else if (unchanged && sentryEnabled && Sentry.getClient()) {
    return;
  }

  initSentryClient(nextConfig);
  sentryEnabled = true;
  console.info(
    `[CrashReporting] Sentry Browser SDK 初始化成功: env=${nextConfig.environment}, sampleRate=${nextConfig.sampleRate}`,
  );
}

async function refreshRuntimeConfig(reason: string): Promise<void> {
  const runtimeConfig = await loadRuntimeConfig();
  await applyResolvedConfig(runtimeConfig, reason);
}

async function bindConfigChangeListener(): Promise<void> {
  if (configListenerDisposer) {
    return;
  }

  try {
    await configEventManager.subscribe();
    configListenerDisposer = configEventManager.addCallback(() => {
      void refreshRuntimeConfig("config-changed");
    });
  } catch (error) {
    console.warn("[CrashReporting] 绑定配置变更监听失败:", error);
  }
}

export async function initCrashReporting(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  attachGlobalErrorListeners();
  await refreshRuntimeConfig("startup");
  await bindConfigChangeListener();
}

export async function applyCrashReportingSettings(
  crashConfig?: TauriCrashReportingConfig | null,
): Promise<void> {
  const pseudoConfig = { crash_reporting: crashConfig ?? undefined } as Config;
  const resolved = resolveCrashReportingConfig(pseudoConfig);
  await applyResolvedConfig(resolved, "manual-update");
}

export function updateCrashContext(context: CrashContext): void {
  for (const [key, value] of Object.entries(context)) {
    if (value === null || value === undefined || value === "") {
      delete runtimeContext[key];
    } else {
      runtimeContext[key] = sanitizeCrashValue(value);
    }
  }
}

export function clearCrashContext(keys?: string[]): void {
  if (!keys || keys.length === 0) {
    runtimeContext = {};
    return;
  }
  for (const key of keys) {
    delete runtimeContext[key];
  }
}

export async function reportFrontendError(
  error: unknown,
  context: CrashContext = {},
): Promise<void> {
  const normalizedError = normalizeError(error);
  const mergedContext = {
    ...runtimeContext,
    ...context,
  };
  const payload = buildCrashReportPayload(normalizedError, mergedContext);
  persistFrontendCrash(payload);

  if (!sentryEnabled || !Sentry.getClient()) {
    return;
  }

  Sentry.withScope((scope) => {
    const tags = getRuntimeTags(payload.context ?? {});
    for (const [key, value] of Object.entries(tags)) {
      scope.setTag(key, value);
    }
    scope.setTag("origin", "frontend");
    scope.setContext(
      "frontend_context",
      (payload.context ?? {}) as Record<string, unknown>,
    );
    Sentry.captureException(normalizedError);
  });
}

export function getFrontendCrashBuffer(limit = 30): FrontendCrashBufferEntry[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(200, Math.max(1, Math.floor(limit)))
    : 30;
  const entries = readFrontendCrashBufferFromStorage();
  return entries.slice(-safeLimit);
}

export function clearFrontendCrashBuffer(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(FRONTEND_CRASH_BUFFER_KEY);
  } catch {
    // ignore
  }
}
