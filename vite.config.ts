/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import process from "node:process";
import { fileURLToPath } from "url";
import { readWorkspaceAppVersion } from "./scripts/app-version.mjs";
import { RENDERER_BUILD_ENTRIES } from "./scripts/lib/electron-build-inputs.mjs";

// ES 模块中获取 __dirname 的方式
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cargoWorkspaceVersion = readWorkspaceAppVersion(__dirname);
const appVersion =
  process.env.VITE_APP_VERSION?.trim() || cargoWorkspaceVersion || "unknown";
const liveProviderSmokeAllowed =
  isTruthyEnv(process.env.LIME_ALLOW_LIVE_PROVIDER_SMOKE) ||
  isTruthyEnv(process.env.LIME_REAL_API_TEST);

if (!process.env.VITE_APP_VERSION && cargoWorkspaceVersion) {
  process.env.VITE_APP_VERSION = cargoWorkspaceVersion;
}

function isTruthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

export default defineConfig(({ command, mode }) => {
  const forceOptimizeDeps =
    process.env.LIME_VITE_FORCE_OPTIMIZE_DEPS?.trim() === "1";
  const isElectronRenderer =
    process.env.LIME_ELECTRON_RENDERER?.trim() === "1" ||
    process.env.VITE_DEV_SERVER_URL !== undefined;
  const keepExistingOutDir =
    process.env.LIME_VITE_EMPTY_OUT_DIR?.trim() === "0";
  const cacheDir = isElectronRenderer
    ? "node_modules/.vite-electron"
    : "node_modules/.vite-web";

  return {
    base: command === "build" && isElectronRenderer ? "./" : undefined,
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
        {
          find: "@limecloud/app-server-client/browser",
          replacement: path.resolve(
            __dirname,
            "./packages/app-server-client/src/browser.ts",
          ),
        },
        {
          find: "@limecloud/app-server-client",
          replacement: path.resolve(
            __dirname,
            "./packages/app-server-client/src/browser.ts",
          ),
        },
        {
          find: "@limecloud/agent-runtime-client/sessionGateway",
          replacement: path.resolve(
            __dirname,
            "./packages/agent-runtime-client/src/sessionGateway.ts",
          ),
        },
        {
          find: "@limecloud/agent-runtime-client",
          replacement: path.resolve(
            __dirname,
            "./packages/agent-runtime-client/src/index.ts",
          ),
        },
        {
          find: "@limecloud/agent-ui-contracts",
          replacement: path.resolve(
            __dirname,
            "./packages/agent-ui-contracts/src/index.ts",
          ),
        },
        {
          find: "@limecloud/agent-runtime-projection",
          replacement: path.resolve(
            __dirname,
            "./packages/agent-runtime-projection/src/index.ts",
          ),
        },
        {
          find: "@limecloud/agent-runtime-ui",
          replacement: path.resolve(
            __dirname,
            "./packages/agent-runtime-ui/src/index.ts",
          ),
        },
      ],
    },
    optimizeDeps: {
      force: forceOptimizeDeps,
    },
    build: {
      emptyOutDir: keepExistingOutDir ? false : undefined,
      chunkSizeWarningLimit: 12000,
      rollupOptions: {
        input: Object.fromEntries(
          RENDERER_BUILD_ENTRIES.map((entry) => [
            entry.name,
            path.resolve(__dirname, entry.source),
          ]),
        ),
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
        ignored: ["**/lime-rs/**"],
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./scripts/setup-vitest-network-guard.ts"],
      exclude: [
        "**/.lime/**",
        "**/internal/exec-plans/artifacts/**",
        "**/node_modules/**",
        "**/tmp/lime-pnpm-frozen-node_modules/**",
        "**/dist/**",
        "**/lime-rs/target/**",
        ...(liveProviderSmokeAllowed ? [] : ["**/*.live.test.*"]),
      ],
    },
  };
});
