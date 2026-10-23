import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const RENDERER_BUILD_ENTRIES = [
  { name: "main", source: "index.html", output: "dist/index.html" },
  {
    name: "browserAnnotation",
    source: "browser-annotation.html",
    output: "dist/browser-annotation.html",
  },
];
export const HOST_PRELOAD_BUILD_ENTRIES = [
  {
    name: "preload",
    source: "electron/preload.ts",
    output: "dist-electron/preload/preload.cjs",
  },
  {
    name: "browserOverlay",
    source: "electron/browserOverlayPreload.ts",
    output: "dist-electron/preload/browserOverlay.cjs",
  },
  {
    name: "browserPage",
    source: "electron/browserPagePreload.ts",
    output: "dist-electron/preload/browserPage.cjs",
  },
  {
    name: "browserAnnotationEditor",
    source: "electron/browserAnnotationEditorPreload.ts",
    output: "dist-electron/preload/browserAnnotationEditor.cjs",
  },
];

export function declaredBuildEntries(rootDir, entries) {
  // A product root declares the whole build graph; isolated fixtures may omit it.
  const declaresProduct = statFile(
    path.join(rootDir, entries[0].source),
  )?.isFile();
  return declaresProduct
    ? entries
    : entries.filter(
        (entry, index) =>
          index === 0 || statFile(path.join(rootDir, entry.source))?.isFile(),
      );
}

export const RENDERER_SOURCE_DIRS = [
  "src",
  "public",
  "packages/app-server-client/src",
  "packages/agent-runtime-client/src",
  "packages/agent-runtime-projection/src",
  "packages/agent-runtime-ui/src",
  "packages/agent-ui-contracts/src",
];
export const RENDERER_SOURCE_FILES = [
  ...RENDERER_BUILD_ENTRIES.map((entry) => entry.source),
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  "tsconfig.json",
  "tsconfig.renderer.json",
  "vite.config.ts",
  "postcss.config.js",
  "tailwind.config.js",
  "scripts/electron/build-renderer-smoke.mjs",
  "scripts/electron/build-renderer.mjs",
  "scripts/electron/renderer-build-env.mjs",
  "scripts/lib/electron-build-inputs.mjs",
  "scripts/lib/electron-renderer-build.mjs",
];
export const HOST_SOURCE_DIRS = [
  "electron",
  "packages/app-server-client/src",
  "assets/plugins",
  "lime-rs/icons",
];
export const HOST_SOURCE_FILES = [
  ...HOST_PRELOAD_BUILD_ENTRIES.map((entry) => entry.source),
  "src/lib/api/browserAnnotationEditorTypes.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  "tsconfig.electron.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "packages/app-server-client/package.json",
  "packages/app-server-client/tsconfig.json",
  "scripts/electron/build-host.mjs",
  "scripts/electron/copy-desktop-assets.mjs",
  "scripts/lib/electron-desktop-resources.mjs",
  "scripts/lib/electron-build-inputs.mjs",
];
export const APP_SERVER_SOURCE_DIRS = [
  "lime-rs/crates",
  "lime-rs/vendor",
  "lime-rs/resources",
];
export const APP_SERVER_SOURCE_FILES = [
  "package.json",
  ".cargo/config.toml",
  "rust-toolchain.toml",
  "lime-rs/Cargo.lock",
  "lime-rs/Cargo.toml",
  "scripts/electron/prepare-app-server-assets.mjs",
  "scripts/lib/electron-app-server-assets.mjs",
  "scripts/lib/electron-dev-sidecar.mjs",
];
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cpp",
  ".css",
  ".html",
  ".ico",
  ".gif",
  ".js",
  ".jpeg",
  ".jpg",
  ".json",
  ".json5",
  ".jsx",
  ".less",
  ".md",
  ".mdx",
  ".mjs",
  ".mp3",
  ".png",
  ".rs",
  ".sass",
  ".scss",
  ".swift",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".wav",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
  ".yaml",
  ".yml",
]);
const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "dist-electron",
  "node_modules",
  "target",
]);
const IGNORED_SOURCE_FILE_PATTERNS = [
  /(^|[/\\])__snapshots__([/\\]|$)/,
  /(^|[/\\])tests([/\\]|$)/,
  /\.spec\.[cm]?[jt]sx?$/,
  /\.test(?:Fixtures)?\.[cm]?[jt]sx?$/,
  /_test\.rs$/,
];

function isIgnoredSourceFile(filePath) {
  return IGNORED_SOURCE_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function statFile(filePath) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

export function createMtimeEntry(rootDir, filePath, stats) {
  return {
    path: filePath,
    relativePath: path.relative(rootDir, filePath),
    mtimeMs: stats.mtimeMs,
  };
}

export function pickNewer(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return right.mtimeMs > left.mtimeMs ? right : left;
}

function inputFiles(rootDir, { sourceDirs, sourceFiles }) {
  const files = new Set();
  for (const name of sourceFiles) {
    if (statFile(path.join(rootDir, name))?.isFile()) files.add(name);
  }
  const pending = sourceDirs.map((name) => path.join(rootDir, name));
  while (pending.length) {
    const directory = pending.pop();
    if (!statFile(directory)?.isDirectory()) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) pending.push(filePath);
      } else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
        !isIgnoredSourceFile(filePath)
      )
        files.add(path.relative(rootDir, filePath));
    }
  }
  return [...files].sort();
}

export function findNewestBuildInput(rootDir, inputs) {
  return inputFiles(rootDir, inputs).reduce((newest, name) => {
    const filePath = path.join(rootDir, name);
    const stats = statFile(filePath);
    return stats?.isFile()
      ? pickNewer(newest, createMtimeEntry(rootDir, filePath, stats))
      : newest;
  }, null);
}

export function fingerprintBuildInputs(rootDir, inputs) {
  const files = inputFiles(rootDir, inputs);
  const digest = createHash("sha256");
  for (const name of files) {
    const bytes = readFileSync(path.join(rootDir, name));
    digest.update(
      JSON.stringify([name.split(path.sep).join("/"), bytes.length]),
    );
    digest.update(bytes);
  }
  return { sha256: digest.digest("hex"), files: files.length };
}
