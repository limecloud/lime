import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function compileDesktopPermissions({
  outputPath,
  arch,
  execFileSyncImpl,
}) {
  const electronVersion = require("electron/package.json").version;
  const cachedHeaders = path.join(
    homedir(),
    ".electron-gyp",
    electronVersion,
    "include/node",
  );
  const cache = path.join(root, ".lime/cache/node-headers");
  const include = existsSync(path.join(cachedHeaders, "node_api.h"))
    ? cachedHeaders
    : path.join(cache, electronVersion, "include/node");
  if (!existsSync(path.join(include, "node_api.h"))) {
    // Reuse Forge's official header installer. This runs at build time only.
    const forge = createRequire(
      require.resolve("@electron-forge/cli/package.json"),
    );
    const core = createRequire(forge.resolve("@electron-forge/core"));
    const rebuild = createRequire(core.resolve("@electron/rebuild"));
    execFileSyncImpl(
      process.execPath,
      [
        rebuild.resolve("@electron/node-gyp/bin/node-gyp.js"),
        "install",
        `--target=${electronVersion}`,
        "--dist-url=https://electronjs.org/headers",
        `--devdir=${cache}`,
      ],
      { stdio: "pipe" },
    );
  }
  execFileSyncImpl(
    "clang++",
    [
      "-std=c++17",
      "-fobjc-arc",
      "-fblocks",
      "-O2",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-mmacosx-version-min=13.0",
      "-arch",
      arch === "x64" ? "x86_64" : "arm64",
      "-I",
      include,
      "-framework",
      "Foundation",
      "-framework",
      "UserNotifications",
      "-framework",
      "CoreLocation",
      path.join(root, "electron/native/macos/desktop-permissions.mm"),
      "-o",
      outputPath,
    ],
    { stdio: "pipe" },
  );
}
