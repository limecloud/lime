import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

function runFixture(sourceFile, user32 = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "lime-cursor-transition-"));
  const compiler =
    process.env.CXX || (process.platform === "win32" ? "cl" : "clang++");
  const msvc = /(?:^|[\\/])(?:cl|clang-cl)(?:\.exe)?$/iu.test(compiler);
  const output = path.join(
    directory,
    process.platform === "win32" ? "presentation.exe" : "presentation",
  );
  const source = path.resolve("electron/native/windows/tests", sourceFile);
  const run = (command, args) => {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return result.stdout;
  };
  try {
    run(
      compiler,
      msvc
        ? [
            "/nologo",
            "/std:c++17",
            "/EHsc",
            "/W4",
            "/WX",
            "/O2",
            "/utf-8",
            source,
            ...(user32 ? ["user32.lib"] : []),
            `/Fe:${output}`,
            `/Fo:${directory}${path.sep}`,
          ]
        : [
            "-std=c++17",
            "-O2",
            "-Wall",
            "-Wextra",
            "-Werror",
            source,
            ...(user32 ? ["-luser32"] : []),
            "-o",
            output,
          ],
    );
    return JSON.parse(run(output, []));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it("编译现役 Windows 指针过渡与真实 DPI 像素，验证显隐、重入、减少动态效果及 Gaussian", () => {
  const receipt = runFixture("computer-use-cursor-presentation-test.cpp");
  expect(receipt.failed).toBe(0);
  expect(receipt.passed).toBeGreaterThanOrEqual(40);
  expect(receipt.productDpiFrames).toBe(3);
  if (process.env.LIME_WINDOWS_CURSOR_PRESENTATION_RECEIPT_PATH)
    writeFileSync(
      process.env.LIME_WINDOWS_CURSOR_PRESENTATION_RECEIPT_PATH,
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
}, 60_000);

it.skipIf(process.platform !== "win32")(
  "通过真实 Win32 窗口枚举验证指针相对排序、普通/置顶带与焦点",
  () => {
    const receipt = runFixture("computer-use-cursor-window-test.cpp", true);
    expect(receipt.failed).toBe(0);
    expect(receipt.passed).toBeGreaterThanOrEqual(16);
    expect(receipt.win32WindowOrder).toBe(true);
    if (process.env.LIME_WINDOWS_CURSOR_WINDOW_RECEIPT_PATH)
      writeFileSync(
        process.env.LIME_WINDOWS_CURSOR_WINDOW_RECEIPT_PATH,
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
  },
  60_000,
);
