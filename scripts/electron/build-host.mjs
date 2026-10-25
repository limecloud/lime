import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import {
  HOST_PRELOAD_BUILD_ENTRIES,
  HOST_CLIENT_BUILD_ENTRIES,
} from "../lib/electron-build-inputs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const devMode = process.argv.includes("--dev");
const sharedExternal = ["electron", /^node:/];
const ssrBundleRuntimeDependencies = { noExternal: true };
const appServerClientSource = path.resolve(
  repoRoot,
  "packages/app-server-client/src/index.ts",
);

async function buildMain() {
  await build({
    configFile: false,
    ssr: ssrBundleRuntimeDependencies,
    resolve: {
      alias: [
        {
          find: "@limecloud/app-server-client",
          replacement: appServerClientSource,
        },
      ],
    },
    build: {
      target: "node22",
      ssr: "electron/main.ts",
      outDir: "dist-electron/main",
      emptyOutDir: true,
      rollupOptions: {
        external: sharedExternal,
        output: {
          entryFileNames: "main.js",
          format: "es",
        },
      },
    },
  });
}

export async function buildPreload(
  rootDir = repoRoot,
  entries = HOST_PRELOAD_BUILD_ENTRIES,
) {
  // Sandboxed preloads cannot require local Rollup chunks. Each entry must be self-contained.
  for (const [index, entry] of entries.entries())
    await build({
      configFile: false,
      ssr: ssrBundleRuntimeDependencies,
      build: {
        target: "node22",
        ssr: true,
        outDir: path.resolve(rootDir, "dist-electron/preload"),
        emptyOutDir: index === 0,
        rollupOptions: {
          input: path.resolve(rootDir, entry.source),
          external: ["electron", /^node:/],
          output: {
            entryFileNames: `${entry.name}.cjs`,
            format: "cjs",
            inlineDynamicImports: true,
          },
        },
      },
    });
}

export async function buildBrowserClient(rootDir = repoRoot) {
  await build({
    configFile: false,
    build: {
      target: "node22",
      ssr: path.resolve(rootDir, HOST_CLIENT_BUILD_ENTRIES[0].source),
      outDir: path.dirname(
        path.resolve(rootDir, HOST_CLIENT_BUILD_ENTRIES[0].output),
      ),
      emptyOutDir: true,
      rollupOptions: {
        external: [/^node:/],
        output: {
          entryFileNames: "client.mjs",
          format: "es",
          inlineDynamicImports: true,
        },
      },
    },
  });
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  await buildMain();
  await buildPreload();
  await buildBrowserClient();
}
