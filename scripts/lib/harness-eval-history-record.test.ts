import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tempRoots: string[] = [];

function createTempRoot() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "lime-harness-history-record-"),
  );
  tempRoots.push(tempRoot);
  return tempRoot;
}

function runNodeScript(scriptRelativePath: string, args: string[]) {
  const output = execFileSync(
    process.execPath,
    [path.join(repoRoot, scriptRelativePath), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output);
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe("harness-eval-history-record", () => {
  it("应记录本地 summary 历史，并生成非 seed 的 trend / cleanup", () => {
    const tempRoot = createTempRoot();
    const historyDir = path.join(tempRoot, "artifacts", "history");
    const workspaceRoot = path.join(tempRoot, "workspace");

    const firstResult = runNodeScript("scripts/harness-eval-history-record.mjs", [
      "--format",
      "json",
      "--history-dir",
      historyDir,
      "--workspace-root",
      workspaceRoot,
      "--output-json",
      path.join(tempRoot, "first.json"),
    ]);

    const secondResult = runNodeScript(
      "scripts/harness-eval-history-record.mjs",
      [
        "--format",
        "json",
        "--history-dir",
        historyDir,
        "--workspace-root",
        workspaceRoot,
        "--output-json",
        path.join(tempRoot, "second.json"),
      ],
    );

    expect(firstResult.historyCount).toBe(1);
    expect(firstResult.trend.sampleCount).toBe(1);

    expect(secondResult.historyCount).toBe(2);
    expect(secondResult.trend.sampleCount).toBe(2);
    expect(secondResult.cleanup.trendSampleCount).toBe(2);
    expect(fs.existsSync(secondResult.recordedSummaryPath)).toBe(true);
    expect(
      fs.existsSync(path.join(tempRoot, "artifacts", "harness-eval-trend.json")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tempRoot, "artifacts", "harness-cleanup-report.json"),
      ),
    ).toBe(true);
  });
});
