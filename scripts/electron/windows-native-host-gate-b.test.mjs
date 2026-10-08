import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseArgs,
  resolveInstalledResourcesRoot,
} from "./windows-native-host-gate-b.mjs";

const roots = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("windows-native-host-gate-b", () => {
  it("通过真实 CLI 入口显示帮助并拒绝缺失安装路径", () => {
    const script = path.resolve(
      "scripts/electron/windows-native-host-gate-b.mjs",
    );
    const help = spawnSync(process.execPath, [script, "--help"], {
      encoding: "utf8",
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain(
      "Usage: node scripts/electron/windows-native-host-gate-b.mjs",
    );
    const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("result=failed");
  });

  it("保留 help 解析，不要求在本机启动 Windows runner", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("从已安装 Electron 可执行文件解析 resources 根目录", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lime-windows-gate-b-"));
    roots.push(root);
    const executable = path.join(root, "app-1.0.0", "Lime.exe");
    const resources = path.join(root, "app-1.0.0", "resources");
    mkdirSync(resources, { recursive: true });
    expect(resolveInstalledResourcesRoot(executable)).toBe(resources);
  });

  it("summary 必须记录候选 identity 与安装资源路径", () => {
    const source = readFileSync(
      "scripts/electron/windows-native-host-gate-b.mjs",
      "utf8",
    );
    expect(source).toContain(
      "candidateRunId: process.env.LIME_GATE_RUN_ID?.trim() || null",
    );
    expect(source).toContain("process.env.LIME_CANDIDATE_SHA");
    expect(source).toContain(
      "electronExecutable: path.resolve(options.electronExecutable)",
    );
    expect(source).toContain("path: helper.helperPath");
    expect(source).toContain("resourcesRoot,");
  });
});
