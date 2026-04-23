/**
 * @file ShortcutSettings.tsx
 * @description 快捷键设置组件 - 显示当前快捷键、支持录制模式和保存/取消
 * @module components/smart-input/ShortcutSettings
 *
 * 需求: 6.3, 6.4 - 显示当前快捷键和修改按钮，支持快捷键录制模式
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Keyboard, Check, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// 类型定义
// ============================================================

export interface ShortcutSettingsProps {
  /** 当前快捷键 */
  currentShortcut: string;
  /** 快捷键变更回调 */
  onShortcutChange: (shortcut: string) => Promise<void>;
  /** 验证快捷键回调 */
  onValidate?: (shortcut: string) => Promise<boolean>;
  /** 是否禁用 */
  disabled?: boolean;
  /** 空值占位文案 */
  emptyLabel?: string;
  /** 是否允许直接清空 */
  allowClear?: boolean;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 将 KeyboardEvent 转换为 Tauri 快捷键格式
 */
function keyEventToShortcut(e: KeyboardEvent): string | null {
  const modifiers: string[] = [];

  // 收集修饰键
  if (e.metaKey || e.ctrlKey) {
    modifiers.push("CommandOrControl");
  }
  if (e.altKey) {
    modifiers.push("Alt");
  }
  if (e.shiftKey) {
    modifiers.push("Shift");
  }

  // 获取主键
  let key = e.key;

  // 忽略单独的修饰键
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) {
    return null;
  }

  // 转换特殊键名
  const keyMap: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Escape",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Tab: "Tab",
  };

  if (keyMap[key]) {
    key = keyMap[key];
  } else if (key.length === 1) {
    // 单字符键转大写
    key = key.toUpperCase();
  } else if (key.startsWith("F") && /^F\d+$/.test(key)) {
    // 功能键保持原样
  } else {
    // 其他键首字母大写
    key = key.charAt(0).toUpperCase() + key.slice(1);
  }

  // 必须有至少一个修饰键
  if (modifiers.length === 0) {
    return null;
  }

  return [...modifiers, key].join("+");
}

/**
 * 格式化快捷键显示（将 Tauri 格式转换为用户友好格式）
 */
function formatShortcutDisplay(shortcut: string): string {
  return shortcut
    .replace(
      "CommandOrControl",
      navigator.platform.includes("Mac") ? "⌘" : "Ctrl",
    )
    .replace("Shift", navigator.platform.includes("Mac") ? "⇧" : "Shift")
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace(/\+/g, " + ");
}

// ============================================================
// 组件
// ============================================================

export function ShortcutSettings({
  currentShortcut,
  onShortcutChange,
  onValidate,
  disabled = false,
  emptyLabel = "未设置快捷键",
  allowClear = false,
}: ShortcutSettingsProps) {
  // 状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordedShortcut, setRecordedShortcut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Refs
  const inputRef = useRef<HTMLDivElement>(null);

  // 开始录制
  const startRecording = useCallback(() => {
    if (disabled) return;
    setIsRecording(true);
    setRecordedShortcut(null);
    setError(null);
  }, [disabled]);

  // 取消录制
  const cancelRecording = useCallback(() => {
    setIsRecording(false);
    setRecordedShortcut(null);
    setError(null);
  }, []);

  const clearShortcut = useCallback(async () => {
    if (!allowClear || !currentShortcut || disabled) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onShortcutChange("");
      setRecordedShortcut(null);
      setIsRecording(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空失败");
    } finally {
      setIsSaving(false);
    }
  }, [allowClear, currentShortcut, disabled, onShortcutChange]);

  // 保存快捷键
  const saveShortcut = useCallback(async () => {
    if (!recordedShortcut) return;

    setIsSaving(true);
    setError(null);

    try {
      // 验证快捷键
      if (onValidate) {
        const isValid = await onValidate(recordedShortcut);
        if (!isValid) {
          setError("快捷键格式无效");
          setIsSaving(false);
          return;
        }
      }

      // 保存快捷键
      await onShortcutChange(recordedShortcut);
      setIsRecording(false);
      setRecordedShortcut(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [recordedShortcut, onShortcutChange, onValidate]);

  // 键盘事件处理
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // ESC 取消录制
      if (e.key === "Escape") {
        cancelRecording();
        return;
      }

      const shortcut = keyEventToShortcut(e);
      if (shortcut) {
        setRecordedShortcut(shortcut);
        setError(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isRecording, cancelRecording]);

  // 自动聚焦录制区域
  useEffect(() => {
    if (isRecording && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isRecording]);

  // 显示的快捷键
  const displayShortcut = recordedShortcut || currentShortcut;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Keyboard className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">快捷键</span>
      </div>

      <div className="flex items-center gap-2">
        {/* 快捷键显示/录制区域 */}
        <div
          ref={inputRef}
          tabIndex={isRecording ? 0 : -1}
          className={cn(
            "flex-1 px-3 py-2 rounded border text-sm font-mono transition-colors",
            isRecording
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "bg-muted/50",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {isRecording ? (
            <span className="text-muted-foreground">
              {recordedShortcut
                ? formatShortcutDisplay(recordedShortcut)
                : "按下快捷键组合..."}
            </span>
          ) : displayShortcut ? (
            <span>{formatShortcutDisplay(displayShortcut)}</span>
          ) : (
            <span className="text-muted-foreground">{emptyLabel}</span>
          )}
        </div>

        {/* 操作按钮 */}
        {isRecording ? (
          <>
            <button
              onClick={saveShortcut}
              disabled={!recordedShortcut || isSaving}
              className={cn(
                "p-2 rounded transition-colors",
                recordedShortcut && !isSaving
                  ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                  : "text-muted-foreground opacity-50 cursor-not-allowed",
              )}
              title="保存"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={cancelRecording}
              disabled={isSaving}
              className="p-2 rounded text-muted-foreground hover:bg-muted transition-colors"
              title="取消"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            {allowClear && currentShortcut ? (
              <button
                onClick={clearShortcut}
                disabled={disabled || isSaving}
                className={cn(
                  "px-3 py-2 rounded border text-sm transition-colors",
                  disabled || isSaving
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:bg-muted",
                )}
                title="清空"
              >
                清空
              </button>
            ) : null}
            <button
              onClick={startRecording}
              disabled={disabled}
              className={cn(
                "px-3 py-2 rounded border text-sm transition-colors",
                disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted",
              )}
            >
              修改
            </button>
          </>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          <span>{error}</span>
        </div>
      )}

      {/* 录制提示 */}
      {isRecording && !error && (
        <p className="text-xs text-muted-foreground">
          按下想要设置的快捷键组合，按 ESC 取消
        </p>
      )}
    </div>
  );
}

export default ShortcutSettings;
