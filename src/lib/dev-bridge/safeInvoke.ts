/**
 * @file Safe Tauri Invoke 封装
 * @description 提供安全的 Tauri invoke 调用，支持三层 fallback：
 *   1. Tauri IPC (生产环境或 Tauri webview)
 *   2. HTTP Bridge (开发模式，浏览器 + Tauri 后端)
 *   3. Mock (仅测试/非浏览器调试场景)
 *
 * @module dev-bridge/safeInvoke
 */

import { core as tauriCore, event as tauriEvent } from "@tauri-apps/api";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  hasDevBridgeEventListenerCapability,
  invokeViaHttp,
  isDevBridgeAvailable,
  listenViaHttpEvent,
  normalizeDevBridgeError,
} from "./http-client";
import { invokeExplicitMock, listenExplicitMock } from "./explicitMockFallback";
import {
  shouldDisallowMockFallbackInBrowser,
  shouldPreferMockInBrowser,
} from "./mockPriorityCommands";
import {
  getTauriGlobal,
  hasTauriEventCapability,
  hasTauriEventListenerCapability,
  hasTauriInvokeCapability,
  hasTauriRuntimeMarkers,
} from "@/lib/tauri-runtime";

const { invoke: baseInvoke } = tauriCore;
const { listen: baseListen, emit: baseEmit } = tauriEvent;

export interface InvokeErrorBufferEntry {
  timestamp: string;
  command: string;
  transport: "tauri-ipc" | "tauri-legacy" | "http-bridge" | "fallback-invoke";
  error: string;
  args_preview?: Record<string, unknown>;
}

export interface InvokeTraceBufferEntry {
  timestamp: string;
  command: string;
  transport: "tauri-ipc" | "tauri-legacy" | "http-bridge" | "fallback-invoke";
  status: "success" | "error";
  duration_ms: number;
  error?: string;
  args_preview?: Record<string, unknown>;
}

const INVOKE_ERROR_BUFFER_KEY = "lime_invoke_error_buffer_v1";
const INVOKE_ERROR_BUFFER_LIMIT = 120;
const INVOKE_TRACE_BUFFER_KEY = "lime_invoke_trace_buffer_v1";
const INVOKE_TRACE_BUFFER_LIMIT = 240;
const INVOKE_ERROR_TEXT_LIMIT = 800;
const USER_TIMING_PREFIX = "lime:safeInvoke";

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

function sanitizeText(input: string): string {
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const core = error.message || error.name || "Unknown error";
    return sanitizeText(core).slice(0, INVOKE_ERROR_TEXT_LIMIT);
  }
  return sanitizeText(String(error || "Unknown error")).slice(
    0,
    INVOKE_ERROR_TEXT_LIMIT,
  );
}

function supportsUserTiming(): boolean {
  return (
    typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function"
  );
}

function sanitizeTimingLabel(input: string): string {
  const normalized = input.replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 120);
  return normalized || "invoke";
}

function canUseExplicitBrowserMockFallback(): boolean {
  return typeof window !== "undefined" && !hasTauriRuntimeMarkers();
}

async function invokeFallbackTransport<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return (await baseInvoke(cmd, args)) as T;
  } catch (error) {
    if (!canUseExplicitBrowserMockFallback()) {
      throw error;
    }
    return invokeExplicitMock<T>(cmd, args);
  }
}

async function listenFallbackTransport<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  try {
    return await baseListen(event, handler);
  } catch (error) {
    if (!canUseExplicitBrowserMockFallback()) {
      throw error;
    }
    return listenExplicitMock(event, handler);
  }
}

function startInvokeTiming(command: string): string | null {
  if (!supportsUserTiming()) {
    return null;
  }
  const timingId = `${USER_TIMING_PREFIX}:${sanitizeTimingLabel(command)}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  try {
    performance.mark(`${timingId}:start`);
    return timingId;
  } catch {
    return null;
  }
}

function finishInvokeTiming(
  timingId: string | null,
  command: string,
  transport: InvokeTraceBufferEntry["transport"],
  status: InvokeTraceBufferEntry["status"],
): void {
  if (!timingId || !supportsUserTiming()) {
    return;
  }

  const startMark = `${timingId}:start`;
  const endMark = `${timingId}:end`;
  const measureName = `${USER_TIMING_PREFIX}:${sanitizeTimingLabel(command)}:${transport}:${status}`;

  try {
    performance.mark(endMark);
    performance.measure(measureName, startMark, endMark);
  } catch {
    // ignore
  } finally {
    try {
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    } catch {
      // ignore
    }
  }
}

function readInvokeErrorBuffer(): InvokeErrorBufferEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(INVOKE_ERROR_BUFFER_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is InvokeErrorBufferEntry =>
          item &&
          typeof item === "object" &&
          typeof item.timestamp === "string" &&
          typeof item.command === "string" &&
          typeof item.transport === "string" &&
          typeof item.error === "string",
      )
      .slice(-INVOKE_ERROR_BUFFER_LIMIT);
  } catch {
    return [];
  }
}

function writeInvokeErrorBuffer(items: InvokeErrorBufferEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      INVOKE_ERROR_BUFFER_KEY,
      JSON.stringify(items.slice(-INVOKE_ERROR_BUFFER_LIMIT)),
    );
  } catch {
    // ignore
  }
}

function readInvokeTraceBuffer(): InvokeTraceBufferEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(INVOKE_TRACE_BUFFER_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is InvokeTraceBufferEntry =>
          item &&
          typeof item === "object" &&
          typeof item.timestamp === "string" &&
          typeof item.command === "string" &&
          typeof item.transport === "string" &&
          (item.status === "success" || item.status === "error") &&
          typeof item.duration_ms === "number",
      )
      .slice(-INVOKE_TRACE_BUFFER_LIMIT);
  } catch {
    return [];
  }
}

function writeInvokeTraceBuffer(items: InvokeTraceBufferEntry[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      INVOKE_TRACE_BUFFER_KEY,
      JSON.stringify(items.slice(-INVOKE_TRACE_BUFFER_LIMIT)),
    );
  } catch {
    // ignore
  }
}

function recordInvokeError(
  command: string,
  args: Record<string, unknown> | undefined,
  error: unknown,
  transport: InvokeErrorBufferEntry["transport"],
): void {
  const current = readInvokeErrorBuffer();
  const entry: InvokeErrorBufferEntry = {
    timestamp: new Date().toISOString(),
    command: sanitizeText(command),
    transport,
    error: toErrorMessage(error),
    args_preview: args
      ? (sanitizeValue(args) as Record<string, unknown>)
      : undefined,
  };
  current.push(entry);
  writeInvokeErrorBuffer(current);
}

function recordInvokeTrace(
  command: string,
  args: Record<string, unknown> | undefined,
  transport: InvokeTraceBufferEntry["transport"],
  status: InvokeTraceBufferEntry["status"],
  startedAt: number,
  error?: unknown,
): void {
  const current = readInvokeTraceBuffer();
  const entry: InvokeTraceBufferEntry = {
    timestamp: new Date().toISOString(),
    command: sanitizeText(command),
    transport,
    status,
    duration_ms: Math.max(0, Date.now() - startedAt),
    error: error ? toErrorMessage(error) : undefined,
    args_preview: args
      ? (sanitizeValue(args) as Record<string, unknown>)
      : undefined,
  };
  current.push(entry);
  writeInvokeTraceBuffer(current);
}

export function getInvokeErrorBuffer(limit = 50): InvokeErrorBufferEntry[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(200, Math.max(1, Math.floor(limit)))
    : 50;
  return readInvokeErrorBuffer().slice(-safeLimit);
}

export function getInvokeTraceBuffer(limit = 80): InvokeTraceBufferEntry[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(300, Math.max(1, Math.floor(limit)))
    : 80;
  return readInvokeTraceBuffer().slice(-safeLimit);
}

export function clearInvokeErrorBuffer(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(INVOKE_ERROR_BUFFER_KEY);
  } catch {
    // ignore
  }
}

export function clearInvokeTraceBuffer(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(INVOKE_TRACE_BUFFER_KEY);
  } catch {
    // ignore
  }
}

/**
 * 安全的 Tauri invoke 封装
 * 支持三种模式：Tauri IPC → HTTP Bridge → Mock。
 * 在浏览器开发模式下，模型 / Provider / Agent 运行时等真相命令
 * 若 HTTP Bridge 失败，会直接报错；其余非真相命令才允许回退到 mock。
 */
export async function safeInvoke<T = any>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  const timingId = startInvokeTiming(cmd);

  // 1. 优先使用 Tauri IPC (生产环境或 Tauri webview 可用时)
  if (
    typeof window !== "undefined" &&
    (window as any).__TAURI__?.core?.invoke
  ) {
    try {
      const result = (await (window as any).__TAURI__.core.invoke(
        cmd,
        args,
      )) as T;
      recordInvokeTrace(cmd, args, "tauri-ipc", "success", startedAt);
      finishInvokeTiming(timingId, cmd, "tauri-ipc", "success");
      return result;
    } catch (error) {
      recordInvokeError(cmd, args, error, "tauri-ipc");
      recordInvokeTrace(cmd, args, "tauri-ipc", "error", startedAt, error);
      finishInvokeTiming(timingId, cmd, "tauri-ipc", "error");
      throw error;
    }
  }

  // Legacy check for older Tauri versions
  if (typeof window !== "undefined" && (window as any).__TAURI__?.invoke) {
    try {
      const result = (await (window as any).__TAURI__.invoke(cmd, args)) as T;
      recordInvokeTrace(cmd, args, "tauri-legacy", "success", startedAt);
      finishInvokeTiming(timingId, cmd, "tauri-legacy", "success");
      return result;
    } catch (error) {
      recordInvokeError(cmd, args, error, "tauri-legacy");
      recordInvokeTrace(cmd, args, "tauri-legacy", "error", startedAt, error);
      finishInvokeTiming(timingId, cmd, "tauri-legacy", "error");
      throw error;
    }
  }

  // Tauri IPC 尚未就绪时不再轮询等待，直接 fall through 到后续通道。
  // 避免首屏并发大量 safeInvoke 时全部阻塞在 waitForTauriCapability 上。
  if (hasTauriInvokeCapability()) {
    try {
      const result = (await baseInvoke(cmd, args)) as T;
      recordInvokeTrace(cmd, args, "tauri-ipc", "success", startedAt);
      finishInvokeTiming(timingId, cmd, "tauri-ipc", "success");
      return result;
    } catch (error) {
      recordInvokeError(cmd, args, error, "tauri-ipc");
      recordInvokeTrace(cmd, args, "tauri-ipc", "error", startedAt, error);
      finishInvokeTiming(timingId, cmd, "tauri-ipc", "error");
      throw error;
    }
  }

  // 2. 浏览器开发模式下，部分原生/非关键命令直接优先走 mock。
  if (isDevBridgeAvailable() && shouldPreferMockInBrowser(cmd)) {
    try {
      const result = await invokeFallbackTransport<T>(cmd, args);
      recordInvokeTrace(cmd, args, "fallback-invoke", "success", startedAt);
      finishInvokeTiming(timingId, cmd, "fallback-invoke", "success");
      return result;
    } catch (error) {
      recordInvokeError(cmd, args, error, "fallback-invoke");
      recordInvokeTrace(
        cmd,
        args,
        "fallback-invoke",
        "error",
        startedAt,
        error,
      );
      finishInvokeTiming(timingId, cmd, "fallback-invoke", "error");
      throw error;
    }
  }

  // 3. Dev 模式下尝试 HTTP 桥接（浏览器环境，Tauri 后端在运行）
  if (isDevBridgeAvailable()) {
    try {
      const result = await invokeViaHttp(cmd, args);
      recordInvokeTrace(cmd, args, "http-bridge", "success", startedAt);
      finishInvokeTiming(timingId, cmd, "http-bridge", "success");
      return result as T;
    } catch (error) {
      const normalizedError = normalizeDevBridgeError(cmd, error);
      recordInvokeError(cmd, args, normalizedError, "http-bridge");
      recordInvokeTrace(
        cmd,
        args,
        "http-bridge",
        "error",
        startedAt,
        normalizedError,
      );

      if (shouldDisallowMockFallbackInBrowser(cmd)) {
        finishInvokeTiming(timingId, cmd, "http-bridge", "error");
        throw normalizedError;
      }

      try {
        const result = await invokeFallbackTransport<T>(cmd, args);
        recordInvokeTrace(cmd, args, "fallback-invoke", "success", startedAt);
        finishInvokeTiming(timingId, cmd, "fallback-invoke", "success");
        return result;
      } catch (fallbackError) {
        recordInvokeError(cmd, args, fallbackError, "fallback-invoke");
        recordInvokeTrace(
          cmd,
          args,
          "fallback-invoke",
          "error",
          startedAt,
          fallbackError,
        );
        finishInvokeTiming(timingId, cmd, "fallback-invoke", "error");
        throw normalizedError;
      }
    }
  }

  // 4. Fallback 到 mock（Vite alias 会替换 @tauri-apps 导入）
  try {
    const result = await invokeFallbackTransport<T>(cmd, args);
    recordInvokeTrace(cmd, args, "fallback-invoke", "success", startedAt);
    finishInvokeTiming(timingId, cmd, "fallback-invoke", "success");
    return result;
  } catch (error) {
    recordInvokeError(cmd, args, error, "fallback-invoke");
    recordInvokeTrace(cmd, args, "fallback-invoke", "error", startedAt, error);
    finishInvokeTiming(timingId, cmd, "fallback-invoke", "error");
    throw error;
  }
}

/**
 * 安全的 Tauri listen 封装
 * 优先使用真实的 Tauri event API
 */
export async function safeListen<T = any>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  // 同步检查即可，不轮询等待，避免首屏并发监听全部阻塞
  if (hasTauriEventListenerCapability()) {
    try {
      return await baseListen(event, handler);
    } catch (error) {
      if (hasTauriRuntimeMarkers()) {
        console.warn(
          `[safeListen] Tauri 事件桥调用失败，跳过监听: ${event}`,
          error,
        );
        return () => {};
      }
      throw error;
    }
  }

  if (hasDevBridgeEventListenerCapability()) {
    try {
      return await listenViaHttpEvent(event, handler);
    } catch (error) {
      if (!hasTauriRuntimeMarkers()) {
        return listenExplicitMock(event, handler);
      }
      console.warn(
        `[safeListen] DevBridge 事件流调用失败，跳过监听: ${event}`,
        error,
      );
      return () => {};
    }
  }

  if (hasTauriRuntimeMarkers()) {
    console.warn(`[safeListen] Tauri 事件桥未就绪，跳过监听: ${event}`);
    return () => {};
  }

  return listenFallbackTransport(event, handler);
}

export function hasNativeTauriEventSupport(): boolean {
  return hasTauriEventListenerCapability();
}

/**
 * 安全的 Tauri emit 封装
 * 优先使用真实的 Tauri event API
 */
export async function safeEmit(
  event: string,
  payload?: unknown,
): Promise<void> {
  const tauriGlobal = getTauriGlobal() as {
    event?: {
      emit?: (event: string, payload?: unknown) => Promise<void>;
    };
  } | null;

  if (typeof tauriGlobal?.event?.emit === "function") {
    return tauriGlobal.event.emit(event, payload);
  }

  // 同步检查，不轮询
  if (hasTauriEventCapability()) {
    return baseEmit(event, payload);
  }

  if (hasTauriRuntimeMarkers()) {
    console.warn(`[safeEmit] Tauri 事件桥未就绪，跳过发送: ${event}`);
    return;
  }

  return baseEmit(event, payload);
}
