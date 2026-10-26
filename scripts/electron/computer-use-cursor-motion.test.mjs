import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("真实 C++/Swift 共用指针运动计算，保持热点、按压/释放、DPI 和减少动态效果", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "lime-cursor-motion-"));
  const compiler =
    process.env.CXX || (process.platform === "win32" ? "cl" : "clang++");
  const msvc = /(?:^|[\\/])(?:cl|clang-cl)(?:\.exe)?$/iu.test(compiler);
  const output = path.join(
    directory,
    process.platform === "win32" ? "motion.exe" : "motion",
  );
  const source = path.resolve(
    "electron/native/windows/tests/computer-use-cursor-motion-test.cpp",
  );
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
            "/utf-8",
            source,
            `/Fe:${output}`,
            `/Fo:${directory}${path.sep}`,
          ]
        : ["-std=c++17", "-Wall", "-Wextra", "-Werror", source, "-o", output],
    );
    expect(run(output, [])).toContain("RESULT passed=19 failed=0");
    if (process.platform !== "darwin") return;
    const swift = path.join(directory, "main.swift");
    const swiftOutput = path.join(directory, "motion-swift");
    writeFileSync(
      swift,
      `
import Foundation
var motion = ComputerUseCursorMotion()
func trace(_ value: ComputerUseCursorTransform) {
    print([value.a, value.b, value.c, value.d].map { String($0) }.joined(separator: " "))
}
computerUseCursorReset(&motion, 20, 30, 1, true)
computerUseCursorMove(&motion, 40, 42, 1.016)
computerUseCursorPress(&motion, true, 1.020)
trace(computerUseCursorSample(&motion, 1.050, false))
computerUseCursorPress(&motion, false, 1.060)
trace(computerUseCursorSample(&motion, 1.100, false))
trace(computerUseCursorSample(&motion, 1.400, false))
trace(computerUseCursorSample(&motion, 1.450, true))
computerUseCursorPress(&motion, false, 1.500)
computerUseCursorAttach(&motion, false, 1.500)
trace(computerUseCursorSample(&motion, 1.600, false))
computerUseCursorAttach(&motion, true, 1.600)
trace(computerUseCursorSample(&motion, 1.700, false))
trace(computerUseCursorSample(&motion, 1.900, false))
computerUseCursorAttach(&motion, false, 1.900)
trace(computerUseCursorSample(&motion, 1.950, true))
`,
    );
    run("swiftc", [
      "-import-objc-header",
      path.resolve("electron/native/computer-use-cursor-motion.h"),
      swift,
      "-o",
      swiftOutput,
    ]);
    const numbers = (text) => text.trim().split(/\s+/u).map(Number);
    const cpp = numbers(run(output, ["--trace"]));
    const nativeSwift = numbers(run(swiftOutput, []));
    expect(cpp).toHaveLength(32);
    expect(nativeSwift).toHaveLength(cpp.length);
    nativeSwift.forEach((value, index) =>
      expect(value).toBeCloseTo(cpp[index], 12),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
