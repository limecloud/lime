import type { HotkeyPlatform } from "@/lib/hotkeys/platform";

type KeyStroke = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;
const modifiers = ["CommandOrControl", "Command", "Control", "Alt", "Shift"];
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

export function normalizeBinding(binding: string): string | null {
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
  return normalized.replace(
    "CommandOrControl",
    platform === "mac" ? "Command" : "Control",
  );
}

export function matchesBinding(
  event: KeyStroke,
  binding: string,
  platform: HotkeyPlatform,
): boolean {
  const captured = captureBinding(event);
  return (
    captured !== null &&
    bindingIdentity(captured, platform) === bindingIdentity(binding, platform)
  );
}
