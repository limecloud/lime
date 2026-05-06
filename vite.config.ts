/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import process from "node:process";
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
const sharedTauriOptimizeDepsExclude = ["@tauri-apps/plugin-deep-link"];

export default defineConfig(({ mode }) => {
  const browserBridgeFlag =
    process.env.LIME_BROWSER_BRIDGE ?? process.env.PROXYCAST_BROWSER_BRIDGE;
  const forceOptimizeDeps =
    process.env.LIME_VITE_FORCE_OPTIMIZE_DEPS?.trim() === "1";
  // 检查是否在 Tauri 环境中运行（通过环境变量判断）
  const isTauri =
    process.env.TAURI_ENV_PLATFORM !== undefined &&
    browserBridgeFlag !== "1";
  // 避免 Tauri/非 Tauri 共享同一份 optimize deps 缓存导致 chunk 丢失
  const cacheDir = isTauri
    ? "node_modules/.vite-tauri"
    : "node_modules/.vite-web";

  // 只在非 Tauri 环境（纯浏览器开发）下使用 mock
  const tauriAliases = isTauri
    ? []
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
      // 仅在显式要求时强制重建依赖预构建，避免 Tauri 冷启动长期卡在入口模块首个请求。
      force: forceOptimizeDeps,
      // deep-link 在 Tauri 模式下会命中本地 event shim，交给 Vite 常规模块解析更稳
      exclude: isTauri
        ? sharedTauriOptimizeDepsExclude
        : [
            "@tauri-apps/api",
            "@tauri-apps/plugin-dialog",
            "@tauri-apps/plugin-shell",
            "@tauri-apps/plugin-global-shortcut",
            ...sharedTauriOptimizeDepsExclude,
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
        output: {
          manualChunks: {
            // 将 AgentChatWorkspace 相关的大模块单独打包
            'agent-chat-core': [
              './src/components/agent/chat/AgentChatWorkspace.tsx',
            ],
            // 将 agent hooks 单独打包
            'agent-hooks': [
              './src/components/agent/chat/hooks/useAgentChatUnified.ts',
              './src/components/agent/chat/hooks/useAgentSession.ts',
              './src/components/agent/chat/hooks/useAsterAgentChat.ts',
            ],
            // 将 artifact 相关逻辑单独打包
            'artifact': [
              './src/lib/artifact/store.ts',
              './src/lib/artifact/types.ts',
            ],
            // 将大型第三方库单独打包
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select'],
            'vendor-utils': ['jotai', 'zustand', 'immer'],
          },
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
        "**/src-tauri/target/**",
      ],
    },
  };
});
