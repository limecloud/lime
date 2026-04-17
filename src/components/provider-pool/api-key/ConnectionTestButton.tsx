/**
 * @file ConnectionTestButton 组件
 * @description 连接测试按钮组件，用于测试 Provider API 连接
 * @module components/provider-pool/api-key/ConnectionTestButton
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 4.3, 4.4**
 */

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ============================================================================
// 图标组件
// ============================================================================

const CheckCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={cn("w-4 h-4", className)}
  >
    <path
      fillRule="evenodd"
      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
      clipRule="evenodd"
    />
  </svg>
);

const XCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={cn("w-4 h-4", className)}
  >
    <path
      fillRule="evenodd"
      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
      clipRule="evenodd"
    />
  </svg>
);

const LoadingIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    className={cn("w-4 h-4 animate-spin", className)}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 3a7 7 0 107 7"
    />
  </svg>
);

const SignalIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={cn("w-4 h-4", className)}
  >
    <path d="M16.364 3.636a.75.75 0 00-1.06 1.06 7.5 7.5 0 010 10.607.75.75 0 001.06 1.061 9 9 0 000-12.728zM4.697 4.697a.75.75 0 00-1.061-1.06 9 9 0 000 12.727.75.75 0 101.06-1.06 7.5 7.5 0 010-10.607z" />
    <path d="M12.475 6.465a.75.75 0 011.06 0 6 6 0 010 8.49.75.75 0 01-1.06-1.06 4.5 4.5 0 000-6.37.75.75 0 010-1.06zM7.525 6.465a.75.75 0 010 1.06 4.5 4.5 0 000 6.37.75.75 0 01-1.06 1.06 6 6 0 010-8.49.75.75 0 011.06 0zM10 9a1 1 0 100 2 1 1 0 000-2z" />
  </svg>
);

// ============================================================================
// 类型定义
// ============================================================================

export type ConnectionTestStatus = "idle" | "testing" | "success" | "error";

export interface ConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
  models?: string[];
}

export interface ConnectionTestButtonProps {
  /** Provider ID */
  providerId: string;
  /** 测试连接回调 */
  onTest?: (providerId: string) => Promise<ConnectionTestResult>;
  /** 是否禁用 */
  disabled?: boolean;
  /** 额外的 CSS 类名 */
  className?: string;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * 连接测试按钮组件
 *
 * 用于测试 Provider API 连接，显示测试状态和结果。
 *
 * @example
 * ```tsx
 * <ConnectionTestButton
 *   providerId={provider.id}
 *   onTest={testConnection}
 * />
 * ```
 */
export const ConnectionTestButton: React.FC<ConnectionTestButtonProps> = ({
  providerId,
  onTest,
  disabled = false,
  className,
}) => {
  const [status, setStatus] = useState<ConnectionTestStatus>("idle");
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const handleTest = async () => {
    if (!onTest || status === "testing") return;

    setStatus("testing");
    setResult(null);

    try {
      const testResult = await onTest(providerId);
      setResult(testResult);
      setStatus(testResult.success ? "success" : "error");
    } catch (e) {
      setResult({
        success: false,
        error: e instanceof Error ? e.message : "连接测试失败",
      });
      setStatus("error");
    }
  };

  // 渲染状态图标
  const renderStatusIcon = () => {
    switch (status) {
      case "testing":
        return <LoadingIcon className="text-sky-500" />;
      case "success":
        return <CheckCircleIcon className="text-green-500" />;
      case "error":
        return <XCircleIcon className="text-red-500" />;
      default:
        return <SignalIcon />;
    }
  };

  // 渲染按钮文本
  const renderButtonText = () => {
    switch (status) {
      case "testing":
        return "测试中...";
      case "success":
        return result?.latencyMs ? `成功 (${result.latencyMs}ms)` : "连接成功";
      case "error":
        return "连接失败";
      default:
        return "检查连接";
    }
  };

  // 获取按钮变体
  const getButtonVariant = (): "default" | "outline" | "destructive" => {
    switch (status) {
      case "success":
        return "outline";
      case "error":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <div className={cn("space-y-2", className)} data-testid="connection-test">
      {/* 测试按钮 */}
      <Button
        variant={getButtonVariant()}
        size="sm"
        onClick={handleTest}
        disabled={disabled || status === "testing"}
        className={cn(
          "w-full",
          status === "success" &&
            "border-green-500 text-green-600 hover:bg-green-50",
          status === "error" && "border-red-500",
        )}
        data-testid="connection-test-button"
        data-status={status}
      >
        {renderStatusIcon()}
        <span className="ml-2">{renderButtonText()}</span>
      </Button>

      {/* 错误信息 */}
      {status === "error" && result?.error && (
        <div
          className="p-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-600"
          data-testid="connection-error"
        >
          <p className="font-medium">错误详情：</p>
          <p className="mt-1 break-all">{result.error}</p>
        </div>
      )}

      {/* 成功信息（显示可用模型） */}
      {status === "success" && result?.models && result.models.length > 0 && (
        <div
          className="p-2 rounded-md bg-green-50 border border-green-200 text-xs text-green-600"
          data-testid="connection-success"
        >
          <p className="font-medium">可用模型 ({result.models.length})：</p>
          <p className="mt-1 truncate">
            {result.models.slice(0, 5).join(", ")}
          </p>
          {result.models.length > 5 && (
            <p className="text-green-500">
              ...还有 {result.models.length - 5} 个
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 辅助函数（用于测试）
// ============================================================================

/**
 * 获取连接测试状态的显示信息
 */
export function getConnectionTestStatusInfo(status: ConnectionTestStatus): {
  isIdle: boolean;
  isTesting: boolean;
  isSuccess: boolean;
  isError: boolean;
} {
  return {
    isIdle: status === "idle",
    isTesting: status === "testing",
    isSuccess: status === "success",
    isError: status === "error",
  };
}

export default ConnectionTestButton;
