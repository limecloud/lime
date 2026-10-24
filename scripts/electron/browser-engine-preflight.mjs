import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statfsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const TARGETS = new Map([
  ["darwin-arm64", { platform: "darwin", cpu: "arm64" }],
  ["darwin-x64", { platform: "darwin", cpu: "x64" }],
  ["win32-x64", { platform: "win32", cpu: "x64" }],
]);

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    Boolean(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveBuildRoot(root, input) {
  const resolved = path.resolve(root, input);
  if (!within(root, resolved))
    throw new Error(
      "Browser engine checkout must be inside the original repository",
    );
  let ancestor = resolved;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (
    realpathSync(ancestor) !== realpathSync(root) &&
    !within(realpathSync(root), realpathSync(ancestor))
  )
    throw new Error(
      "Browser engine checkout cannot escape through a symbolic link",
    );
  return resolved;
}

function probe(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    // depot_tools supplies gclient as a .bat file on Windows. This is a fixed --version probe.
    shell: process.platform === "win32" && command === "gclient",
  });
  return {
    available: !result.error && result.status === 0,
    exitCode: result.status,
    detail: String(result.error?.code || result.stdout || result.stderr || "")
      .trim()
      .slice(0, 800),
  };
}

/** Read-only diagnostics. No download, tool installation, git mutation or user-profile access. */
export function inspectBrowserEngineBuild({
  root = ROOT,
  target = `${process.platform}-${process.arch}`,
  checkout = ".lime/browser-engine",
  platform = process.platform,
  command = probe,
  disk = statfsSync,
} = {}) {
  const selected = TARGETS.get(target);
  if (!selected)
    throw new Error("Target must be darwin-arm64, darwin-x64 or win32-x64");
  const buildRoot = resolveBuildRoot(root, checkout);
  const lock = JSON.parse(
    readFileSync(path.join(root, "electron/patches/source-lock.json"), "utf8"),
  );
  const patch = readFileSync(path.join(root, "electron/patches", lock.patch));
  const checks = [];
  const check = (name, ready, detail) => checks.push({ name, ready, detail });
  check("native-platform", selected.platform === platform, {
    target,
    hostPlatform: platform,
  });
  check(
    "patch-integrity",
    createHash("sha256").update(patch).digest("hex") === lock.patchSha256,
    lock.patch,
  );
  const free = disk(root);
  const freeBytes = Number(free.bavail) * Number(free.bsize);
  // Engineering reservation for a fresh checkout + build, not an upstream platform requirement.
  const reservedBytes = 200 * 1024 ** 3;
  check("checkout-and-build-space", freeBytes >= reservedBytes, {
    freeBytes,
    reservationBytes: reservedBytes,
    reservationSource: "local-build-budget",
  });
  for (const [name, executable, args] of [
    ["git", "git", ["--version"]],
    ["python", "python3", ["--version"]],
    ["gclient", "gclient", ["--version"]],
    ["gn", "gn", ["--version"]],
    ["ninja", "ninja", ["--version"]],
  ]) {
    const result = command(executable, args, root);
    check(name, result.available, result);
  }
  if (selected.platform === "darwin" && platform === "darwin") {
    const xcode = command("xcodebuild", ["-version"], root);
    check(
      "full-xcode",
      xcode.available && /^Xcode /mu.test(xcode.detail),
      xcode,
    );
  }
  if (selected.platform === "win32" && platform === "win32") {
    for (const executable of ["cl.exe", "link.exe", "rc.exe"]) {
      const toolchain = command("where.exe", [executable], root);
      check(`msvc-sdk-${executable}`, toolchain.available, toolchain);
    }
  }
  for (const [name, directory, expected] of [
    ["electron-source", "src/electron", lock.electronCommit],
    ["chromium-source", "src", lock.chromiumCommit],
  ]) {
    const cwd = path.join(buildRoot, directory);
    if (!existsSync(cwd)) {
      check(name, false, {
        path: path.relative(root, cwd),
        expected,
        reason: "missing-checkout",
      });
      continue;
    }
    if (!within(realpathSync(root), realpathSync(cwd)))
      throw new Error("Source checkout escaped repository");
    const identity = command("git", ["rev-parse", "HEAD"], cwd);
    // Chromium may contain Electron's patch commits; base revision must remain its ancestor.
    const ancestry =
      name === "chromium-source"
        ? command("git", ["merge-base", "--is-ancestor", expected, "HEAD"], cwd)
        : null;
    check(
      name,
      identity.available &&
        (name === "electron-source"
          ? identity.detail === expected
          : ancestry.available),
      {
        expected,
        actual: identity.detail,
        electronPatchCommitsAllowed: name === "chromium-source",
      },
    );
  }
  const source = path.join(buildRoot, "src");
  const out = "out/BrowserRelease";
  return {
    schemaVersion: 1,
    target,
    checkoutRoot: path.relative(root, buildRoot),
    readyToBuild: checks.every((item) => item.ready),
    nativeServicesComplete: false,
    checks,
    sourceLock: {
      electronCommit: lock.electronCommit,
      chromiumCommit: lock.chromiumCommit,
      patchSha256: lock.patchSha256,
    },
    buildPlan: {
      cwd: path.relative(root, source),
      environment: {
        CHROMIUM_BUILDTOOLS_PATH: path.join(source, "buildtools"),
        ...(selected.platform === "win32"
          ? { DEPOT_TOOLS_WIN_TOOLCHAIN: "0" }
          : {}),
      },
      commands: [
        {
          executable: "git",
          cwd: path.relative(root, path.join(source, "electron")),
          args: [
            "apply",
            "--check",
            path.join(root, "electron/patches", lock.patch),
          ],
        },
        {
          executable: "git",
          cwd: path.relative(root, path.join(source, "electron")),
          args: ["apply", path.join(root, "electron/patches", lock.patch)],
        },
        {
          executable: "gn",
          args: [
            "gen",
            out,
            `--args=import("//electron/build/args/release.gn") target_cpu="${selected.cpu}"`,
          ],
        },
        { executable: "ninja", args: ["-C", out, "electron"] },
      ],
      executable: path.join(
        out,
        selected.platform === "darwin"
          ? "Electron.app/Contents/MacOS/Electron"
          : "electron.exe",
      ),
      note: "Plan only. Apply the verified patch and complete native spec tests before packaging; clear-data patch does not implement passwords, Autofill, import or full extensions.",
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--target", "--checkout"].includes(args[index]) || !args[index + 1])
      throw new Error(
        "Usage: browser-engine-preflight.mjs [--target darwin-arm64|darwin-x64|win32-x64] [--checkout <repository-relative-path>]",
      );
    options[args[index].slice(2)] = args[index + 1];
  }
  const result = inspectBrowserEngineBuild(options);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.readyToBuild ? 0 : 2;
}
