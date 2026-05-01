/**
 * 开发桥接 HTTP 客户端
 *
 * 在开发模式下，当 Tauri IPC 不可用时（浏览器环境），
 * 通过 HTTP 与运行中的 Tauri 后端通信。
 */

import {
  hasTauriInvokeCapability,
  hasTauriRuntimeMarkers,
} from "@/lib/tauri-runtime";
import { shouldDisallowMockFallbackInBrowser } from "./mockPriorityCommands";

const BRIDGE_URL = "http://127.0.0.1:3030/invoke";
const BRIDGE_HEALTH_URL = "http://127.0.0.1:3030/health";
const BRIDGE_EVENTS_URL = "http://127.0.0.1:3030/events";
const DEV_BRIDGE_EVENT_CONNECT_TIMEOUT_MS = 1500;
const DEV_BRIDGE_REQUEST_TIMEOUT_MS = 1800;
const DEV_BRIDGE_TRUTH_COMMAND_TIMEOUT_MS = 5000;
const DEV_BRIDGE_VOICE_MODEL_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const DEV_BRIDGE_AGENT_RUNTIME_TIMEOUT_MS = 60000;
const DEV_BRIDGE_AGENT_SESSION_READ_TIMEOUT_MS = 8000;
const DEV_BRIDGE_AGENT_SESSION_PATCH_TIMEOUT_MS = 5000;
const DEV_BRIDGE_AGENT_SESSION_CREATE_TIMEOUT_MS = 15000;
const DEV_BRIDGE_PROVIDER_PROBE_TIMEOUT_MS = 30000;
const DEV_BRIDGE_HEALTH_TIMEOUT_MS = 3000;
const DEV_BRIDGE_HEALTH_CACHE_MS = 10000;
const DEV_BRIDGE_FAILURE_COOLDOWN_MS = 3000;

const DEV_BRIDGE_PROVIDER_PROBE_COMMANDS = new Set([
  "fetch_provider_models_auto",
  "test_api_key_provider_connection",
  "test_api_key_provider_chat",
]);

const DEV_BRIDGE_AGENT_LONG_RUNNING_COMMANDS = new Set([
  "agent_generate_title",
]);

const DEV_BRIDGE_COOLDOWN_BYPASS_COMMANDS = new Set([
  "agent_runtime_get_session",
  "agent_runtime_list_sessions",
  "agent_runtime_submit_turn",
  "agent_runtime_create_session",
  "agent_runtime_send_subagent_input",
  "get_or_create_default_project",
  "workspace_get",
  "workspace_get_default",
  "workspace_list",
  "workspace_ensure_ready",
]);

const DEV_BRIDGE_READ_RETRY_COMMANDS = new Set([
  "agent_runtime_get_session",
  "agent_runtime_list_sessions",
]);

export interface InvokeRequest {
  cmd: string;
  args?: unknown;
}

export interface InvokeResponse {
  result?: unknown;
  error?: string;
}

type DevBridgeEventHandler<T> = (event: { payload: T }) => void;

interface DevBridgeEventConnection {
  source: EventSource;
  eventsKey: string;
  openPromise: Promise<void>;
}

interface BridgeEventMessage<T = unknown> {
  event?: string;
  payload: T;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

const bridgeEventListeners = new Map<
  string,
  Set<DevBridgeEventHandler<unknown>>
>();
let bridgeEventConnection: DevBridgeEventConnection | null = null;
let bridgeEventConnectionPromise: Promise<void> | null = null;
let bridgeLastHealthyAt = 0;
let bridgeConnectionBackoffUntil = 0;
let bridgeHealthProbePromise: Promise<boolean> | null = null;

function resolveBridgeRequestTimeoutMs(cmd: string): number {
  if (
    cmd === "agent_runtime_get_session" ||
    cmd === "agent_runtime_list_sessions"
  ) {
    return DEV_BRIDGE_AGENT_SESSION_READ_TIMEOUT_MS;
  }
  if (cmd === "agent_runtime_update_session") {
    return DEV_BRIDGE_AGENT_SESSION_PATCH_TIMEOUT_MS;
  }
  if (cmd === "agent_runtime_create_session") {
    return DEV_BRIDGE_AGENT_SESSION_CREATE_TIMEOUT_MS;
  }
  if (
    cmd.startsWith("agent_runtime_") ||
    DEV_BRIDGE_AGENT_LONG_RUNNING_COMMANDS.has(cmd)
  ) {
    return DEV_BRIDGE_AGENT_RUNTIME_TIMEOUT_MS;
  }
  if (DEV_BRIDGE_PROVIDER_PROBE_COMMANDS.has(cmd)) {
    return DEV_BRIDGE_PROVIDER_PROBE_TIMEOUT_MS;
  }
  if (cmd === "voice_models_download") {
    return DEV_BRIDGE_VOICE_MODEL_DOWNLOAD_TIMEOUT_MS;
  }
  if (shouldDisallowMockFallbackInBrowser(cmd)) {
    return DEV_BRIDGE_TRUTH_COMMAND_TIMEOUT_MS;
  }
  return DEV_BRIDGE_REQUEST_TIMEOUT_MS;
}

function resolveEventSourceConstructor(): typeof EventSource | null {
  if (
    typeof window !== "undefined" &&
    typeof window.EventSource === "function"
  ) {
    return window.EventSource;
  }

  if (typeof globalThis.EventSource === "function") {
    return globalThis.EventSource;
  }

  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown error";
  }
  return String(error || "Unknown error");
}

function isBridgeCommandError(message: string): boolean {
  return (
    message.includes("未知命令") ||
    message.includes("Unsupported command") ||
    message.includes("未实现")
  );
}

function isBridgeConnectionError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    message.includes("Failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("NetworkError") ||
    message.includes("ERR_CONNECTION_REFUSED") ||
    message.includes("Load failed") ||
    message.includes("ECONNREFUSED") ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("aborterror")
  );
}

function isBridgeTimeoutError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("aborterror")
  );
}

function isBridgeHardConnectionError(message: string): boolean {
  if (message.includes("bridge health check failed")) {
    return false;
  }
  if (isBridgeTimeoutError(message)) {
    return false;
  }
  return (
    message.includes("Failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("NetworkError") ||
    message.includes("ERR_CONNECTION_REFUSED") ||
    message.includes("Load failed") ||
    message.includes("ECONNREFUSED")
  );
}

function markBridgeHealthy(now = Date.now()): void {
  bridgeLastHealthyAt = now;
  bridgeConnectionBackoffUntil = 0;
}

function markBridgeUnavailable(now = Date.now()): void {
  bridgeLastHealthyAt = 0;
  bridgeConnectionBackoffUntil = Math.max(
    bridgeConnectionBackoffUntil,
    now + DEV_BRIDGE_FAILURE_COOLDOWN_MS,
  );
}

function isBridgeCooldownActive(now = Date.now()): boolean {
  return bridgeConnectionBackoffUntil > now;
}

function createBridgeConnectionFailureError(reason: string): Error {
  return new Error(`Failed to fetch (${reason})`);
}

async function fetchWithTimeout(
  input: FetchInput,
  init: FetchOptions,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw createBridgeConnectionFailureError(`timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function shouldBypassBridgeCooldown(cmd: string): boolean {
  return DEV_BRIDGE_COOLDOWN_BYPASS_COMMANDS.has(cmd);
}

function shouldRetryBridgeInvoke(cmd: string, message: string): boolean {
  return (
    DEV_BRIDGE_READ_RETRY_COMMANDS.has(cmd) &&
    isBridgeConnectionError(message) &&
    !isBridgeTimeoutError(message)
  );
}

async function ensureBridgeReachable(options?: {
  bypassCooldown?: boolean;
  forceProbe?: boolean;
}): Promise<void> {
  const now = Date.now();
  if (
    options?.forceProbe !== true &&
    bridgeLastHealthyAt > 0 &&
    now - bridgeLastHealthyAt < DEV_BRIDGE_HEALTH_CACHE_MS
  ) {
    return;
  }

  if (isBridgeCooldownActive(now) && options?.bypassCooldown !== true) {
    throw createBridgeConnectionFailureError("bridge cooldown active");
  }

  if (!bridgeHealthProbePromise) {
    bridgeHealthProbePromise = (async () => {
      try {
        const response = await fetchWithTimeout(
          BRIDGE_HEALTH_URL,
          {
            method: "GET",
          },
          DEV_BRIDGE_HEALTH_TIMEOUT_MS,
        );
        if (!response.ok) {
          markBridgeUnavailable();
          return false;
        }
        markBridgeHealthy();
        return true;
      } catch (error) {
        const message = toErrorMessage(error);
        if (isBridgeHardConnectionError(message)) {
          markBridgeUnavailable();
          return false;
        }
        if (isBridgeTimeoutError(message)) {
          if (bridgeLastHealthyAt > 0) {
            markBridgeHealthy();
            return true;
          }
          return false;
        }
        throw error;
      } finally {
        bridgeHealthProbePromise = null;
      }
    })();
  }

  const reachable = await bridgeHealthProbePromise;
  if (!reachable) {
    throw createBridgeConnectionFailureError("bridge health check failed");
  }
}

function isTestEnvironment(): boolean {
  return Boolean(import.meta.env?.MODE === "test" || import.meta.env?.VITEST);
}

function isJsdomEnvironment(): boolean {
  return Boolean(
    typeof navigator !== "undefined" &&
    typeof navigator.userAgent === "string" &&
    navigator.userAgent.toLowerCase().includes("jsdom"),
  );
}

export function normalizeDevBridgeError(cmd: string, error: unknown): Error {
  const message = toErrorMessage(error);

  if (isBridgeCommandError(message)) {
    return error instanceof Error ? error : new Error(message);
  }

  if (isBridgeConnectionError(message)) {
    return new Error(
      `[DevBridge] 浏览器模式无法连接后端桥接，命令 "${cmd}" 执行失败。请先启动 Tauri 开发后端（例如 npm run tauri:dev 或 npm run tauri:dev:headless），并确认 http://127.0.0.1:3030 可访问。原始错误: ${message}`,
    );
  }

  return error instanceof Error
    ? error
    : new Error(`[DevBridge] 命令 "${cmd}" 调用失败: ${message}`);
}

/**
 * 检查开发桥接是否可用
 *
 * @returns true 如果在 dev 模式且 Tauri 不可用
 */
export function isDevBridgeAvailable(): boolean {
  if (isTestEnvironment()) {
    return false;
  }

  // 检查是否在浏览器环境（非 Tauri webview）
  const isBrowser =
    typeof window !== "undefined" &&
    !hasTauriRuntimeMarkers() &&
    !hasTauriInvokeCapability() &&
    // 进一步检查是否在开发模式
    (import.meta.env.DEV ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1");

  return isBrowser;
}

function hasTestEventBridgeCapabilityOverride(): boolean {
  return (
    (isTestEnvironment() || isJsdomEnvironment()) &&
    typeof window !== "undefined" &&
    resolveEventSourceConstructor() !== null
  );
}

export function hasDevBridgeEventListenerCapability(): boolean {
  return (
    (isDevBridgeAvailable() || hasTestEventBridgeCapabilityOverride()) &&
    typeof window !== "undefined" &&
    resolveEventSourceConstructor() !== null
  );
}

function getBridgeEventSubscriptionSnapshot(): {
  events: string[];
  eventsKey: string;
} {
  const events = Array.from(bridgeEventListeners.entries())
    .filter(([, listeners]) => listeners.size > 0)
    .map(([event]) => event)
    .sort();
  return {
    events,
    eventsKey: events.join("\n"),
  };
}

function buildBridgeEventsUrl(events: string[]): string {
  if (events.length === 1) {
    return `${BRIDGE_EVENTS_URL}?event=${encodeURIComponent(events[0]!)}`;
  }
  return `${BRIDGE_EVENTS_URL}?events=${encodeURIComponent(
    JSON.stringify(events),
  )}`;
}

function closeBridgeEventConnection(connection = bridgeEventConnection): void {
  if (!connection) {
    return;
  }
  connection.source.close();
  if (bridgeEventConnection === connection) {
    bridgeEventConnection = null;
  }
}

function parseBridgeEventMessage<T>(raw: string): BridgeEventMessage<T> | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { event?: string; payload?: T };
    if (parsed && typeof parsed === "object" && "payload" in parsed) {
      return {
        event: typeof parsed.event === "string" ? parsed.event : undefined,
        payload: parsed.payload as T,
      };
    }
    return { payload: parsed as T };
  } catch {
    return { payload: raw as T };
  }
}

function dispatchBridgeEventMessage(
  events: string[],
  message: BridgeEventMessage<unknown>,
): void {
  const targetEvents = message.event ? [message.event] : events;
  for (const eventName of targetEvents) {
    const listeners = bridgeEventListeners.get(eventName);
    if (!listeners || listeners.size === 0) {
      continue;
    }
    for (const listener of listeners) {
      try {
        listener({ payload: message.payload });
      } catch (error) {
        console.error(`[DevBridge] 事件监听器执行失败: ${eventName}`, error);
      }
    }
  }
}

async function createBridgeEventConnection(
  requestedEvents: string[],
  requestedEventsKey: string,
): Promise<DevBridgeEventConnection> {
  if (requestedEvents.length === 0) {
    throw new Error("[DevBridge] 事件名不能为空");
  }

  await ensureBridgeReachable();

  const latestSnapshot = getBridgeEventSubscriptionSnapshot();
  if (latestSnapshot.events.length === 0) {
    closeBridgeEventConnection();
    throw new Error("[DevBridge] 没有可监听事件");
  }
  const events =
    latestSnapshot.eventsKey === requestedEventsKey
      ? requestedEvents
      : latestSnapshot.events;
  const eventsKey =
    latestSnapshot.eventsKey === requestedEventsKey
      ? requestedEventsKey
      : latestSnapshot.eventsKey;

  const EventSourceConstructor = resolveEventSourceConstructor();
  if (!EventSourceConstructor) {
    throw new Error("[DevBridge] 浏览器模式事件桥不可用");
  }

  closeBridgeEventConnection();

  const source = new EventSourceConstructor(buildBridgeEventsUrl(events));
  let hubActive = true;
  let hasOpened = false;
  let settleOpen: ((value: void | PromiseLike<void>) => void) | null = null;
  let settleOpenError: ((reason?: unknown) => void) | null = null;
  let reconnectWarningShown = false;
  const openPromise = new Promise<void>((resolve, reject) => {
    settleOpen = resolve;
    settleOpenError = reject;
  });
  const connectTimeout = window.setTimeout(() => {
    if (hasOpened || !hubActive) {
      return;
    }
    markBridgeUnavailable();
    hubActive = false;
    closeBridgeEventConnection(connection);
    settleOpenError?.(
      new Error(`[DevBridge] 事件流连接超时: ${events.join(", ")}`),
    );
  }, DEV_BRIDGE_EVENT_CONNECT_TIMEOUT_MS);

  const connection: DevBridgeEventConnection = {
    eventsKey,
    source,
    openPromise,
  };
  bridgeEventConnection = connection;

  source.onmessage = (messageEvent) => {
    if (reconnectWarningShown) {
      reconnectWarningShown = false;
      markBridgeHealthy();
    }
    const parsed = parseBridgeEventMessage<unknown>(messageEvent.data);
    if (!parsed) {
      return;
    }
    dispatchBridgeEventMessage(events, parsed);
  };

  source.onopen = () => {
    if (!hubActive) {
      return;
    }
    hasOpened = true;
    reconnectWarningShown = false;
    markBridgeHealthy();
    window.clearTimeout(connectTimeout);
    settleOpen?.();
    settleOpen = null;
    settleOpenError = null;
  };

  source.onerror = (error) => {
    if (!hubActive) {
      return;
    }
    if (hasOpened) {
      if (!reconnectWarningShown) {
        reconnectWarningShown = true;
        console.debug(
          `[DevBridge] 事件流已断开，停止自动重连: ${events.join(", ")}`,
          error,
        );
      }
      hubActive = false;
      closeBridgeEventConnection(connection);
      return;
    }
    console.debug(`[DevBridge] 事件流暂不可用: ${events.join(", ")}`, error);
    hubActive = false;
    closeBridgeEventConnection(connection);
    markBridgeUnavailable();
    window.clearTimeout(connectTimeout);
    settleOpenError?.(
      new Error(`[DevBridge] 事件流连接失败: ${events.join(", ")}`),
    );
    settleOpen = null;
    settleOpenError = null;
  };

  return connection;
}

async function ensureBridgeEventConnection(): Promise<void> {
  if (!bridgeEventConnectionPromise) {
    bridgeEventConnectionPromise = (async () => {
      while (true) {
        const snapshot = getBridgeEventSubscriptionSnapshot();
        if (snapshot.events.length === 0) {
          closeBridgeEventConnection();
          return;
        }

        if (bridgeEventConnection?.eventsKey !== snapshot.eventsKey) {
          await createBridgeEventConnection(
            snapshot.events,
            snapshot.eventsKey,
          );
        }

        await bridgeEventConnection?.openPromise;

        if (
          bridgeEventConnection?.eventsKey ===
          getBridgeEventSubscriptionSnapshot().eventsKey
        ) {
          return;
        }
      }
    })().finally(() => {
      bridgeEventConnectionPromise = null;
    });
  }
  return bridgeEventConnectionPromise;
}

export async function listenViaHttpEvent<T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (!hasDevBridgeEventListenerCapability()) {
    throw new Error(`[DevBridge] 浏览器模式事件桥不可用: ${event}`);
  }

  const normalizedEvent = event.trim();
  if (!normalizedEvent) {
    throw new Error("[DevBridge] 事件名不能为空");
  }

  const listener = handler as DevBridgeEventHandler<unknown>;
  let listeners = bridgeEventListeners.get(normalizedEvent);
  if (!listeners) {
    listeners = new Set<DevBridgeEventHandler<unknown>>();
    bridgeEventListeners.set(normalizedEvent, listeners);
  }
  listeners.add(listener);

  try {
    await ensureBridgeEventConnection();
  } catch (error) {
    listeners.delete(listener);
    if (listeners.size === 0) {
      bridgeEventListeners.delete(normalizedEvent);
    }
    void ensureBridgeEventConnection().catch(() => undefined);
    throw error;
  }

  return () => {
    const currentListeners = bridgeEventListeners.get(normalizedEvent);
    if (!currentListeners) {
      return;
    }
    currentListeners.delete(listener);
    if (currentListeners.size > 0) {
      return;
    }
    bridgeEventListeners.delete(normalizedEvent);
    void ensureBridgeEventConnection().catch(() => undefined);
  };
}

/**
 * 通过 HTTP 桥接调用 Tauri 命令
 *
 * @param cmd - 命令名称
 * @param args - 命令参数
 * @returns Promise<T> 命令执行结果
 */
export async function invokeViaHttp<T = unknown>(
  cmd: string,
  args?: unknown,
): Promise<T> {
  console.log(`[DevBridge] HTTP 调用: ${cmd}`, args);
  const timeoutMs = resolveBridgeRequestTimeoutMs(cmd);
  const bypassCooldown = shouldBypassBridgeCooldown(cmd);

  try {
    await ensureBridgeReachable({
      bypassCooldown,
    });

    const invokeOnce = async (): Promise<Response> =>
      await fetchWithTimeout(
        BRIDGE_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ cmd, args } satisfies InvokeRequest),
        },
        timeoutMs,
      );

    let response: Response;
    try {
      response = await invokeOnce();
    } catch (error) {
      const message = toErrorMessage(error);
      if (!shouldRetryBridgeInvoke(cmd, message)) {
        throw error;
      }
      console.debug(`[DevBridge] HTTP 读命令重试: ${cmd}`, error);
      await ensureBridgeReachable({
        bypassCooldown: true,
        forceProbe: true,
      });
      response = await invokeOnce();
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: InvokeResponse = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    markBridgeHealthy();
    return data.result as T;
  } catch (e) {
    const message = toErrorMessage(e);
    if (isBridgeHardConnectionError(message)) {
      markBridgeUnavailable();
    }
    if (isBridgeConnectionError(message)) {
      console.debug(`[DevBridge] HTTP 暂不可用: ${cmd}`, e);
    } else {
      console.error(`[DevBridge] HTTP 调用失败: ${cmd}`, e);
    }
    throw e;
  }
}

/**
 * 健康检查 - 测试与后端的连接
 *
 * @returns Promise<boolean> true 如果连接成功
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await ensureBridgeReachable();
    return true;
  } catch {
    return false;
  }
}

/** @internal 仅供测试重置 DevBridge HTTP 状态 */
export function __resetDevBridgeHttpStateForTests(): void {
  bridgeLastHealthyAt = 0;
  bridgeConnectionBackoffUntil = 0;
  bridgeHealthProbePromise = null;
  bridgeEventConnectionPromise = null;
  closeBridgeEventConnection();
  bridgeEventListeners.clear();
}

/**
 * 获取桥接状态信息
 */
export interface BridgeStatus {
  available: boolean;
  connected: boolean;
  mode: "tauri" | "http" | "mock";
}

/**
 * 获取当前桥接状态
 */
export function getBridgeStatus(): BridgeStatus {
  const hasTauri = hasTauriInvokeCapability() || hasTauriRuntimeMarkers();
  const devAvailable = isDevBridgeAvailable();

  return {
    available: hasTauri || devAvailable,
    connected: hasTauri, // Tauri 总是连接的，HTTP 需要运行时检查
    mode: hasTauri ? "tauri" : devAvailable ? "http" : "mock",
  };
}
