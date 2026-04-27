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
const DEV_BRIDGE_AGENT_RUNTIME_TIMEOUT_MS = 60000;
const DEV_BRIDGE_PROVIDER_PROBE_TIMEOUT_MS = 30000;
const DEV_BRIDGE_HEALTH_TIMEOUT_MS = 3000;
const DEV_BRIDGE_HEALTH_CACHE_MS = 10000;
const DEV_BRIDGE_FAILURE_COOLDOWN_MS = 3000;

const DEV_BRIDGE_PROVIDER_PROBE_COMMANDS = new Set([
  "fetch_provider_models_auto",
  "test_api_key_provider_connection",
  "test_api_key_provider_chat",
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

interface DevBridgeEventHub {
  listeners: Set<DevBridgeEventHandler<unknown>>;
  source: EventSource;
  openPromise: Promise<void>;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

const bridgeEventHubs = new Map<string, DevBridgeEventHub>();
let bridgeLastHealthyAt = 0;
let bridgeConnectionBackoffUntil = 0;
let bridgeHealthProbePromise: Promise<boolean> | null = null;

function resolveBridgeRequestTimeoutMs(cmd: string): number {
  if (cmd.startsWith("agent_runtime_")) {
    return DEV_BRIDGE_AGENT_RUNTIME_TIMEOUT_MS;
  }
  if (DEV_BRIDGE_PROVIDER_PROBE_COMMANDS.has(cmd)) {
    return DEV_BRIDGE_PROVIDER_PROBE_TIMEOUT_MS;
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

async function ensureBridgeReachable(): Promise<void> {
  const now = Date.now();
  if (
    bridgeLastHealthyAt > 0 &&
    now - bridgeLastHealthyAt < DEV_BRIDGE_HEALTH_CACHE_MS
  ) {
    return;
  }

  if (isBridgeCooldownActive(now)) {
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

function parseBridgeEventPayload<T>(raw: string): { payload: T } | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { payload?: T };
    if (parsed && typeof parsed === "object" && "payload" in parsed) {
      return { payload: parsed.payload as T };
    }
    return { payload: parsed as T };
  } catch {
    return { payload: raw as T };
  }
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

  let hub = bridgeEventHubs.get(normalizedEvent);
  if (!hub) {
    await ensureBridgeReachable();

    const EventSourceConstructor = resolveEventSourceConstructor();
    if (!EventSourceConstructor) {
      throw new Error(`[DevBridge] 浏览器模式事件桥不可用: ${event}`);
    }

    const source = new EventSourceConstructor(
      `${BRIDGE_EVENTS_URL}?event=${encodeURIComponent(normalizedEvent)}`,
    );
    const listeners = new Set<DevBridgeEventHandler<unknown>>();
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
      bridgeEventHubs.delete(normalizedEvent);
      source.close();
      settleOpenError?.(
        new Error(`[DevBridge] 事件流连接超时: ${normalizedEvent}`),
      );
    }, DEV_BRIDGE_EVENT_CONNECT_TIMEOUT_MS);

    source.onmessage = (messageEvent) => {
      if (reconnectWarningShown) {
        reconnectWarningShown = false;
        markBridgeHealthy();
      }
      const parsed = parseBridgeEventPayload<unknown>(messageEvent.data);
      if (!parsed) {
        return;
      }
      for (const listener of listeners) {
        try {
          listener(parsed);
        } catch (error) {
          console.error(
            `[DevBridge] 事件监听器执行失败: ${normalizedEvent}`,
            error,
          );
        }
      }
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
          console.warn(`[DevBridge] 事件流异常: ${normalizedEvent}`, error);
        }
        return;
      }
      console.warn(`[DevBridge] 事件流异常: ${normalizedEvent}`, error);
      hubActive = false;
      bridgeEventHubs.delete(normalizedEvent);
      source.close();
      markBridgeUnavailable();
      window.clearTimeout(connectTimeout);
      settleOpenError?.(
        new Error(`[DevBridge] 事件流连接失败: ${normalizedEvent}`),
      );
      settleOpen = null;
      settleOpenError = null;
    };

    hub = {
      listeners,
      source,
      openPromise,
    };
    bridgeEventHubs.set(normalizedEvent, hub);
  }

  const listener = handler as DevBridgeEventHandler<unknown>;
  hub.listeners.add(listener);

  await hub.openPromise;

  return () => {
    const currentHub = bridgeEventHubs.get(normalizedEvent);
    if (!currentHub) {
      return;
    }
    currentHub.listeners.delete(listener);
    if (currentHub.listeners.size > 0) {
      return;
    }
    currentHub.source.close();
    bridgeEventHubs.delete(normalizedEvent);
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

  try {
    await ensureBridgeReachable();

    const response = await fetchWithTimeout(
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
    console.error(`[DevBridge] HTTP 调用失败: ${cmd}`, e);
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
  for (const hub of bridgeEventHubs.values()) {
    hub.source.close();
  }
  bridgeEventHubs.clear();
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
