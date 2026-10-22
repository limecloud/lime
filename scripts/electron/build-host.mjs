import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function buildPreload() {
  await build({
    configFile: false,
    ssr: ssrBundleRuntimeDependencies,
    build: {
      target: "node22",
      ssr: true,
      outDir: "dist-electron/preload",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          preload: path.resolve(repoRoot, "electron/preload.ts"),
          browserOverlay: path.resolve(
            repoRoot,
            "electron/browserOverlayPreload.ts",
          ),
          browserPage: path.resolve(repoRoot, "electron/browserPagePreload.ts"),
          browserAnnotationEditor: path.resolve(
            repoRoot,
            "electron/browserAnnotationEditorPreload.ts",
          ),
        },
        external: ["electron", /^node:/],
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  });
}

await buildMain();
await buildPreload();
