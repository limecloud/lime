import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createVitestSmokeConfig,
  runVitestSmoke,
} from "./vitest-smoke-runner.mjs";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  const spawn = vi.fn();
  return {
    ...actual,
    default: { ...actual.default, spawnSync: spawn },
    spawnSync: spawn,
  };
});

describe("vitest smoke runner current aliases", () => {
  it("generates temporary Vitest config with current desktop-host and workspace aliases", () => {
    const rootDir = process.cwd();
    const config = createVitestSmokeConfig(rootDir);

    try {
      const content = fs.readFileSync(config.configPath, "utf8");

      expect(content).toContain("src/lib/desktop-host");
      expect(content).toContain("plugin-dialog.ts");
      expect(content).toContain("plugin-shell.ts");
      expect(content).toContain("plugin-deep-link.ts");
      expect(content).toContain("packages/app-server-client/src/browser.ts");
      expect(content).toContain(
        "packages/agent-runtime-client/src/sessionGateway.ts",
      );
      expect(content).toContain("packages/agent-ui-contracts/src/index.ts");
      expect(content).toContain(
        "packages/agent-runtime-projection/src/index.ts",
      );
      expect(content).toContain("packages/agent-runtime-ui/src/index.ts");
      expect(content).not.toContain(["src/lib/", "ta", "uri-mock"].join(""));
      expect(path.basename(path.dirname(config.configPath))).toMatch(
        /^vitest-smoke-/,
      );
      expect(path.basename(path.dirname(config.configPath))).not.toMatch(
        /^lime-/,
      );
    } finally {
      config.cleanup();
    }

    expect(fs.existsSync(config.configPath)).toBe(false);
  });
});

describe("vitest smoke execution evidence", () => {
  const options = {
    rootDir: process.cwd(),
    label: "terminal UI",
    args: ["current.test.tsx", "-t", "completed"],
    logPrefix: "smoke:test",
    env: { LIME_ALLOW_LIVE_PROVIDER_SMOKE: "0" },
  };
  const passedReport = {
    success: true,
    numPassedTests: 3,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPendingTests: 17,
  };
  let configPath;
  let reportPath;

  function spawnWithReport(report, result = { status: 0 }) {
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      configPath = args[args.indexOf("--config") + 1];
      reportPath = args[args.indexOf("--outputFile") + 1];
      if (report !== undefined) {
        fs.writeFileSync(
          reportPath,
          typeof report === "string" ? report : JSON.stringify(report),
        );
      }
      return result;
    });
  }

  beforeEach(() => {
    configPath = undefined;
    reportPath = undefined;
    vi.mocked(spawnSync).mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(fs.existsSync(configPath)).toBe(false);
    expect(fs.existsSync(reportPath)).toBe(false);
  });

  it("requires real executed tests while allowing intentional filtered skips", () => {
    spawnWithReport(passedReport);

    expect(runVitestSmoke(options)).toMatchObject({
      label: "terminal UI",
      status: "pass",
      executedTests: 3,
      args: options.args,
    });
    expect(spawnSync).toHaveBeenCalledWith(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "exec",
        "--",
        "vitest",
        "run",
        ...options.args,
        "--config",
        configPath,
        "--reporter=default",
        "--reporter=json",
        "--outputFile",
        reportPath,
      ],
      expect.objectContaining({
        cwd: options.rootDir,
        stdio: "inherit",
        env: expect.objectContaining(options.env),
      }),
    );
  });

  it.each([
    [
      "all skipped",
      { ...passedReport, numPassedTests: 0, numPendingTests: 20 },
    ],
    ["no tests", { ...passedReport, numPassedTests: 0, numPendingTests: 0 }],
    ["failed tests", { ...passedReport, numFailedTests: 1 }],
    ["failed suite", { ...passedReport, numFailedTestSuites: 1 }],
    ["unsuccessful run", { ...passedReport, success: false }],
    ["invalid count", { ...passedReport, numPassedTests: "3" }],
    ["missing counts", { success: true }],
    ["null report", null],
  ])("rejects an exit-zero %s report", (_label, report) => {
    spawnWithReport(report);

    expect(() => runVitestSmoke(options)).toThrow(
      "[smoke:test] terminal UI 未通过有效测试",
    );
  });

  it.each([
    ["missing", undefined],
    ["malformed", "{incomplete"],
  ])("fails closed on a %s report", (_label, report) => {
    spawnWithReport(report);

    expect(() => runVitestSmoke(options)).toThrow(
      "[smoke:test] terminal UI 缺少有效 Vitest 执行报告",
    );
  });

  it("preserves a nonzero child exit without accepting a passing report", () => {
    spawnWithReport(passedReport, { status: 2 });

    expect(() => runVitestSmoke(options)).toThrow(
      expect.objectContaining({ exitCode: 2 }),
    );
  });

  it("rejects signal termination instead of reporting a pass", () => {
    spawnWithReport(passedReport, { status: null, signal: "SIGTERM" });

    expect(() => runVitestSmoke(options)).toThrow("exit=null, signal=SIGTERM");
  });

  it("propagates spawn failures and still cleans isolated artifacts", () => {
    const error = new Error("spawn unavailable");
    spawnWithReport(undefined, { status: null, error });

    expect(() => runVitestSmoke(options)).toThrow(error);
  });
});
