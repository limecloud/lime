/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { fileURLToPath } from "url";
import { readWorkspaceAppVersion } from "./scripts/app-version.mjs";

// ES 模块中获取 __dirname 的方式
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cargoWorkspaceVersion = readWorkspaceAppVersion(__dirname);
const appVersion =
  process.env.VITE_APP_VERSION?.trim() || cargoWorkspaceVersion || "unknown";

if (!process.env.VITE_APP_VERSION && cargoWorkspaceVersion) {
  process.env.VITE_APP_VERSION = cargoWorkspaceVersion;
}

// 获取 Tauri mock 目录路径
const tauriMockDir = path.resolve(__dirname, "./src/lib/tauri-mock");
const tauriEventWrapper = path.resolve(__dirname, "./src/lib/tauri-event.ts");

export default defineConfig(({ mode }) => {
  const browserBridgeFlag =
    process.env.LIME_BROWSER_BRIDGE ?? process.env.PROXYCAST_BROWSER_BRIDGE;
  // 检查是否在 Tauri 环境中运行（通过环境变量判断）
  const isTauri =
    process.env.TAURI_ENV_PLATFORM !== undefined &&
    browserBridgeFlag !== "1";
  // 避免 Tauri/非 Tauri 共享同一份 optimize deps 缓存导致 chunk 丢失
  const cacheDir = isTauri ? "node_modules/.vite-tauri" : "node_modules/.vite-web";
  
  // 只在非 Tauri 环境（纯浏览器开发）下使用 mock
  const tauriAliases = isTauri
    ? [
        {
          find: /^@tauri-apps\/api\/event$/,
          replacement: tauriEventWrapper,
        },
      ]
    : [
        {
          find: /^@tauri-apps\/api\/core$/,
          replacement: path.resolve(tauriMockDir, "core.ts"),
        },
        {
          find: /^@tauri-apps\/api\/event$/,
          replacement: path.resolve(tauriMockDir, "event.ts"),
        },
        {
          find: /^@tauri-apps\/api\/window$/,
          replacement: path.resolve(tauriMockDir, "window.ts"),
        },
        {
          find: /^@tauri-apps\/api\/app$/,
          replacement: path.resolve(tauriMockDir, "window.ts"),
        },
        {
          find: /^@tauri-apps\/api\/path$/,
          replacement: path.resolve(tauriMockDir, "window.ts"),
        },
        {
          find: /^@tauri-apps\/plugin-dialog$/,
          replacement: path.resolve(tauriMockDir, "plugin-dialog.ts"),
        },
        {
          find: /^@tauri-apps\/plugin-shell$/,
          replacement: path.resolve(tauriMockDir, "plugin-shell.ts"),
        },
        {
          find: /^@tauri-apps\/plugin-deep-link$/,
          replacement: path.resolve(tauriMockDir, "plugin-deep-link.ts"),
        },
        {
          find: /^@tauri-apps\/plugin-global-shortcut$/,
          replacement: path.resolve(tauriMockDir, "plugin-global-shortcut.ts"),
        },
      ];

  return {
  cacheDir,
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  plugins: [
    react({
      jsxRuntime: mode === "development" ? "automatic" : "automatic",
      jsxImportSource: "react",
      babel: {
        compact: true,
      },
    }),
    svgr(),
  ],
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
      ...tauriAliases,
    ],
  },
  optimizeDeps: {
    // 强制每次启动时校验并重建依赖预构建，避免命中损坏缓存
    force: true,
    // 只在非 Tauri 环境下排除 Tauri 包的预构建
    exclude: isTauri ? [] : [
      "@tauri-apps/api",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-shell",
      "@tauri-apps/plugin-deep-link",
      "@tauri-apps/plugin-global-shortcut",
    ],
  },
  build: {
    chunkSizeWarningLimit: 12000,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        const isMixedImportWarning =
          warning.message.includes("dynamically imported by") &&
          warning.message.includes("also statically imported by");

        if (isMixedImportWarning) {
          return;
        }

        defaultHandler(warning);
      },
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/scripts/playwright-login/**",
      "**/src-tauri/target/**",
    ],
  },
};
});
