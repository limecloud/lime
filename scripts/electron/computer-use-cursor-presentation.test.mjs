import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")(
  "真实 WindowServer 验证现役 Agent 指针三态、排序、淡出和 owner 交接",
  () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "lime-cursor-presentation-"),
    );
    const executable = path.join(directory, "cursor-presentation");
    const run = (command, args) => {
      const result = spawnSync(command, args, {
        encoding: "utf8",
        timeout: 45_000,
      });
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      return result.stdout;
    };
    try {
      run("swiftc", [
        "-parse-as-library",
        "-import-objc-header",
        path.resolve("electron/native/computer-use-cursor-motion.h"),
        path.resolve("electron/native/macos/macos-computer-use-cursor.swift"),
        path.resolve(
          "electron/native/macos/macos-computer-use-cursor-frames.swift",
        ),
        path.resolve(
          "scripts/electron/macos-computer-use-cursor-presentation-fixture.swift",
        ),
        "-framework",
        "AppKit",
        "-o",
        executable,
      ]);
      const receipt = JSON.parse(run(executable, []));
      if (process.env.LIME_CURSOR_PRESENTATION_RECEIPT_PATH) {
        writeFileSync(
          process.env.LIME_CURSOR_PRESENTATION_RECEIPT_PATH,
          `${JSON.stringify(receipt, null, 2)}\n`,
        );
      }
      expect(receipt.passed).toBe(receipt.reducedMotion ? 49 : 53);
      expect(receipt.inputInjected).toBe(false);
      expect(receipt.productSourceCompiled).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
