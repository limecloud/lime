/**
 * @file Deep Link 事件处理 Hook
 * @description 监听 Deep Link URL，管理 Connect 弹窗状态
 * @module hooks/useDeepLink
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 7.1, 7.4_
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  completeOemCloudDesktopOAuthLogin,
  parseOemCloudDesktopOAuthCallbackUrl,
} from "@/lib/oemCloudDesktopAuth";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import { resolveOemLimeHubProviderName } from "@/lib/oemLimeHubProvider";
import {
  showDeepLinkError,
  showApiKeySaveError,
} from "@/lib/utils/connectError";
import { toast } from "sonner";
import { useConnectCallback } from "./useConnectCallback";

/**
 * Deep Link 解析后的 payload
 */
export interface ConnectPayload {
  /** 中转商 ID（必填） */
  relay: string;
  /** API Key（必填） */
  key: string;
  /** Key 名称（可选） */
  name?: string;
  /** 推广码（可选） */
  ref_code?: string;
}

/**
 * 中转商品牌信息
 */
export interface RelayBranding {
  /** Logo URL */
  logo: string;
  /** 主题色 */
  color: string;
}

/**
 * 中转商链接
 */
export interface RelayLinks {
  /** 主页 */
  homepage: string;
  /** 注册链接 */
  register?: string;
  /** 充值链接 */
  recharge?: string;
  /** 文档链接 */
  docs?: string;
  /** 状态页链接 */
  status?: string;
  /** 控制台/仪表盘链接 */
  dashboard?: string;
  /** 网站链接 */
  website?: string;
}

/**
 * 中转商 API 配置
 */
export interface RelayApi {
  /** API 基础 URL */
  base_url: string;
  /** 协议类型 */
  protocol: string;
  /** 认证头名称 */
  auth_header: string;
  /** 认证前缀 */
  auth_prefix: string;
}

/**
 * 中转商联系方式
 */
export interface RelayContact {
  email?: string;
  discord?: string;
  telegram?: string;
  twitter?: string;
}

/**
 * 中转商功能特性
 */
export interface RelayFeatures {
  /** 支持的模型列表 */
  models: string[];
  /** 是否支持流式响应 */
  streaming: boolean;
  /** 是否支持函数调用 */
  function_calling: boolean;
  /** 是否支持视觉模型 */
  vision: boolean;
  /** 是否已验证 */
  verified?: boolean;
}

/**
 * 中转商信息
 */
export interface RelayInfo {
  /** 中转商唯一 ID */
  id: string;
  /** 中转商名称 */
  name: string;
  /** 中转商描述 */
  description: string;
  /** 品牌信息 */
  branding: RelayBranding;
  /** 相关链接 */
  links: RelayLinks;
  /** API 配置 */
  api: RelayApi;
  /** 联系方式 */
  contact: RelayContact;
  /** 功能特性 */
  features: RelayFeatures;
}

/**
 * Deep Link 处理结果（从后端接收的事件 payload）
 */
export interface DeepLinkResult {
  /** 解析后的 payload */
  payload: ConnectPayload;
  /** 中转商信息（如果在注册表中找到） */
  relay_info: RelayInfo | null;
  /** 是否为已验证的中转商 */
  is_verified: boolean;
}

/**
 * 保存 API Key 的返回结果
 */
export interface SaveApiKeyResult {
  /** Provider ID */
  provider_id: string;
  /** API Key ID */
  key_id: string;
  /** Provider 名称 */
  provider_name: string;
  /** 是否为新创建的 Provider */
  is_new_provider: boolean;
}

/**
 * Connect 错误
 */
export interface ConnectError {
  code: string;
  message: string;
}

/**
 * useDeepLink Hook 返回值
 */
export interface UseDeepLinkReturn {
  /** 解析后的 Deep Link payload */
  connectPayload: ConnectPayload | null;
  /** 中转商信息（如果在注册表中找到） */
  relayInfo: RelayInfo | null;
  /** 是否为已验证的中转商 */
  isVerified: boolean;
  /** 弹窗是否打开 */
  isDialogOpen: boolean;
  /** 是否正在保存 */
  isSaving: boolean;
  /** 错误信息 */
  error: ConnectError | null;
  /** 确认添加 API Key */
  handleConfirm: () => Promise<void>;
  /** 取消添加 */
  handleCancel: () => void;
  /** 清除错误 */
  clearError: () => void;
}

export interface UseDeepLinkOptions {
  onOpenBrowserConnectorSettings?: (params: { enable: boolean }) => void;
}

function parseBrowserConnectorDeepLink(
  url: string,
): { enable: boolean } | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "lime:" ||
      parsed.host !== "connectors" ||
      parsed.pathname !== "/browser"
    ) {
      return null;
    }

    const enableParam = parsed.searchParams.get("enable");
    return {
      enable: enableParam === "true" || enableParam === "1",
    };
  } catch {
    return null;
  }
}

/**
 * Deep Link 事件处理 Hook
 *
 * 监听来自 Tauri 后端的 deep-link-connect 事件，管理 Connect 弹窗状态。
 *
 * ## 功能
 *
 * - 监听 `deep-link-connect` 事件（Requirements 5.1）
 * - 触发 Connect_Dialog 打开（Requirements 5.2）
 * - 提供解析后的 Deep Link 参数（Requirements 5.3）
 * - 关闭时清理临时状态（Requirements 5.4）
 *
 * ## 使用示例
 *
 * ```tsx
 * function App() {
 *   const {
 *     connectPayload,
 *     relayInfo,
 *     isDialogOpen,
 *     handleConfirm,
 *     handleCancel,
 *   } = useDeepLink();
 *
 *   return (
 *     <ConnectConfirmDialog
 *       open={isDialogOpen}
 *       relay={relayInfo}
 *       apiKey={connectPayload?.key ?? ''}
 *       keyName={connectPayload?.name}
 *       onConfirm={handleConfirm}
 *       onCancel={handleCancel}
 *     />
 *   );
 * }
 * ```
 *
 * @returns Hook 返回值
 */
export function useDeepLink(options?: UseDeepLinkOptions): UseDeepLinkReturn {
  const onOpenBrowserConnectorSettings =
    options?.onOpenBrowserConnectorSettings;

  // 状态
  const [connectPayload, setConnectPayload] = useState<ConnectPayload | null>(
    null,
  );
  const [relayInfo, setRelayInfo] = useState<RelayInfo | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<ConnectError | null>(null);

  // 用于清理的 ref
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const unlistenErrorRef = useRef<UnlistenFn | null>(null);

  // 统计回调 hook
  const { sendSuccessCallback, sendCancelledCallback, sendErrorCallback } =
    useConnectCallback();

  /**
   * 处理 deep-link-error 事件
   * _Requirements: 7.1_
   */
  const handleDeepLinkError = useCallback(
    (error: { code: string; message: string }) => {
      console.error("[useDeepLink] 收到 deep-link-error 事件:", error);
      // 显示 Toast 错误提示
      showDeepLinkError(error.message, error.code);
    },
    [],
  );

  /**
   * 处理 deep-link-connect 事件
   * _Requirements: 5.1, 5.2, 5.3_
   */
  const handleDeepLinkEvent = useCallback((result: DeepLinkResult) => {
    console.log("[useDeepLink] 收到 deep-link-connect 事件:", result);

    // 设置状态
    setConnectPayload(result.payload);
    setRelayInfo(result.relay_info);
    setIsVerified(result.is_verified);
    setError(null);

    // 打开弹窗
    // _Requirements: 5.2_
    setIsDialogOpen(true);
  }, []);

  const handleOauthCallbackUrl = useCallback(async (url: string) => {
    const payload = parseOemCloudDesktopOAuthCallbackUrl(url);
    if (!payload) {
      return false;
    }

    if (payload.error) {
      toast.error("Google 登录未完成", {
        description: payload.error,
      });
      return true;
    }

    try {
      await completeOemCloudDesktopOAuthLogin(payload);
      const providerName = resolveOemLimeHubProviderName(
        resolveOemCloudRuntimeContext(),
      );
      toast.success("Google 登录成功", {
        description: `个人中心会话、${providerName} 云端目录与服务技能目录已同步。`,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "同步桌面端登录结果失败";
      toast.error("Google 登录失败", {
        description: message,
      });
    }

    return true;
  }, []);

  /**
   * 确认添加 API Key
   * _Requirements: 5.4, 5.3 (统计回调)_
   */
  const handleConfirm = useCallback(async () => {
    if (!connectPayload) {
      console.warn("[useDeepLink] handleConfirm: connectPayload 为空");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // 调用后端保存 API Key（添加到 API Key Provider 系统）
      const result = await safeInvoke<SaveApiKeyResult>("save_relay_api_key", {
        relayId: connectPayload.relay,
        apiKey: connectPayload.key,
        name: connectPayload.name ?? null,
      });

      console.log(
        "[useDeepLink] API Key 保存成功，Provider ID:",
        result.provider_id,
        "Key ID:",
        result.key_id,
      );

      // 发送成功回调（异步，不阻塞）
      // _Requirements: 5.3_
      sendSuccessCallback(
        connectPayload.relay,
        connectPayload.key,
        connectPayload.ref_code,
      );

      // 关闭弹窗并清理状态
      // _Requirements: 5.4_
      setIsDialogOpen(false);
      setConnectPayload(null);
      setRelayInfo(null);
      setIsVerified(false);
    } catch (err) {
      console.error("[useDeepLink] 保存 API Key 失败:", err);
      // 设置错误，但不关闭弹窗
      // _Requirements: 7.4_
      const connectError = err as ConnectError;
      setError(connectError);
      // 显示 Toast 错误提示
      showApiKeySaveError(connectError.message);

      // 发送错误回调
      // _Requirements: 5.3_
      sendErrorCallback(
        connectPayload.relay,
        connectPayload.key,
        connectError.code,
        connectError.message,
        connectPayload.ref_code,
      );
    } finally {
      setIsSaving(false);
    }
  }, [connectPayload, sendSuccessCallback, sendErrorCallback]);

  /**
   * 取消添加
   * _Requirements: 5.4, 5.3 (统计回调)_
   */
  const handleCancel = useCallback(() => {
    console.log("[useDeepLink] 用户取消添加");

    // 发送取消回调（异步，不阻塞）
    // _Requirements: 5.3_
    if (connectPayload) {
      sendCancelledCallback(
        connectPayload.relay,
        connectPayload.key,
        connectPayload.ref_code,
      );
    }

    // 关闭弹窗并清理状态
    // _Requirements: 5.4_
    setIsDialogOpen(false);
    setConnectPayload(null);
    setRelayInfo(null);
    setIsVerified(false);
    setError(null);
  }, [connectPayload, sendCancelledCallback]);

  /**
   * 清除错误
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // 监听 Deep Link URL 和后端事件
  // _Requirements: 5.1, 7.1_
  useEffect(() => {
    let mounted = true;
    let unlistenDeepLink: (() => void) | null = null;

    const setupListener = async () => {
      try {
        // 监听插件派发的 Deep Link URL 事件
        // _Requirements: 5.1_
        unlistenDeepLink = await safeListen<string[]>(
          "deep-link://new-url",
          async (event) => {
            if (!mounted) return;

            const urls = Array.isArray(event.payload) ? event.payload : [];
            console.log("[useDeepLink] 收到 Deep Link URL:", urls);

            for (const url of urls) {
              const connectorParams = parseBrowserConnectorDeepLink(url);
              if (connectorParams) {
                onOpenBrowserConnectorSettings?.(connectorParams);
                continue;
              }

              if (await handleOauthCallbackUrl(url)) {
                continue;
              }

              if (!url.startsWith("lime://connect")) {
                continue;
              }

              try {
                const result = await safeInvoke<DeepLinkResult>(
                  "handle_deep_link",
                  { url },
                );
                if (mounted) {
                  handleDeepLinkEvent(result);
                }
              } catch (err) {
                console.error("[useDeepLink] 处理 Deep Link 失败:", err);
                if (mounted) {
                  const connectError = err as ConnectError;
                  showDeepLinkError(connectError.message, connectError.code);
                }
              }
            }
          },
        );

        // 监听后端发送的 deep-link-connect 事件（兼容旧逻辑）
        const unlisten = await safeListen<DeepLinkResult>(
          "deep-link-connect",
          (event) => {
            if (mounted) {
              handleDeepLinkEvent(event.payload);
            }
          },
        );

        // 监听 deep-link-error 事件
        // _Requirements: 7.1_
        const unlistenError = await safeListen<{
          code: string;
          message: string;
        }>("deep-link-error", (event) => {
          if (mounted) {
            handleDeepLinkError(event.payload);
          }
        });

        if (mounted) {
          unlistenRef.current = unlisten;
          unlistenErrorRef.current = unlistenError;
          console.log("[useDeepLink] 已注册 Deep Link 和事件监听器");
        } else {
          // 如果组件已卸载，立即取消监听
          unlisten();
          unlistenError();
          if (unlistenDeepLink) unlistenDeepLink();
        }
      } catch (err) {
        console.error("[useDeepLink] 注册监听器失败:", err);
      }
    };

    setupListener();

    // 清理函数
    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (unlistenErrorRef.current) {
        unlistenErrorRef.current();
        unlistenErrorRef.current = null;
      }
      if (unlistenDeepLink) {
        unlistenDeepLink();
      }
      console.log("[useDeepLink] 已取消 Deep Link 监听器");
    };
  }, [
    handleDeepLinkEvent,
    handleDeepLinkError,
    handleOauthCallbackUrl,
    onOpenBrowserConnectorSettings,
  ]);

  return {
    connectPayload,
    relayInfo,
    isVerified,
    isDialogOpen,
    isSaving,
    error,
    handleConfirm,
    handleCancel,
    clearError,
  };
}

export default useDeepLink;
