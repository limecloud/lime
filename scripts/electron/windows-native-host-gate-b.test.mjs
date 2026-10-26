import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseArgs,
  resolveInstalledResourcesRoot,
  assertComputerUseSnapshot,
} from "./windows-native-host-gate-b.mjs";

const roots = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("windows-native-host-gate-b", () => {
  const snapshot = () => ({
    readiness: "ready",
    generation: 2,
    targets: [
      {
        identity: {
          type: "native",
          appId: "win32:c:\\windows\\notepad.exe",
          processId: 42,
          windowId: "101:12345",
        },
        nativeApp: {
          type: "windows",
          publisherName: "CN=Fixture Publisher",
          productName: "Notepad",
          binaryName: "notepad.exe",
        },
        capabilities: [
          "observe",
          "screenshot",
          "click",
          "type",
          "key",
          "scroll",
          "drag",
        ],
        locked: false,
      },
    ],
  });

  it("验收新的真实驱动快照合同，不把旧 unavailable helper 记为通过", () => {
    const valid = snapshot();
    expect(assertComputerUseSnapshot(valid)).toEqual(valid.targets[0].identity);
    for (const readiness of ["blocked", "unavailable", "permission_required"])
      expect(() => assertComputerUseSnapshot({ ...valid, readiness })).toThrow(
        "not ready",
      );
    expect(() => assertComputerUseSnapshot({ ...valid, targets: [] })).toThrow(
      "no verifiable",
    );
    expect(() =>
      assertComputerUseSnapshot({ ...valid, generation: 0 }),
    ).toThrow("generation");
  });

  it("拒绝没有精确窗口、签名应用身份或完整动作能力的快照", () => {
    for (const change of [
      (target) => {
        target.identity.windowId = "101";
      },
      (target) => {
        target.identity.processId = 0;
      },
      (target) => {
        target.nativeApp.publisherName = "";
      },
      (target) => {
        target.nativeApp.productName = "";
      },
      (target) => {
        target.nativeApp.binaryName = "";
      },
      (target) => {
        target.locked = true;
      },
      (target) => {
        target.capabilities = ["observe"];
      },
      (target) => {
        target.capabilities = "observe screenshot click type key scroll drag";
      },
    ]) {
      const invalid = snapshot();
      change(invalid.targets[0]);
      expect(() => assertComputerUseSnapshot(invalid)).toThrow();
    }
  });
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
