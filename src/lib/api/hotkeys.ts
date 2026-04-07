/**
 * @file hotkeys.ts
 * @description 快捷键运行时状态 API
 */

import { safeInvoke } from "@/lib/dev-bridge";

export interface ScreenshotShortcutRuntimeStatus {
  shortcut_registered: boolean;
  registered_shortcut?: string | null;
}

export interface VoiceShortcutRuntimeStatus {
  shortcut_registered: boolean;
  registered_shortcut?: string | null;
  translate_shortcut_registered: boolean;
  registered_translate_shortcut?: string | null;
}

export interface HotkeyRuntimeStatus {
  screenshot: ScreenshotShortcutRuntimeStatus;
  voice: VoiceShortcutRuntimeStatus;
}

export async function getScreenshotShortcutRuntimeStatus(): Promise<ScreenshotShortcutRuntimeStatus> {
  return safeInvoke<ScreenshotShortcutRuntimeStatus>(
    "get_screenshot_shortcut_runtime_status",
  );
}

export async function getVoiceShortcutRuntimeStatus(): Promise<VoiceShortcutRuntimeStatus> {
  return safeInvoke<VoiceShortcutRuntimeStatus>(
    "get_voice_shortcut_runtime_status",
  );
}

export async function getHotkeyRuntimeStatus(): Promise<HotkeyRuntimeStatus> {
  const [screenshot, voice] = await Promise.all([
    getScreenshotShortcutRuntimeStatus(),
    getVoiceShortcutRuntimeStatus(),
  ]);

  return { screenshot, voice };
}
