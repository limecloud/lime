import type { HotkeyPlatform } from "@/lib/hotkeys/platform";

type KeyStroke = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;
const modifiers = ["CommandOrControl", "Command", "Control", "Alt", "Shift"];
// Desktop 捕获和派发共用的一秒序列窗口。
export const KEY_SEQUENCE_TIMEOUT_MS = 1000;
const namedKeys = [
  "Space",
  "Escape",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Plus",
];

function keyName(key: string): string | null {
  if (key === " ") return "Space";
  if (key === "+") return "Plus";
  if (key.length === 1 && /^[\x21-\x7e]$/.test(key)) return key.toUpperCase();
  return (
    namedKeys.find((name) => name.toLowerCase() === key.toLowerCase()) ??
    (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key) ? key.toUpperCase() : null)
  );
}

function normalizeStroke(binding: string): string | null {
  const parts = binding.split("+").map((part) => part.trim());
  const key = keyName(parts.pop() ?? "");
  const selected = parts.map((part) =>
    modifiers.find((name) => name.toLowerCase() === part.toLowerCase()),
  );
  if (
    !key ||
    selected.some((part) => !part) ||
    new Set(selected).size !== selected.length
  )
    return null;
  if (
    selected.includes("CommandOrControl") &&
    (selected.includes("Command") || selected.includes("Control"))
  )
    return null;
  return [...modifiers.filter((name) => selected.includes(name)), key].join(
    "+",
  );
}

export function normalizeBinding(binding: string): string | null {
  const input = binding.trim().replace(/\s*\+\s*/g, "+");
  if (!input) return null;
  const strokes = input.split(/\s+/).map(normalizeStroke);
  return strokes.every((stroke) => stroke !== null) ? strokes.join(" ") : null;
}

export function captureBinding(event: KeyStroke): string | null {
  const key = keyName(event.key);
  if (!key) return null;
  return [
    event.metaKey && "Command",
    event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function bindingIdentity(
  binding: string,
  platform: HotkeyPlatform,
): string | null {
  const normalized = normalizeBinding(binding);
  if (!normalized) return null;
  return normalized.replaceAll(
    "CommandOrControl",
    platform === "mac" ? "Command" : "Control",
  );
}

export function bindingMatchesPrefix(
  binding: string,
  prefix: string,
  platform: HotkeyPlatform,
): boolean {
  const identity = bindingIdentity(binding, platform);
  const start = bindingIdentity(prefix, platform);
  return (
    identity !== null &&
    start !== null &&
    (identity === start || identity.startsWith(`${start} `))
  );
}

export function bindingsConflict(
  left: string,
  right: string,
  platform: HotkeyPlatform,
): boolean {
  return (
    bindingMatchesPrefix(left, right, platform) ||
    bindingMatchesPrefix(right, left, platform)
  );
}
