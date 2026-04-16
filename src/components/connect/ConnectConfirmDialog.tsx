/**
 * @file Connect 确认弹窗组件
 * @description 显示中转商信息和脱敏 API Key，让用户确认添加
 * @module components/connect/ConnectConfirmDialog
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.4_
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { maskApiKey } from "@/lib/utils/apiKeyMask";
import type { RelayInfo, ConnectError } from "@/hooks/useDeepLink";

/**
 * ConnectConfirmDialog 组件属性
 */
export interface ConnectConfirmDialogProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 中转商信息（如果在注册表中找到） */
  relay: RelayInfo | null;
  /** 中转商 ID（用于未验证警告显示） */
  relayId: string;
  /** API Key */
  apiKey: string;
  /** Key 名称（可选） */
  keyName?: string;
  /** 是否为已验证的中转商 */
  isVerified: boolean;
  /** 是否正在保存 */
  isSaving: boolean;
  /** 错误信息 */
  error: ConnectError | null;
  /** 确认回调 */
  onConfirm: () => void;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 中转商信息展示组件（已验证）
 * _Requirements: 6.1, 6.2_
 */
function VerifiedProviderInfo({ relay }: { relay: RelayInfo }) {
  return (
    <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
      {/* Logo */}
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden shadow-sm flex-shrink-0"
        style={{ backgroundColor: relay.branding.color || "#6366f1" }}
      >
        {relay.branding.logo ? (
          <img
            src={relay.branding.logo}
            alt={relay.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.parentElement!.innerHTML = `<span class="text-white text-xl font-bold">${relay.name.charAt(0).toUpperCase()}</span>`;
            }}
          />
        ) : (
          <span className="text-white text-xl font-bold">
            {relay.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900 text-lg">{relay.name}</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            ✓ 已验证
          </span>
        </div>
        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
          {relay.description}
        </p>
        {relay.links.homepage && (
          <a
            href={relay.links.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-2 inline-flex items-center gap-1"
          >
            访问官网
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * 未验证中转商信息展示组件
 * _Requirements: 3.5, 6.4_
 */
function UnverifiedProviderInfo({ relayId }: { relayId: string }) {
  return (
    <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
      <div className="flex items-start gap-4">
        {/* 警告图标 */}
        <div className="w-14 h-14 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
          <svg
            className="w-8 h-8 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* 信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 text-lg">{relayId}</h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              未验证
            </span>
          </div>
          <p className="text-sm text-amber-700 mt-1">
            此中转商不在官方注册表中，请确认您信任此来源后再添加。
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * API Key 信息展示组件
 * _Requirements: 3.2_
 */
function KeyInfo({
  maskedKey,
  keyName,
}: {
  maskedKey: string;
  keyName?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
          <span className="text-sm text-gray-600">API Key</span>
        </div>
        <code className="font-mono text-sm bg-white px-3 py-1.5 rounded-md border border-gray-200 text-gray-800">
          {maskedKey}
        </code>
      </div>
      {keyName && (
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            <span className="text-sm text-gray-600">名称</span>
          </div>
          <span className="text-sm font-medium text-gray-800">{keyName}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Connect 确认弹窗组件
 *
 * 显示中转商信息和脱敏 API Key，让用户确认是否添加。
 *
 * @param props - 组件属性
 */
export function ConnectConfirmDialog({
  open,
  relay,
  relayId,
  apiKey,
  keyName,
  isVerified,
  isSaving,
  error,
  onConfirm,
  onCancel,
}: ConnectConfirmDialogProps) {
  const maskedKey = maskApiKey(apiKey);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-[480px] p-6">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl flex items-center gap-2">
            <svg
              className="w-6 h-6 text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            添加 API Key
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            确认添加以下中转商的 API Key 到 Lime
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 中转商信息 */}
          {isVerified && relay ? (
            <VerifiedProviderInfo relay={relay} />
          ) : (
            <UnverifiedProviderInfo relayId={relay?.id ?? relayId} />
          )}

          {/* API Key 信息 */}
          <KeyInfo maskedKey={maskedKey} keyName={keyName} />

          {/* 错误提示 */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <svg
                className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-red-700">{error.message}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
          >
            取消
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
            style={
              relay?.branding.color
                ? { backgroundColor: relay.branding.color }
                : undefined
            }
          >
            {isSaving ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                保存中...
              </>
            ) : (
              "确认添加"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
