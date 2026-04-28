/**
 * 配置事件全局管理器
 *
 * 在应用级别管理配置变更事件订阅，确保全应用范围内的配置同步。
 */

import { safeListen } from "@/lib/dev-bridge";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** 配置变更来源 */
export type ConfigChangeSource =
  | "HotReload"
  | "ApiCall"
  | "FrontendUI"
  | "SystemInit";

/** 完整配置重载事件 */
export interface FullReloadEvent {
  timestamp_ms: number;
  source: ConfigChangeSource;
}

/** 路由配置变更事件 */
export interface RoutingChangeEvent {
  default_provider?: string;
  model_aliases_changed: boolean;
  model_aliases?: Record<string, string>;
  source: ConfigChangeSource;
}

/** 注入配置变更事件 */
export interface InjectionChangeEvent {
  enabled: boolean;
  rules_count: number;
  source: ConfigChangeSource;
}

/** 端点 Provider 配置变更事件 */
export interface EndpointProvidersChangeEvent {
  cursor?: string;
  claude_code?: string;
  codex?: string;
  windsurf?: string;
  kiro?: string;
  other?: string;
  source: ConfigChangeSource;
}

/** 服务器配置变更事件 */
export interface ServerChangeEvent {
  api_key_changed: boolean;
  host_changed: boolean;
  port_changed: boolean;
  new_host?: string;
  new_port?: number;
  source: ConfigChangeSource;
}

/** 日志配置变更事件 */
export interface LoggingChangeEvent {
  enabled: boolean;
  level: string;
  retention_days: number;
  source: ConfigChangeSource;
}

/** 重试配置变更事件 */
export interface RetryChangeEvent {
  max_retries: number;
  base_delay_ms: number;
  max_delay_ms: number;
  auto_switch_provider: boolean;
  source: ConfigChangeSource;
}

/** Amp CLI 配置变更事件 */
export interface AmpConfigChangeEvent {
  upstream_url?: string;
  model_mappings_count: number;
  source: ConfigChangeSource;
}

/** 配置变更事件联合类型 */
export type ConfigChangeEvent =
  | { type: "FullReload"; data: FullReloadEvent }
  | { type: "RoutingChanged"; data: RoutingChangeEvent }
  | { type: "InjectionChanged"; data: InjectionChangeEvent }
  | { type: "EndpointProvidersChanged"; data: EndpointProvidersChangeEvent }
  | { type: "ServerChanged"; data: ServerChangeEvent }
  | { type: "LoggingChanged"; data: LoggingChangeEvent }
  | { type: "RetryChanged"; data: RetryChangeEvent }
  | { type: "AmpConfigChanged"; data: AmpConfigChangeEvent };

/** 事件回调类型 */
type ConfigEventCallback = (event: ConfigChangeEvent) => void;

/** Tauri 事件名称 */
const CONFIG_CHANGED_EVENT = "config-changed";

/**
 * 配置事件全局管理器
 *
 * 单例模式，确保全应用只有一个事件订阅实例。
 */
class ConfigEventManager {
  private static instance: ConfigEventManager;
  private unlisten: UnlistenFn | null = null;
  private subscribed = false;
  private subscribing = false;
  private callbacks: Set<ConfigEventCallback> = new Set();
  private lastEvent: ConfigChangeEvent | null = null;
  private error: string | null = null;

  private constructor() {}

  static getInstance(): ConfigEventManager {
    if (!ConfigEventManager.instance) {
      ConfigEventManager.instance = new ConfigEventManager();
    }
    return ConfigEventManager.instance;
  }

  /**
   * 订阅配置变更事件（全局只订阅一次）
   */
  async subscribe(): Promise<void> {
    if (this.subscribed || this.subscribing) {
      return;
    }

    // 浏览器开发模式下优先让出 DevBridge 事件连接给聊天主链，
    // 配置热更新监听不再默认占用一个长期 SSE 连接。
    if (!hasTauriInvokeCapability()) {
      this.error = null;
      return;
    }

    this.subscribing = true;
    this.error = null;

    try {
      // 监听 Tauri 配置变更事件
      this.unlisten = await safeListen<ConfigChangeEvent>(
        CONFIG_CHANGED_EVENT,
        (event) => {
          this.handleEvent(event.payload);
        },
      );

      this.subscribed = true;
      this.subscribing = false;
      console.log("[ConfigEventManager] 已订阅配置变更事件");
    } catch (e) {
      this.subscribing = false;
      this.error = e instanceof Error ? e.message : "订阅失败";
      console.error("[ConfigEventManager] 订阅配置变更事件失败:", e);
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe(): void {
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
    this.subscribed = false;
    this.subscribing = false;
    console.log("[ConfigEventManager] 已取消订阅配置变更事件");
  }

  /**
   * 添加事件回调
   */
  addCallback(callback: ConfigEventCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * 处理事件
   */
  private handleEvent(event: ConfigChangeEvent): void {
    this.lastEvent = event;

    console.log(
      `[ConfigEventManager] 收到配置变更事件: ${event.type}`,
      event.data,
    );

    // 通知所有回调
    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (e) {
        console.error("[ConfigEventManager] 回调执行失败:", e);
      }
    });
  }

  /**
   * 获取当前状态
   */
  getState() {
    return {
      subscribed: this.subscribed,
      subscribing: this.subscribing,
      error: this.error,
      lastEvent: this.lastEvent,
    };
  }

  /**
   * 检查是否已订阅
   */
  isSubscribed(): boolean {
    return this.subscribed;
  }

  /**
   * 获取最后一次事件
   */
  getLastEvent(): ConfigChangeEvent | null {
    return this.lastEvent;
  }
}

// 导出单例
export const configEventManager = ConfigEventManager.getInstance();
