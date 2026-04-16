/**
 * @file Connect 错误提示 Alert 组件
 * @description 提供 Lime Connect 功能的错误提示 Alert 组件
 * @module components/connect/ConnectErrorToast
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4_
 */

import { Button } from "@/components/ui/button";
import {
  type ConnectErrorType,
  getErrorConfig,
} from "@/lib/utils/connectError";

/**
 * ConnectErrorAlert 组件属性
 */
export interface ConnectErrorAlertProps {
  /** 错误类型 */
  type: ConnectErrorType;
  /** 错误消息 */
  message: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 关闭回调 */
  onDismiss?: () => void;
}

/**
 * Connect 错误提示 Alert 组件
 *
 * 用于在 UI 中内联显示错误信息，适用于需要持久显示的错误场景。
 *
 * @param props - 组件属性
 */
export function ConnectErrorAlert({
  type,
  message,
  onRetry,
  onDismiss,
}: ConnectErrorAlertProps) {
  const config = getErrorConfig(type, onRetry);

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-start gap-3">
        {/* 错误图标 */}
        <svg
          className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0"
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

        <div className="flex-1">
          <h4 className="font-medium text-red-800">{config.title}</h4>
          <p className="text-sm text-red-700 mt-1">
            {config.description(message)}
          </p>

          {/* 操作按钮 */}
          {(onRetry || onDismiss) && (
            <div className="flex gap-2 mt-3">
              {onRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="text-red-700 border-red-300 hover:bg-red-100"
                >
                  重试
                </Button>
              )}
              {onDismiss && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDismiss}
                  className="text-red-600 hover:bg-red-100"
                >
                  关闭
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
