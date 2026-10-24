import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectBrowserEngineBuild } from "./browser-engine-preflight.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
function fixture() {
  mkdirSync(".lime/test", { recursive: true });
  const root = mkdtempSync(path.resolve(".lime/test/browser-engine-"));
  roots.push(root);
  mkdirSync(path.join(root, "electron/patches"), { recursive: true });
  for (const file of ["source-lock.json", "clear-data-since.patch"])
    writeFileSync(
      path.join(root, "electron/patches", file),
      readFileSync(path.join("electron/patches", file)),
    );
  mkdirSync(path.join(root, ".lime/browser-engine/src/electron"), {
    recursive: true,
  });
  const lock = JSON.parse(
    readFileSync(path.join(root, "electron/patches/source-lock.json"), "utf8"),
  );
  const command = (_executable, args, cwd) => ({
    available: true,
    exitCode: 0,
    detail:
      args[0] === "rev-parse"
        ? cwd.endsWith("electron")
          ? lock.electronCommit
          : lock.chromiumCommit
        : args[0] === "-version"
          ? "Xcode 26.3"
          : "fixture-version",
  });
  return {
    root,
    lock,
    command,
    platform: "darwin",
    target: "darwin-arm64",
    disk: () => ({ bavail: 300 * 1024 ** 3, bsize: 1 }),
  };
}

it("refuses an engine checkout outside the original repository before probing commands", () => {
  expect(() =>
    inspectBrowserEngineBuild({
      checkout: "../engine",
      target: "darwin-arm64",
    }),
  ).toThrow("inside the original repository");
});

it("treats preflight readiness as distinct from implemented native services", () => {
  const result = inspectBrowserEngineBuild(fixture());
  expect(result.readyToBuild).toBe(true);
  expect(result.nativeServicesComplete).toBe(false);
  expect(
    result.buildPlan.commands.some((item) => item.executable === "gn"),
  ).toBe(true);
});

it("rejects a tampered patch even when the source revisions and host tools are available", () => {
  const options = fixture();
  writeFileSync(
    path.join(options.root, "electron/patches/clear-data-since.patch"),
    "unreviewed native patch",
  );
  const result = inspectBrowserEngineBuild(options);
  expect(result.readyToBuild).toBe(false);
  expect(
    result.checks.find((check) => check.name === "patch-integrity").ready,
  ).toBe(false);
});

it("rejects a different source revision and a target without a native platform", () => {
  const options = fixture();
  const result = inspectBrowserEngineBuild({
    ...options,
    target: "win32-x64",
    command: (executable, args, cwd) =>
      args[0] === "rev-parse"
        ? { available: true, exitCode: 0, detail: "0".repeat(40) }
        : options.command(executable, args, cwd),
  });
  expect(result.readyToBuild).toBe(false);
  expect(
    result.checks.find((check) => check.name === "electron-source").ready,
  ).toBe(false);
  expect(
    result.checks.find((check) => check.name === "native-platform").ready,
  ).toBe(false);
});
