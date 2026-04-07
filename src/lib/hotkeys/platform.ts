/**
 * @file platform.ts
 * @description 快捷键平台解析与显示辅助，统一多处快捷键逻辑
 */

export type HotkeyPlatform = "mac" | "windows" | "other";

export interface HotkeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
  type?: string;
}

const MODIFIER_LABEL_MAP: Record<HotkeyPlatform, Record<string, string>> = {
  mac: {
    CommandOrControl: "⌘",
    Command: "⌘",
    Control: "Ctrl",
    Ctrl: "Ctrl",
    Alt: "⌥",
    Option: "⌥",
    Shift: "⇧",
    Super: "⌃",
    Space: "Space",
    Escape: "Esc",
  },
  windows: {
    CommandOrControl: "Ctrl",
    Command: "Win",
    Control: "Ctrl",
    Ctrl: "Ctrl",
    Alt: "Alt",
    Option: "Alt",
    Shift: "Shift",
    Super: "Win",
    Space: "Space",
    Escape: "Esc",
  },
  other: {
    CommandOrControl: "Ctrl",
    Command: "Cmd",
    Control: "Ctrl",
    Ctrl: "Ctrl",
    Alt: "Alt",
    Option: "Alt",
    Shift: "Shift",
    Super: "Super",
    Space: "Space",
    Escape: "Esc",
  },
};

export function resolveHotkeyPlatform(
  navigatorLike: Pick<Navigator, "platform" | "userAgent"> | undefined,
): HotkeyPlatform {
  if (!navigatorLike) {
    return "other";
  }

  const platform = navigatorLike.platform || "";
  const userAgent = navigatorLike.userAgent || "";

  if (/mac/i.test(platform) || /mac/i.test(userAgent)) {
    return "mac";
  }

  if (/win/i.test(platform) || /windows/i.test(userAgent)) {
    return "windows";
  }

  return "other";
}

export function formatShortcutTokens(
  shortcut: string | undefined,
  platform: HotkeyPlatform,
): string[] {
  if (!shortcut?.trim()) {
    return ["未设置"];
  }

  const modifierMap = MODIFIER_LABEL_MAP[platform];
  const tokens = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => modifierMap[part] ?? part.toUpperCase());

  return tokens.length > 0 ? tokens : ["未设置"];
}

export function isInputLikeTarget(
  target: EventTarget | null | undefined,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable,
  );
}

export function hasPrimaryModifier(event: HotkeyEventLike): boolean {
  return Boolean(event.metaKey || event.ctrlKey);
}

export function normalizeHotkeyKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}
