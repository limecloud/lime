/**
 * @file InstructionEditor.tsx
 * @description 自定义指令编辑器组件 - 管理语音输入的处理指令
 * @module components/voice/InstructionEditor
 *
 * 需求: 5.2-5.5
 * - 5.2: 用户应能创建自定义指令
 * - 5.3: 自定义指令应包含：名称、Prompt 模板、快捷键（可选）
 * - 5.4: 用户应能为不同指令设置独立的快捷键
 * - 5.5: 悬浮窗应显示当前激活的指令模式
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Keyboard,
  Check,
  X,
  AlertCircle,
  Sparkles,
  MessageSquare,
  Languages,
  Terminal,
  Mail,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoiceInstruction } from "./types";
import {
  getVoiceInstructions,
  saveVoiceInstruction,
  deleteVoiceInstruction,
} from "./types";

// ============================================================
// 类型定义
// ============================================================

interface InstructionEditorProps {
  /** 当前默认指令 ID */
  defaultInstructionId?: string;
  /** 默认指令变更回调 */
  onDefaultChange?: (id: string) => void;
  /** 指令列表变更回调 */
  onInstructionsChange?: (instructions: VoiceInstruction[]) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

interface EditingInstruction {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  shortcut: string;
  icon: string;
  isPreset: boolean;
}

// ============================================================
// 辅助函数
// ============================================================

/** 预设指令图标映射 */
const PRESET_ICONS: Record<string, React.ReactNode> = {
  default: <MessageSquare className="h-4 w-4" />,
  "translate-en": <Languages className="h-4 w-4" />,
  "translate-zh": <Languages className="h-4 w-4" />,
  command: <Terminal className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  professional: <FileText className="h-4 w-4" />,
};

/** 获取指令图标 */
function getInstructionIcon(instruction: VoiceInstruction): React.ReactNode {
  if (instruction.icon && PRESET_ICONS[instruction.icon]) {
    return PRESET_ICONS[instruction.icon];
  }
  if (PRESET_ICONS[instruction.id]) {
    return PRESET_ICONS[instruction.id];
  }
  return <Sparkles className="h-4 w-4" />;
}

/**
 * 将 KeyboardEvent 转换为 Tauri 快捷键格式
 */
function keyEventToShortcut(e: KeyboardEvent): string | null {
  const modifiers: string[] = [];

  if (e.metaKey || e.ctrlKey) {
    modifiers.push("CommandOrControl");
  }
  if (e.altKey) {
    modifiers.push("Alt");
  }
  if (e.shiftKey) {
    modifiers.push("Shift");
  }

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
    key = key.toUpperCase();
  } else if (key.startsWith("F") && /^F\d+$/.test(key)) {
    // 功能键保持原样
  } else {
    key = key.charAt(0).toUpperCase() + key.slice(1);
  }

  // 必须有至少一个修饰键
  if (modifiers.length === 0) {
    return null;
  }

  return [...modifiers, key].join("+");
}

/**
 * 格式化快捷键显示
 */
function formatShortcutDisplay(shortcut: string): string {
  if (!shortcut) return "";
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
// 子组件：快捷键录制器
// ============================================================

interface ShortcutRecorderProps {
  value: string;
  onChange: (shortcut: string) => void;
  disabled?: boolean;
}

function ShortcutRecorder({
  value,
  onChange,
  disabled,
}: ShortcutRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setIsRecording(false);
        return;
      }

      // Backspace 清除快捷键
      if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        onChange("");
        setIsRecording(false);
        return;
      }

      const shortcut = keyEventToShortcut(e);
      if (shortcut) {
        onChange(shortcut);
        setIsRecording(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isRecording, onChange]);

  useEffect(() => {
    if (isRecording && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isRecording]);

  return (
    <div className="flex items-center gap-2">
      <div
        ref={inputRef}
        tabIndex={isRecording ? 0 : -1}
        onClick={() => !disabled && setIsRecording(true)}
        className={cn(
          "flex-1 px-3 py-2 rounded border text-sm font-mono cursor-pointer transition-colors",
          isRecording
            ? "border-primary bg-primary/5 ring-2 ring-primary/20"
            : "bg-muted/50 hover:border-primary/50",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {isRecording ? (
          <span className="text-muted-foreground">按下快捷键...</span>
        ) : value ? (
          <span>{formatShortcutDisplay(value)}</span>
        ) : (
          <span className="text-muted-foreground">点击设置快捷键</span>
        )}
      </div>
      {value && !isRecording && (
        <button
          onClick={() => onChange("")}
          disabled={disabled}
          className="p-2 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="清除快捷键"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {isRecording && (
        <button
          onClick={() => setIsRecording(false)}
          className="p-2 rounded text-muted-foreground hover:bg-muted"
          title="取消"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ============================================================
// 子组件：指令卡片
// ============================================================

interface InstructionCardProps {
  instruction: VoiceInstruction;
  isDefault: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  disabled?: boolean;
}

function InstructionCard({
  instruction,
  isDefault,
  onEdit,
  onDelete,
  onSetDefault,
  disabled,
}: InstructionCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        isDefault
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-primary/50",
      )}
    >
      <div className="flex items-start justify-between">
        {/* 左侧：图标和信息 */}
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "rounded-lg p-2",
              isDefault
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {getInstructionIcon(instruction)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{instruction.name}</span>
              {instruction.is_preset && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  预设
                </span>
              )}
              {isDefault && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  默认
                </span>
              )}
            </div>
            {instruction.description && (
              <p className="mt-1 text-sm text-muted-foreground truncate">
                {instruction.description}
              </p>
            )}
            {instruction.shortcut && (
              <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Keyboard className="h-3 w-3" />
                <span className="font-mono">
                  {formatShortcutDisplay(instruction.shortcut)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：操作按钮 */}
        <div className="flex items-center gap-1">
          {!isDefault && (
            <button
              onClick={onSetDefault}
              disabled={disabled}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              title="设为默认"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onEdit}
            disabled={disabled}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="编辑"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {!instruction.is_preset && (
            <button
              onClick={onDelete}
              disabled={disabled}
              className="rounded-lg p-2 text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 disabled:opacity-50"
              title="删除"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Prompt 预览 */}
      <div className="mt-3 rounded bg-muted/50 p-2 text-xs text-muted-foreground">
        <span className="font-medium">Prompt: </span>
        <span className="line-clamp-2">{instruction.prompt}</span>
      </div>
    </div>
  );
}

// ============================================================
// 子组件：编辑表单
// ============================================================

interface EditFormProps {
  instruction: EditingInstruction;
  onChange: (instruction: EditingInstruction) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

function EditForm({
  instruction,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: EditFormProps) {
  const isNew = !instruction.id;
  const isValid = instruction.name.trim() && instruction.prompt.trim();

  return (
    <div className="rounded-lg border border-primary bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">
          {isNew ? "添加指令" : instruction.isPreset ? "查看指令" : "编辑指令"}
        </h4>
        <button
          onClick={onCancel}
          className="rounded-lg p-1 hover:bg-muted"
          title="取消"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 名称 */}
      <div>
        <label className="block text-sm font-medium mb-1">名称</label>
        <input
          type="text"
          value={instruction.name}
          onChange={(e) => onChange({ ...instruction, name: e.target.value })}
          disabled={instruction.isPreset}
          placeholder="指令名称"
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      {/* 描述 */}
      <div>
        <label className="block text-sm font-medium mb-1">描述（可选）</label>
        <input
          type="text"
          value={instruction.description}
          onChange={(e) =>
            onChange({ ...instruction, description: e.target.value })
          }
          disabled={instruction.isPreset}
          placeholder="简短描述"
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-50"
        />
      </div>

      {/* Prompt 模板 */}
      <div>
        <label className="block text-sm font-medium mb-1">Prompt 模板</label>
        <textarea
          value={instruction.prompt}
          onChange={(e) => onChange({ ...instruction, prompt: e.target.value })}
          disabled={instruction.isPreset}
          placeholder="输入 AI 润色的 Prompt 模板..."
          rows={4}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          AI 将使用此 Prompt 对语音识别结果进行润色处理
        </p>
      </div>

      {/* 快捷键 */}
      <div>
        <label className="block text-sm font-medium mb-1">快捷键（可选）</label>
        <ShortcutRecorder
          value={instruction.shortcut}
          onChange={(shortcut) => onChange({ ...instruction, shortcut })}
          disabled={instruction.isPreset}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          设置快捷键可快速切换到此指令模式
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
        >
          取消
        </button>
        {!instruction.isPreset && (
          <button
            onClick={onSave}
            disabled={!isValid || saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "保存中..." : isNew ? "添加" : "保存"}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export function InstructionEditor({
  defaultInstructionId,
  onDefaultChange,
  onInstructionsChange,
  disabled = false,
}: InstructionEditorProps) {
  // 状态
  const [instructions, setInstructions] = useState<VoiceInstruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingInstruction, setEditingInstruction] =
    useState<EditingInstruction | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 加载指令列表
  const loadInstructions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getVoiceInstructions();
      setInstructions(list);
      onInstructionsChange?.(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [onInstructionsChange]);

  useEffect(() => {
    loadInstructions();
  }, [loadInstructions]);

  // 开始添加新指令
  const handleAdd = useCallback(() => {
    setEditingInstruction({
      name: "",
      description: "",
      prompt: "",
      shortcut: "",
      icon: "",
      isPreset: false,
    });
    setSaveError(null);
  }, []);

  // 开始编辑指令
  const handleEdit = useCallback((instruction: VoiceInstruction) => {
    setEditingInstruction({
      id: instruction.id,
      name: instruction.name,
      description: instruction.description || "",
      prompt: instruction.prompt,
      shortcut: instruction.shortcut || "",
      icon: instruction.icon || "",
      isPreset: instruction.is_preset,
    });
    setSaveError(null);
  }, []);

  // 取消编辑
  const handleCancel = useCallback(() => {
    setEditingInstruction(null);
    setSaveError(null);
  }, []);

  // 保存指令
  const handleSave = useCallback(async () => {
    if (!editingInstruction) return;

    setSaving(true);
    setSaveError(null);

    try {
      const instruction: VoiceInstruction = {
        id: editingInstruction.id || `custom-${Date.now()}`,
        name: editingInstruction.name.trim(),
        description: editingInstruction.description.trim() || undefined,
        prompt: editingInstruction.prompt.trim(),
        shortcut: editingInstruction.shortcut || undefined,
        is_preset: false,
        icon: editingInstruction.icon || undefined,
      };

      await saveVoiceInstruction(instruction);
      await loadInstructions();
      setEditingInstruction(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [editingInstruction, loadInstructions]);

  // 删除指令
  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("确定要删除此指令吗？")) return;

      try {
        await deleteVoiceInstruction(id);
        await loadInstructions();
      } catch (e) {
        setError(e instanceof Error ? e.message : "删除失败");
      }
    },
    [loadInstructions],
  );

  // 设为默认
  const handleSetDefault = useCallback(
    (id: string) => {
      onDefaultChange?.(id);
    },
    [onDefaultChange],
  );

  // 分离预设和自定义指令
  const presetInstructions = instructions.filter((i) => i.is_preset);
  const customInstructions = instructions.filter((i) => !i.is_preset);

  // 渲染
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span>{error}</span>
        <button
          onClick={loadInstructions}
          className="ml-auto text-red-600 hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 标题和添加按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">自定义指令</h3>
          <p className="text-sm text-muted-foreground">
            管理语音输入的 AI 润色指令
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={disabled || !!editingInstruction}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          添加指令
        </button>
      </div>

      {/* 编辑表单 */}
      {editingInstruction && (
        <EditForm
          instruction={editingInstruction}
          onChange={setEditingInstruction}
          onSave={handleSave}
          onCancel={handleCancel}
          saving={saving}
          error={saveError}
        />
      )}

      {/* 预设指令 */}
      {presetInstructions.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            预设指令
          </h4>
          <div className="space-y-2">
            {presetInstructions.map((instruction) => (
              <InstructionCard
                key={instruction.id}
                instruction={instruction}
                isDefault={instruction.id === defaultInstructionId}
                onEdit={() => handleEdit(instruction)}
                onDelete={() => {}}
                onSetDefault={() => handleSetDefault(instruction.id)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      )}

      {/* 自定义指令 */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">
          自定义指令
        </h4>
        {customInstructions.length > 0 ? (
          <div className="space-y-2">
            {customInstructions.map((instruction) => (
              <InstructionCard
                key={instruction.id}
                instruction={instruction}
                isDefault={instruction.id === defaultInstructionId}
                onEdit={() => handleEdit(instruction)}
                onDelete={() => handleDelete(instruction.id)}
                onSetDefault={() => handleSetDefault(instruction.id)}
                disabled={disabled}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              还没有自定义指令
            </p>
            <button
              onClick={handleAdd}
              disabled={disabled || !!editingInstruction}
              className="mt-3 text-sm text-primary hover:underline disabled:opacity-50"
            >
              创建第一个指令
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default InstructionEditor;
