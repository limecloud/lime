import { useState, useEffect } from "react";
import {
  AlertTriangle,
  X,
  RotateCcw,
  Trash2,
  Settings,
  CheckCircle2,
  KeyRound,
} from "lucide-react";

export interface ErrorInfo {
  id: string;
  message: string;
  type:
    | "delete"
    | "toggle"
    | "reset"
    | "health_check"
    | "refresh_token"
    | "migrate"
    | "config"
    | "general"
    | "success"
    | "reauth"; // 需要重新授权
  uuid?: string; // 相关凭证的UUID（如果有的话）
}

interface ErrorDisplayProps {
  errors: ErrorInfo[];
  onDismiss: (id: string) => void;
  onRetry?: (error: ErrorInfo) => void;
}

const ErrorTypeConfig = {
  delete: {
    icon: Trash2,
    color: "text-red-600",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
  },
  toggle: {
    icon: Settings,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
  },
  reset: {
    icon: RotateCcw,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
  },
  health_check: {
    icon: AlertTriangle,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
  },
  refresh_token: {
    icon: RotateCcw,
    color: "text-sky-600",
    bgColor: "bg-sky-50",
    borderColor: "border-sky-200",
  },
  migrate: {
    icon: AlertTriangle,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
  },
  config: {
    icon: Settings,
    color: "text-sky-600",
    bgColor: "bg-sky-50",
    borderColor: "border-sky-200",
  },
  general: {
    icon: AlertTriangle,
    color: "text-slate-600",
    bgColor: "bg-slate-50",
    borderColor: "border-slate-200",
  },
  success: {
    icon: CheckCircle2,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
  },
  reauth: {
    icon: KeyRound,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
  },
};

function ErrorItem({
  error,
  onDismiss,
  onRetry,
}: {
  error: ErrorInfo;
  onDismiss: (id: string) => void;
  onRetry?: (error: ErrorInfo) => void;
}) {
  const config = ErrorTypeConfig[error.type];
  const IconComponent = config.icon;

  return (
    <div
      className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}
    >
      <div className="flex items-start gap-3">
        <IconComponent className={`h-5 w-5 mt-0.5 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground leading-relaxed whitespace-pre-line">
            {error.message}
          </div>
          <div className="flex items-center gap-2 mt-3">
            {onRetry && (
              <button
                onClick={() => onRetry(error)}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <RotateCcw className="h-3 w-3" />
                重试
              </button>
            )}
            <button
              onClick={() => onDismiss(error.id)}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <X className="h-3 w-3" />
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ErrorDisplay({
  errors,
  onDismiss,
  onRetry,
}: ErrorDisplayProps) {
  // 自动关闭通知
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    errors.forEach((error) => {
      // 成功消息 3 秒后自动关闭，其他类型 15 秒后自动关闭
      if (error.type === "success") {
        const timer = setTimeout(() => {
          onDismiss(error.id);
        }, 3000); // 3秒后自动关闭
        timers.push(timer);
      } else if (error.type === "general" || error.message.includes("💡")) {
        const timer = setTimeout(() => {
          onDismiss(error.id);
        }, 15000); // 15秒后自动关闭
        timers.push(timer);
      }
    });

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [errors, onDismiss]);

  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 w-96 max-w-full">
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {errors.map((error) => (
          <ErrorItem
            key={error.id}
            error={error}
            onDismiss={onDismiss}
            onRetry={onRetry}
          />
        ))}
      </div>
    </div>
  );
}

// Hook for managing errors and success messages
// eslint-disable-next-line react-refresh/only-export-components
export function useErrorDisplay() {
  const [errors, setErrors] = useState<ErrorInfo[]>([]);

  const showError = (
    message: string,
    type: ErrorInfo["type"] = "general",
    uuid?: string,
  ) => {
    // 检查是否已经存在相同的错误消息（基于 message, type, uuid 的组合）
    setErrors((prev) => {
      const isDuplicate = prev.some(
        (existing) =>
          existing.message === message &&
          existing.type === type &&
          existing.uuid === uuid,
      );

      if (isDuplicate) {
        return prev; // 如果重复，不添加新的错误
      }

      const id =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);
      const error: ErrorInfo = { id, message, type, uuid };
      return [...prev, error];
    });
  };

  const showSuccess = (message: string, uuid?: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const info: ErrorInfo = { id, message, type: "success", uuid };
    setErrors((prev) => [...prev, info]);
  };

  const dismissError = (id: string) => {
    setErrors((prev) => prev.filter((error) => error.id !== id));
  };

  const clearErrors = () => {
    setErrors([]);
  };

  return {
    errors,
    showError,
    showSuccess,
    dismissError,
    clearErrors,
  };
}
