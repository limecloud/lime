/**
 * @file terminalPageHotkeys.ts
 * @description 终端页面快捷键定义与匹配
 */

import {
  hasPrimaryModifier,
  normalizeHotkeyKey,
  resolveHotkeyPlatform,
  type HotkeyEventLike,
  type HotkeyPlatform,
} from "@/lib/hotkeys/platform";
import type { AuditedHotkeyDefinition } from "@/lib/hotkeys/types";

const TERMINAL_SHARED_HOTKEYS: AuditedHotkeyDefinition[] = [
  {
    id: "terminal-search",
    label: "终端搜索",
    description: "打开终端搜索栏。",
    shortcut: "CommandOrControl+F",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
  {
    id: "terminal-font-plus",
    label: "终端字体放大",
    description: "增大终端字体大小。",
    shortcut: "CommandOrControl+=",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
  {
    id: "terminal-font-minus",
    label: "终端字体缩小",
    description: "减小终端字体大小。",
    shortcut: "CommandOrControl+-",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
  {
    id: "terminal-font-reset",
    label: "终端字体重置",
    description: "将终端字体大小恢复为默认值。",
    shortcut: "CommandOrControl+0",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
  {
    id: "terminal-scroll-bottom",
    label: "滚动到终端底部",
    description: "直接跳到当前终端输出的最底部。",
    shortcut: "Shift+End",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
  {
    id: "terminal-scroll-top",
    label: "滚动到终端顶部",
    description: "直接跳到当前终端输出的最顶部。",
    shortcut: "Shift+Home",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
  {
    id: "terminal-scroll-page-down",
    label: "终端向下翻页",
    description: "在终端历史输出中向下滚动一页。",
    shortcut: "Shift+PageDown",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
  {
    id: "terminal-scroll-page-up",
    label: "终端向上翻页",
    description: "在终端历史输出中向上滚动一页。",
    shortcut: "Shift+PageUp",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在终端页面内生效。",
  },
];

const TERMINAL_MAC_ONLY_HOTKEYS: AuditedHotkeyDefinition[] = [
  {
    id: "terminal-scroll-bottom-mac",
    label: "滚动到终端底部（macOS）",
    description: "使用 macOS 常见组合键快速跳到终端底部。",
    shortcut: "Command+End",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在 macOS 终端页面内生效。",
  },
  {
    id: "terminal-scroll-top-mac",
    label: "滚动到终端顶部（macOS）",
    description: "使用 macOS 常见组合键快速跳到终端顶部。",
    shortcut: "Command+Home",
    scope: "local",
    scene: "terminal",
    source: "终端页面",
    condition: "仅在 macOS 终端页面内生效。",
  },
];

export function getTerminalPageHotkeys(
  platform: HotkeyPlatform,
): AuditedHotkeyDefinition[] {
  if (platform === "mac") {
    return [...TERMINAL_SHARED_HOTKEYS, ...TERMINAL_MAC_ONLY_HOTKEYS];
  }

  return TERMINAL_SHARED_HOTKEYS;
}

export type TerminalPageHotkeyAction =
  | "open-search"
  | "increase-font-size"
  | "decrease-font-size"
  | "reset-font-size"
  | "scroll-to-bottom"
  | "scroll-to-top"
  | "scroll-page-down"
  | "scroll-page-up";

export function resolveTerminalPageHotkeyAction(
  event: HotkeyEventLike,
  platform = resolveHotkeyPlatform(
    typeof navigator === "undefined" ? undefined : navigator,
  ),
): TerminalPageHotkeyAction | null {
  const key = normalizeHotkeyKey(event.key);

  if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (key === "End") {
      return "scroll-to-bottom";
    }

    if (key === "Home") {
      return "scroll-to-top";
    }

    if (key === "PageDown") {
      return "scroll-page-down";
    }

    if (key === "PageUp") {
      return "scroll-page-up";
    }
  }

  if (
    platform === "mac" &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    if (key === "End") {
      return "scroll-to-bottom";
    }

    if (key === "Home") {
      return "scroll-to-top";
    }
  }

  if (!hasPrimaryModifier(event)) {
    return null;
  }

  if (key === "f") {
    return "open-search";
  }

  if (key === "+" || key === "=") {
    return "increase-font-size";
  }

  if (key === "-") {
    return "decrease-font-size";
  }

  if (key === "0") {
    return "reset-font-size";
  }

  return null;
}
