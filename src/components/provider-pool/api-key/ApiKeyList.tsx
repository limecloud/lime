/**
 * @file ApiKeyList 组件
 * @description API Key 列表组件，显示 Provider 的所有 API Key，支持添加新 API Key
 * @module components/provider-pool/api-key/ApiKeyList
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 7.1**
 */

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiKeyItem } from "./ApiKeyItem";
import type { ApiKeyDisplay } from "@/lib/api/apiKeyProvider";
import { getProviderAccessHelp } from "@/lib/provider/providerAccessHelp";
import { SectionInfoButton } from "./SectionInfoButton";

// ============================================================================
// 图标组件
// ============================================================================

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={cn("w-4 h-4", className)}
  >
    <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
  </svg>
);

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={cn("w-4 h-4", className)}
  >
    <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
    <path
      fillRule="evenodd"
      d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
      clipRule="evenodd"
    />
  </svg>
);

const EyeSlashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={cn("w-4 h-4", className)}
  >
    <path
      fillRule="evenodd"
      d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z"
      clipRule="evenodd"
    />
    <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
  </svg>
);

// ============================================================================
// 类型定义
// ============================================================================

export interface ApiKeyListProps {
  /** API Key 列表 */
  apiKeys: ApiKeyDisplay[];
  /** Provider ID */
  providerId: string;
  /** Provider 显示名称 */
  providerName?: string;
  /** Provider API Host */
  apiHost?: string;
  /** 添加 API Key 回调 */
  onAdd?: (providerId: string, apiKey: string, alias?: string) => Promise<void>;
  /** 切换 API Key 启用状态回调 */
  onToggle?: (keyId: string, enabled: boolean) => void;
  /** 删除 API Key 回调 */
  onDelete?: (keyId: string) => void;
  /** 是否正在加载 */
  loading?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * API Key 列表组件
 *
 * 显示 Provider 的所有 API Key，并提供添加新 API Key 的功能。
 *
 * @example
 * ```tsx
 * <ApiKeyList
 *   apiKeys={provider.api_keys}
 *   providerId={provider.id}
 *   onAdd={addApiKey}
 *   onToggle={toggleApiKey}
 *   onDelete={deleteApiKey}
 * />
 * ```
 */
export const ApiKeyList: React.FC<ApiKeyListProps> = ({
  apiKeys,
  providerId,
  providerName,
  apiHost,
  onAdd,
  onToggle,
  onDelete,
  loading = false,
  className,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledCount = useMemo(
    () => apiKeys.filter((item) => item.enabled).length,
    [apiKeys],
  );

  const errorCount = useMemo(
    () => apiKeys.reduce((sum, item) => sum + item.error_count, 0),
    [apiKeys],
  );

  const latestUsedLabel = useMemo(() => {
    const latestUsedAt = apiKeys
      .map((item) => item.last_used_at)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

    if (!latestUsedAt) {
      return "暂无调用";
    }

    const diffMs = Date.now() - new Date(latestUsedAt).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 30) return `${diffDays} 天前`;
    return new Date(latestUsedAt).toLocaleDateString("zh-CN");
  }, [apiKeys]);

  const providerAccessHelp = useMemo(
    () =>
      getProviderAccessHelp({
        providerId,
        providerName,
        apiHost,
      }),
    [apiHost, providerId, providerName],
  );

  const handleAdd = async () => {
    if (!newApiKey.trim()) {
      setError("请输入 API Key");
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      await onAdd?.(providerId, newApiKey.trim(), newAlias.trim() || undefined);
      setNewApiKey("");
      setNewAlias("");
      setShowAddForm(false);
      setShowApiKey(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setIsAdding(false);
    }
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setNewApiKey("");
    setNewAlias("");
    setShowApiKey(false);
    setError(null);
  };

  return (
    <div
      className={cn(
        "rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5",
        className,
      )}
      data-testid="api-key-list"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-base font-semibold text-slate-900">API Key</h4>
          {providerAccessHelp.helpText || providerAccessHelp.keylessHint ? (
            <SectionInfoButton
              label="查看 API Key 获取说明"
              triggerTestId="provider-api-key-info-button"
              contentTestId="provider-api-key-info-content"
            >
              <p
                data-testid={
                  providerAccessHelp.keylessHint
                    ? "provider-api-key-keyless-hint"
                    : "provider-api-key-help-text"
                }
              >
                {providerAccessHelp.keylessHint ?? providerAccessHelp.helpText}
              </p>
              {providerAccessHelp.url ? (
                <a
                  href={providerAccessHelp.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex font-semibold text-slate-900 underline underline-offset-4"
                  data-testid="provider-api-key-help-link"
                >
                  前往获取
                </a>
              ) : null}
            </SectionInfoButton>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
            已启用 {enabledCount}
          </span>
          {apiKeys.length > 0 ? (
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              最近调用 {latestUsedLabel}
            </span>
          ) : null}
          {errorCount > 0 ? (
            <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700">
              错误 {errorCount}
            </span>
          ) : null}
          {!showAddForm && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
              disabled={loading}
              className="shrink-0 whitespace-nowrap border-slate-200 bg-white px-3"
              data-testid="add-api-key-button"
            >
              <PlusIcon className="mr-1" />
              新增 API Key
            </Button>
          )}
        </div>
      </div>

        {showAddForm ? (
          <div
            className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4"
            data-testid="add-api-key-form"
          >
            <div
              className="space-y-4"
              data-testid="add-api-key-fields-stack"
            >
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="new-api-key" className="text-xs font-medium">
                  API Key <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="new-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    placeholder="输入 API Key"
                    className="border-slate-200 bg-white pr-10"
                    disabled={isAdding}
                    autoComplete="new-password"
                    data-testid="new-api-key-input"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
                    onClick={() => setShowApiKey(!showApiKey)}
                    tabIndex={-1}
                  >
                    {showApiKey ? <EyeSlashIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="new-alias" className="text-xs font-medium">
                  别名（可选）
                </Label>
                <Input
                  id="new-alias"
                  type="text"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder="例如：生产主账号"
                  disabled={isAdding}
                  className="border-slate-200 bg-white"
                  autoComplete="off"
                  data-testid="new-alias-input"
                />
              </div>
            </div>

            {error ? (
              <p className="mt-3 text-xs text-red-500" data-testid="add-error">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={isAdding}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={isAdding || !newApiKey.trim()}
                data-testid="confirm-add-button"
              >
                {isAdding ? "添加中..." : "确认添加"}
              </Button>
            </div>
          </div>
        ) : null}

        {apiKeys.length > 0 ? (
          <div className="mt-4 space-y-3" data-testid="api-key-items">
            {apiKeys.map((apiKey) => (
              <ApiKeyItem
                key={apiKey.id}
                apiKey={apiKey}
                onToggle={onToggle}
                onDelete={onDelete}
                loading={loading}
                className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3 hover:bg-slate-100/80"
              />
            ))}
          </div>
        ) : (
          !showAddForm && (
            <div
              className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center"
              data-testid="empty-state"
            >
              <p className="text-sm font-medium text-slate-900">暂无 API Key</p>
              <p className="mt-1 text-xs text-slate-500">
                先新增第一把 Key，之后再做连接测试与模型刷新
              </p>
            </div>
          )
        )}
    </div>
  );
};

// ============================================================================
// 辅助函数（用于测试）
// ============================================================================

/**
 * 获取 API Key 列表的统计信息
 * 用于属性测试验证
 */
export function getApiKeyListStats(apiKeys: ApiKeyDisplay[]): {
  total: number;
  enabled: number;
  disabled: number;
  totalUsage: number;
  totalErrors: number;
} {
  return {
    total: apiKeys.length,
    enabled: apiKeys.filter((k) => k.enabled).length,
    disabled: apiKeys.filter((k) => !k.enabled).length,
    totalUsage: apiKeys.reduce((sum, k) => sum + k.usage_count, 0),
    totalErrors: apiKeys.reduce((sum, k) => sum + k.error_count, 0),
  };
}

export default ApiKeyList;
