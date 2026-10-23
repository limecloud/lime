import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import {
  beginRendererBuild,
  completeRendererBuild,
  inspectRendererBuildReceipt,
  invalidateRendererBuild,
} from "./electron-renderer-build.mjs";
import {
  APP_SERVER_SOURCE_DIRS,
  APP_SERVER_SOURCE_FILES,
  fingerprintBuildInputs,
  findNewestBuildInput,
  HOST_SOURCE_DIRS,
  HOST_SOURCE_FILES,
  RENDERER_SOURCE_DIRS,
  RENDERER_SOURCE_FILES,
} from "./electron-build-inputs.mjs";

const roots = [];
const repository = process.cwd();
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "renderer-build-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "src", "App.tsx"), "export const a = true;");
  fs.writeFileSync(path.join(root, "dist", "index.html"), "compiled entry");
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

it("requires a completed build bound to both current source and entry bytes", () => {
  const root = fixture();
  expect(inspectRendererBuildReceipt(root).ready).toBe(false);
  const build = beginRendererBuild(root);
  expect(inspectRendererBuildReceipt(root).ready).toBe(false);
  const receipt = completeRendererBuild(build);
  expect(inspectRendererBuildReceipt(root)).toMatchObject({
    ready: true,
    input: receipt.input,
    entries: receipt.entries,
  });
  fs.writeFileSync(path.join(root, "dist", "index.html"), "different entry");
  expect(inspectRendererBuildReceipt(root)).toMatchObject({
    ready: false,
    reason: "renderer-entry-mismatch",
  });
});

it.each(["modify", "add", "delete"])(
  "rejects %s during a build even when the final artifact is newer",
  (mutation) => {
    const root = fixture();
    const source = path.join(root, "src", "App.tsx");
    const original = fs.statSync(source);
    const build = beginRendererBuild(root);
    if (mutation === "delete") fs.unlinkSync(source);
    else {
      const target =
        mutation === "add" ? path.join(root, "src", "New.ts") : source;
      fs.writeFileSync(target, "export const b = true;");
      fs.utimesSync(target, original.atime, original.mtime);
    }
    fs.writeFileSync(
      path.join(root, "dist", "index.html"),
      "newer old-code entry",
    );
    expect(() => completeRendererBuild(build)).toThrow("inputs changed");
    expect(inspectRendererBuildReceipt(root)).toMatchObject({
      ready: false,
      reason: "unfinished-renderer-build",
    });
  },
);

it("detects same-size and restored-mtime changes after a successful build", () => {
  const root = fixture();
  completeRendererBuild(beginRendererBuild(root));
  const source = path.join(root, "src", "App.tsx");
  const original = fs.statSync(source);
  fs.writeFileSync(source, "export const b = true;");
  fs.utimesSync(source, original.atime, original.mtime);
  expect(fs.statSync(source).size).toBe(original.size);
  expect(inspectRendererBuildReceipt(root)).toMatchObject({
    ready: false,
    reason: "renderer-input-mismatch",
  });
});

it("keeps test fixtures and independent Rust/host changes outside renderer inputs", () => {
  const root = fixture();
  const build = beginRendererBuild(root);
  for (const name of [
    "src/App.test.tsx",
    "src/App.testFixtures.ts",
    "electron/main.ts",
    "lime-rs/crates/app-server/src/lib.rs",
  ]) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "independent input");
  }
  completeRendererBuild(build);
  expect(inspectRendererBuildReceipt(root).ready).toBe(true);
  invalidateRendererBuild(build);
  expect(inspectRendererBuildReceipt(root).ready).toBe(false);
});

it("binds desktop icon bytes and missing resources to Host inputs independently of Renderer", () => {
  const root = fixture();
  const inputs = {
    sourceDirs: HOST_SOURCE_DIRS,
    sourceFiles: HOST_SOURCE_FILES,
  };
  const rendererInputs = {
    sourceDirs: RENDERER_SOURCE_DIRS,
    sourceFiles: RENDERER_SOURCE_FILES,
  };
  const missing = fingerprintBuildInputs(root, inputs);
  const renderer = fingerprintBuildInputs(root, rendererInputs);
  const icon = path.join(root, "lime-rs/icons/tray/trayTemplate.png");
  fs.mkdirSync(path.dirname(icon), { recursive: true });
  fs.writeFileSync(icon, Buffer.from([137, 80, 78, 71, 1]));
  const present = fingerprintBuildInputs(root, inputs);
  expect(present.sha256).not.toBe(missing.sha256);
  expect(present.files).toBe(missing.files + 1);
  expect(findNewestBuildInput(root, inputs)?.relativePath).toBe(
    path.relative(root, icon),
  );
  const original = fs.statSync(icon);
  fs.writeFileSync(icon, Buffer.from([137, 80, 78, 71, 2]));
  fs.utimesSync(icon, original.atime, original.mtime);
  expect(fingerprintBuildInputs(root, inputs).sha256).not.toBe(present.sha256);
  expect(fingerprintBuildInputs(root, rendererInputs)).toEqual(renderer);
  fs.unlinkSync(icon);
  expect(fingerprintBuildInputs(root, inputs)).toEqual(missing);
});

it.each([".cargo/config.toml", "rust-toolchain.toml"])(
  "binds %s to App Server build inputs independently of Renderer",
  (name) => {
    const root = fixture();
    const inputs = {
      sourceDirs: APP_SERVER_SOURCE_DIRS,
      sourceFiles: APP_SERVER_SOURCE_FILES,
    };
    const rendererInputs = {
      sourceDirs: RENDERER_SOURCE_DIRS,
      sourceFiles: RENDERER_SOURCE_FILES,
    };
    const before = fingerprintBuildInputs(root, inputs);
    const renderer = fingerprintBuildInputs(root, rendererInputs);
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "configuration");
    expect(fingerprintBuildInputs(root, inputs).sha256).not.toBe(before.sha256);
    expect(fingerprintBuildInputs(root, rendererInputs)).toEqual(renderer);
  },
);

for (const script of ["build-renderer.mjs", "build-renderer-smoke.mjs"]) {
  it.each(["stable", "change-source", "failure"])(
    `${script} records actual child-build outcome: %s`,
    (mode) => {
      const root = fixture();
      const commands = path.join(root, "commands");
      fs.mkdirSync(commands);
      const compiler = path.join(commands, "compiler.cjs");
      fs.writeFileSync(
        compiler,
        `
        const fs = require("node:fs");
        const assert = require("node:assert/strict");
        const mode = process.env.LIME_RENDERER_BUILD_TEST_MODE;
        assert.equal(JSON.parse(fs.readFileSync(".lime/electron-renderer-build.json")).status, "building");
        if (mode === "failure") process.exit(7);
        if (mode === "change-source") fs.writeFileSync("src/App.tsx", "changed during compile");
        fs.writeFileSync("dist/index.html", "new compiler entry");
      `,
      );
      if (process.platform === "win32")
        fs.writeFileSync(
          path.join(commands, "npx.cmd"),
          `@"${process.execPath}" "${compiler}" %*\r\n`,
        );
      else
        fs.writeFileSync(
          path.join(commands, "npx"),
          `#!${process.execPath}\nrequire(${JSON.stringify(compiler)});\n`,
          { mode: 0o755 },
        );
      const result = spawnSync(
        process.execPath,
        [path.join(repository, "scripts/electron", script)],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 15_000,
          env: {
            ...process.env,
            PATH: `${commands}${path.delimiter}${process.env.PATH}`,
            LIME_RENDERER_BUILD_TEST_MODE: mode,
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status === 0).toBe(mode === "stable");
      expect(inspectRendererBuildReceipt(root).ready).toBe(mode === "stable");
      expect(
        fs.existsSync(path.join(root, ".lime/electron-renderer-build.lock")),
      ).toBe(false);
      if (mode === "change-source")
        expect(result.stderr).toContain("inputs changed");
      if (mode === "failure") expect(result.stderr).toContain("exited with 7");
    },
  );
}
