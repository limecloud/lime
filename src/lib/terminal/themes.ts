/**
 * @file themes.ts
 * @description 终端主题配置
 * @module lib/terminal/themes
 *
 * 提供多种终端主题，参考 waveterm 的主题系统。
 *
 * _Requirements: 8.7, 8.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
 */

import type { ITheme } from "@xterm/xterm";

/** 主题名称类型 */
export type ThemeName =
  | "tokyo-night"
  | "dracula"
  | "one-dark"
  | "github-dark"
  | "monokai"
  | "nord"
  | "solarized-dark"
  | "gruvbox-dark";

/** 主题配置接口 */
interface TerminalTheme {
  name: ThemeName;
  displayName: string;
  theme: ITheme;
}

/** Tokyo Night 主题 */
const tokyoNight: ITheme = {
  background: "#1a1b26",
  foreground: "#c0caf5",
  cursor: "#c0caf5",
  cursorAccent: "#1a1b26",
  selectionBackground: "#364a82",
  selectionForeground: "#c0caf5",
  selectionInactiveBackground: "#364a8266",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

/** Dracula 主题 */
const dracula: ITheme = {
  background: "#282a36",
  foreground: "#f8f8f2",
  cursor: "#f8f8f2",
  cursorAccent: "#282a36",
  selectionBackground: "#44475a",
  selectionForeground: "#f8f8f2",
  selectionInactiveBackground: "#44475a66",
  black: "#21222c",
  red: "#ff5555",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  blue: "#bd93f9",
  magenta: "#ff79c6",
  cyan: "#8be9fd",
  white: "#f8f8f2",
  brightBlack: "#6272a4",
  brightRed: "#ff6e6e",
  brightGreen: "#69ff94",
  brightYellow: "#ffffa5",
  brightBlue: "#d6acff",
  brightMagenta: "#ff92df",
  brightCyan: "#a4ffff",
  brightWhite: "#ffffff",
};

/** One Dark 主题 */
const oneDark: ITheme = {
  background: "#282c34",
  foreground: "#abb2bf",
  cursor: "#528bff",
  cursorAccent: "#282c34",
  selectionBackground: "#3e4451",
  selectionForeground: "#abb2bf",
  selectionInactiveBackground: "#3e445166",
  black: "#1e2127",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#d19a66",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#abb2bf",
  brightBlack: "#5c6370",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#d19a66",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
};

/** GitHub Dark 主题 */
const githubDark: ITheme = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "#264f78",
  selectionForeground: "#c9d1d9",
  selectionInactiveBackground: "#264f7866",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

/** Monokai 主题 */
const monokai: ITheme = {
  background: "#272822",
  foreground: "#f8f8f2",
  cursor: "#f8f8f0",
  cursorAccent: "#272822",
  selectionBackground: "#49483e",
  selectionForeground: "#f8f8f2",
  selectionInactiveBackground: "#49483e66",
  black: "#272822",
  red: "#f92672",
  green: "#a6e22e",
  yellow: "#f4bf75",
  blue: "#66d9ef",
  magenta: "#ae81ff",
  cyan: "#a1efe4",
  white: "#f8f8f2",
  brightBlack: "#75715e",
  brightRed: "#f92672",
  brightGreen: "#a6e22e",
  brightYellow: "#f4bf75",
  brightBlue: "#66d9ef",
  brightMagenta: "#ae81ff",
  brightCyan: "#a1efe4",
  brightWhite: "#f9f8f5",
};

/** Nord 主题 */
const nord: ITheme = {
  background: "#2e3440",
  foreground: "#d8dee9",
  cursor: "#d8dee9",
  cursorAccent: "#2e3440",
  selectionBackground: "#434c5e",
  selectionForeground: "#d8dee9",
  selectionInactiveBackground: "#434c5e66",
  black: "#3b4252",
  red: "#bf616a",
  green: "#a3be8c",
  yellow: "#ebcb8b",
  blue: "#81a1c1",
  magenta: "#b48ead",
  cyan: "#88c0d0",
  white: "#e5e9f0",
  brightBlack: "#4c566a",
  brightRed: "#bf616a",
  brightGreen: "#a3be8c",
  brightYellow: "#ebcb8b",
  brightBlue: "#81a1c1",
  brightMagenta: "#b48ead",
  brightCyan: "#8fbcbb",
  brightWhite: "#eceff4",
};

/** Solarized Dark 主题 */
const solarizedDark: ITheme = {
  background: "#002b36",
  foreground: "#839496",
  cursor: "#839496",
  cursorAccent: "#002b36",
  selectionBackground: "#073642",
  selectionForeground: "#93a1a1",
  selectionInactiveBackground: "#07364266",
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#eee8d5",
  brightBlack: "#002b36",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};

/** Gruvbox Dark 主题 */
const gruvboxDark: ITheme = {
  background: "#282828",
  foreground: "#ebdbb2",
  cursor: "#ebdbb2",
  cursorAccent: "#282828",
  selectionBackground: "#504945",
  selectionForeground: "#ebdbb2",
  selectionInactiveBackground: "#50494566",
  black: "#282828",
  red: "#cc241d",
  green: "#98971a",
  yellow: "#d79921",
  blue: "#458588",
  magenta: "#b16286",
  cyan: "#689d6a",
  white: "#a89984",
  brightBlack: "#928374",
  brightRed: "#fb4934",
  brightGreen: "#b8bb26",
  brightYellow: "#fabd2f",
  brightBlue: "#83a598",
  brightMagenta: "#d3869b",
  brightCyan: "#8ec07c",
  brightWhite: "#ebdbb2",
};

/** 所有主题配置 */
const TERMINAL_THEMES: Record<ThemeName, TerminalTheme> = {
  "tokyo-night": {
    name: "tokyo-night",
    displayName: "Tokyo Night",
    theme: tokyoNight,
  },
  dracula: {
    name: "dracula",
    displayName: "Dracula",
    theme: dracula,
  },
  "one-dark": {
    name: "one-dark",
    displayName: "One Dark",
    theme: oneDark,
  },
  "github-dark": {
    name: "github-dark",
    displayName: "GitHub Dark",
    theme: githubDark,
  },
  monokai: {
    name: "monokai",
    displayName: "Monokai",
    theme: monokai,
  },
  nord: {
    name: "nord",
    displayName: "Nord",
    theme: nord,
  },
  "solarized-dark": {
    name: "solarized-dark",
    displayName: "Solarized Dark",
    theme: solarizedDark,
  },
  "gruvbox-dark": {
    name: "gruvbox-dark",
    displayName: "Gruvbox Dark",
    theme: gruvboxDark,
  },
};

/** 默认主题 */
const DEFAULT_THEME: ThemeName = "tokyo-night";

/** 获取主题配置 */
export function getTheme(name: ThemeName): ITheme {
  return TERMINAL_THEMES[name]?.theme ?? TERMINAL_THEMES[DEFAULT_THEME].theme;
}

/** 主题存储键 */
const THEME_STORAGE_KEY = "terminal-theme";
/** 字体大小存储键 */
const FONT_SIZE_STORAGE_KEY = "terminal-font-size";
/** 默认字体大小 */
const DEFAULT_FONT_SIZE = 14;
/** 最小字体大小 */
const MIN_FONT_SIZE = 8;
/** 最大字体大小 */
const MAX_FONT_SIZE = 32;

/** 保存主题到本地存储
 * _Requirements: 12.4_
 */
export function saveThemePreference(name: ThemeName): void {
  localStorage.setItem(THEME_STORAGE_KEY, name);
}

/** 从本地存储加载主题 */
export function loadThemePreference(): ThemeName {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved && saved in TERMINAL_THEMES) {
    return saved as ThemeName;
  }
  return DEFAULT_THEME;
}

/** 保存字体大小到本地存储
 * _Requirements: 8.8_
 */
export function saveFontSizePreference(size: number): void {
  const clampedSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
  localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clampedSize));
}

/** 从本地存储加载字体大小 */
export function loadFontSizePreference(): number {
  const saved = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  if (saved) {
    const size = parseInt(saved, 10);
    if (!isNaN(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
      return size;
    }
  }
  return DEFAULT_FONT_SIZE;
}
