/**
 * Mock for @tauri-apps/api/event
 */

type EventCallback<T> = (event: T) => void;
type UnlistenFn = () => void;

// 存储事件监听器
const listeners = new Map<string, Set<EventCallback<any>>>();
const shouldLogMockEventInfo = import.meta.env.MODE !== "test";

function logMockEventInfo(...args: Parameters<typeof console.log>) {
  if (!shouldLogMockEventInfo) {
    return;
  }
  console.log(...args);
}

/**
 * Mock listen function
 */
export async function listen<T = any>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  logMockEventInfo(`[Mock] listen: ${event}`);

  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }

  listeners.get(event)!.add(handler);

  // 返回 unlisten 函数
  return () => {
    const set = listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        listeners.delete(event);
      }
    }
    logMockEventInfo(`[Mock] unlisten: ${event}`);
  };
}

/**
 * Mock once function
 */
export async function once<T = any>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  logMockEventInfo(`[Mock] once: ${event}`);

  const wrappedHandler = (data: T) => {
    handler(data);
    // 自动移除监听器
    const set = listeners.get(event);
    if (set) {
      set.delete(wrappedHandler);
    }
  };

  return listen(event, wrappedHandler);
}

/**
 * Mock emit function - 用于触发事件
 */
export async function emit(event: string, payload?: any): Promise<void> {
  logMockEventInfo(`[Mock] emit: ${event}`, payload);

  const set = listeners.get(event);
  if (set) {
    set.forEach((handler) => {
      try {
        handler({ event, payload });
      } catch (e) {
        console.error(`[Mock] Error in event handler for ${event}:`, e);
      }
    });
  }
}

/**
 * 手动触发一个事件（用于测试）
 */
export function triggerEvent(event: string, payload?: any) {
  emit(event, payload);
}

/**
 * 清除所有事件监听器
 */
export function clearAllListeners() {
  listeners.clear();
}

// 导出类型
export type { UnlistenFn };

// 重新导出 EventTarget 等类型（如果需要）
export type TauriEvent<T> = {
  event: Event;
  payload: T;
};

export type EventTarget = any;

// 导出 TAURI_BACKEND_COMPAT 的空实现
export const TAURI_BACKEND_COMPAT = {
  loadTauriCompat: async () => {},
};
