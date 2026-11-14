import { useSyncExternalStore } from "react";

export type AccentColor =
  | "default"
  | "blue"
  | "green"
  | "purple"
  | "pink"
  | "orange"
  | "yellow"
  | "black";
export const ACCENT_COLORS: readonly AccentColor[] = [
  "default",
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "yellow",
  "black",
];
const STORAGE_KEY = "lime.appearance.accent.v1";
let current = read();
const listeners = new Set<() => void>();

function read(): AccentColor {
  if (typeof window === "undefined") return "default";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return ACCENT_COLORS.includes(value as AccentColor)
      ? (value as AccentColor)
      : "default";
  } catch {
    return "default";
  }
}

function publish() {
  for (const listener of listeners) listener();
}

export function getAccentColor(): AccentColor {
  return current;
}

export function setAccentColor(color: AccentColor) {
  current = color;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, color);
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

export function subscribeAccentColor(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAccentColor(): AccentColor {
  return useSyncExternalStore(subscribeAccentColor, getAccentColor, getAccentColor);
}

export interface AccentPalette {
  brand: string;
  soft: string;
  strong: string;
}

export const ACCENT_PALETTES: Record<AccentColor, AccentPalette | null> = {
  default: null,
  blue: { brand: "#3b82f6", soft: "#eff6ff", strong: "#1d4ed8" },
  green: { brand: "#10b981", soft: "#ecfdf5", strong: "#166534" },
  purple: { brand: "#8b5cf6", soft: "#f5f3ff", strong: "#6d28d9" },
  pink: { brand: "#ec4899", soft: "#fdf2f8", strong: "#be185d" },
  orange: { brand: "#f97316", soft: "#fff7ed", strong: "#c2410c" },
  yellow: { brand: "#eab308", soft: "#fefce8", strong: "#a16207" },
  black: { brand: "#111827", soft: "#f3f4f6", strong: "#000000" },
};

export function applyAccentColor(color: AccentColor) {
  const palette = ACCENT_PALETTES[color];
  if (!palette) {
    document.documentElement.style.removeProperty("--lime-brand");
    document.documentElement.style.removeProperty("--lime-brand-soft");
    document.documentElement.style.removeProperty("--lime-brand-strong");
    return;
  }
  document.documentElement.style.setProperty("--lime-brand", palette.brand);
  document.documentElement.style.setProperty("--lime-brand-soft", palette.soft);
  document.documentElement.style.setProperty(
    "--lime-brand-strong",
    palette.strong,
  );
}

export function resetAccentColorForTest() {
  setAccentColor("default");
}
