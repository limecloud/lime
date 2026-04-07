/**
 * @file VoiceSettings.tsx
 * @description 语音输入设置组件 - 在实验室设置中显示
 * @module components/voice/VoiceSettings
 */

import { useState, useCallback } from "react";
import {
  Mic,
  AlertTriangle,
  Settings2,
  Sparkles,
  Volume2,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ShortcutSettings } from "@/components/smart-input/ShortcutSettings";
import { VoiceInputConfig } from "@/lib/api/asrProvider";
import { MicrophoneTest } from "./MicrophoneTest";
import { PolishModelSelector } from "./PolishModelSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface VoiceSettingsProps {
  config: VoiceInputConfig;
  onConfigChange: (config: VoiceInputConfig) => Promise<void>;
  onValidateShortcut: (shortcut: string) => Promise<boolean>;
  disabled?: boolean;
}

export function VoiceSettings({
  config,
  onConfigChange,
  onValidateShortcut,
  disabled = false,
}: VoiceSettingsProps) {
  const [saving, setSaving] = useState(false);
  const isMacOS = navigator.userAgent.includes("Mac");

  // 切换功能开关
  const handleToggle = useCallback(async () => {
    if (disabled || saving) return;
    setSaving(true);
    try {
      await onConfigChange({
        ...config,
        enabled: !config.enabled,
      });
    } finally {
      setSaving(false);
    }
  }, [config, onConfigChange, disabled, saving]);

  // 更新快捷键
  const handleShortcutChange = useCallback(
    async (newShortcut: string) => {
      if (disabled || saving) return;
      setSaving(true);
      try {
        await onConfigChange({
          ...config,
          shortcut: newShortcut,
        });
      } finally {
        setSaving(false);
      }
    },
    [config, onConfigChange, disabled, saving],
  );

  // 切换 AI 润色
  const handleTogglePolish = useCallback(async () => {
    if (disabled || saving) return;
    setSaving(true);
    try {
      await onConfigChange({
        ...config,
        processor: {
          ...config.processor,
          polish_enabled: !config.processor.polish_enabled,
        },
      });
    } finally {
      setSaving(false);
    }
  }, [config, onConfigChange, disabled, saving]);

  // 切换音效
  const handleToggleSound = useCallback(async () => {
    if (disabled || saving) return;
    setSaving(true);
    try {
      await onConfigChange({
        ...config,
        sound_enabled: !config.sound_enabled,
      });
    } finally {
      setSaving(false);
    }
  }, [config, onConfigChange, disabled, saving]);

  // 更新润色模型
  const handlePolishModelChange = useCallback(
    async (modelId: string) => {
      if (disabled || saving) return;
      setSaving(true);
      try {
        await onConfigChange({
          ...config,
          processor: {
            ...config.processor,
            polish_model: modelId,
          },
        });
      } finally {
        setSaving(false);
      }
    },
    [config, onConfigChange, disabled, saving],
  );

  // 更新翻译快捷键
  const handleTranslateShortcutChange = useCallback(
    async (newShortcut: string) => {
      if (disabled || saving) return;
      setSaving(true);
      try {
        await onConfigChange({
          ...config,
          translate_shortcut: newShortcut || undefined,
        });
      } finally {
        setSaving(false);
      }
    },
    [config, onConfigChange, disabled, saving],
  );

  // 更新翻译指令
  const handleTranslateInstructionChange = useCallback(
    async (instructionId: string) => {
      if (disabled || saving) return;
      setSaving(true);
      try {
        await onConfigChange({
          ...config,
          translate_instruction_id: instructionId,
        });
      } finally {
        setSaving(false);
      }
    },
    [config, onConfigChange, disabled, saving],
  );

  // 更新麦克风设备
  const handleDeviceChange = useCallback(
    async (deviceId: string | undefined) => {
      if (disabled || saving) return;
      setSaving(true);
      try {
        await onConfigChange({
          ...config,
          selected_device_id: deviceId,
        });
      } finally {
        setSaving(false);
      }
    },
    [config, onConfigChange, disabled, saving],
  );

  return (
    <div className="space-y-4">
      {/* 标题和开关 */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Mic className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h4 className="text-sm font-medium">语音输入</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              使用全局快捷键进行语音输入，支持 AI 润色
            </p>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
            disabled={disabled || saving}
            className="sr-only peer"
          />
          <div
            className={cn(
              "w-9 h-5 rounded-full transition-colors",
              "bg-muted peer-checked:bg-primary",
              "after:content-[''] after:absolute after:top-0.5 after:left-0.5",
              "after:bg-white after:rounded-full after:h-4 after:w-4",
              "after:transition-transform peer-checked:after:translate-x-4",
              (disabled || saving) && "opacity-50 cursor-not-allowed",
            )}
          />
        </label>
      </div>

      {/* 功能启用时显示详细设置 */}
      {config.enabled && (
        <>
          {/* 快捷键设置 */}
          <div className="pt-3 border-t">
            <ShortcutSettings
              currentShortcut={config.shortcut}
              onShortcutChange={handleShortcutChange}
              onValidate={onValidateShortcut}
              disabled={disabled || saving}
            />
          </div>

          {/* 麦克风设备选择和测试 */}
          <div className="pt-3 border-t">
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2">
                <Mic className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">麦克风设备</span>
              </div>
              <MicrophoneTest
                selectedDeviceId={config.selected_device_id}
                onDeviceChange={handleDeviceChange}
                disabled={disabled || saving}
              />
            </div>
          </div>

          {/* AI 润色设置 */}
          <div className="pt-3 border-t">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm">AI 润色</span>
                  <p className="text-xs text-muted-foreground">
                    自动去除语气词、添加标点、修正语法
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.processor.polish_enabled}
                  onChange={handleTogglePolish}
                  disabled={disabled || saving}
                  className="sr-only peer"
                />
                <div
                  className={cn(
                    "w-9 h-5 rounded-full transition-colors",
                    "bg-muted peer-checked:bg-primary",
                    "after:content-[''] after:absolute after:top-0.5 after:left-0.5",
                    "after:bg-white after:rounded-full after:h-4 after:w-4",
                    "after:transition-transform peer-checked:after:translate-x-4",
                    (disabled || saving) && "opacity-50 cursor-not-allowed",
                  )}
                />
              </label>
            </div>

            {/* 润色模型选择 - 仅在启用润色时显示 */}
            {config.processor.polish_enabled && (
              <div className="mt-3">
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  润色模型
                </label>
                <PolishModelSelector
                  value={config.processor.polish_model}
                  onChange={handlePolishModelChange}
                  disabled={disabled || saving}
                />
              </div>
            )}
          </div>

          {/* 交互音效设置 */}
          <div className="pt-3 border-t">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm">交互音效</span>
                  <p className="text-xs text-muted-foreground">
                    录音开始和停止时播放提示音
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.sound_enabled}
                  onChange={handleToggleSound}
                  disabled={disabled || saving}
                  className="sr-only peer"
                />
                <div
                  className={cn(
                    "w-9 h-5 rounded-full transition-colors",
                    "bg-muted peer-checked:bg-primary",
                    "after:content-[''] after:absolute after:top-0.5 after:left-0.5",
                    "after:bg-white after:rounded-full after:h-4 after:w-4",
                    "after:transition-transform peer-checked:after:translate-x-4",
                    (disabled || saving) && "opacity-50 cursor-not-allowed",
                  )}
                />
              </label>
            </div>
          </div>

          {/* 翻译模式快捷键设置 */}
          <div className="pt-3 border-t">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-sm font-medium">翻译模式</span>
                <p className="text-xs text-muted-foreground">
                  设置独立快捷键，语音识别后自动翻译
                </p>
              </div>
            </div>

            {/* 翻译快捷键 */}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  翻译快捷键（可选）
                </label>
                <ShortcutSettings
                  currentShortcut={config.translate_shortcut || ""}
                  onShortcutChange={handleTranslateShortcutChange}
                  onValidate={onValidateShortcut}
                  disabled={disabled || saving}
                />
              </div>

              {/* 翻译指令选择 */}
              {config.translate_shortcut && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    翻译指令
                  </label>
                  <Select
                    value={config.translate_instruction_id}
                    onValueChange={handleTranslateInstructionChange}
                    disabled={disabled || saving}
                  >
                    <SelectTrigger className="w-full h-8 text-sm">
                      <SelectValue placeholder="选择翻译指令" />
                    </SelectTrigger>
                    <SelectContent>
                      {config.instructions.map((instruction) => (
                        <SelectItem key={instruction.id} value={instruction.id}>
                          {instruction.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* ASR 服务管理入口 */}
          <div className="pt-3 border-t">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">语音识别服务</span>
              </div>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  // TODO: 导航到凭证池页面的语音服务标签
                }}
                className="text-xs text-primary hover:underline"
              >
                管理 ASR 凭证
              </a>
            </div>
          </div>

          {/* macOS 麦克风权限警告 */}
          {isMacOS && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  需要麦克风权限
                </p>
                <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                  语音输入功能需要麦克风权限才能正常工作。
                </p>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      // 使用 Command.create 执行 open 命令打开系统偏好设置
                      const { Command } =
                        await import("@tauri-apps/plugin-shell");
                      const cmd = Command.create("open", [
                        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
                      ]);
                      const output = await cmd.execute();
                      if (output.code !== 0) {
                        console.error("打开系统设置失败:", output.stderr);
                      }
                    } catch (err) {
                      console.error("打开系统设置失败:", err);
                    }
                  }}
                  className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors cursor-pointer"
                >
                  打开系统设置
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default VoiceSettings;
