import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
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

function runNodeScriptAsync(scriptRelativePath: string, args: string[]) {
  return new Promise<unknown>((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(repoRoot, scriptRelativePath), ...args],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(JSON.parse(stdout));
      },
    );
  });
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
  it("默认入口应产出完整 harness artifact 套件", () => {
    const tempRoot = createTempRoot();
    const historyDir = path.join(tempRoot, ".lime", "harness", "history");
    const workspaceRoot = path.join(tempRoot, "workspace");

    const result = runNodeScript("scripts/harness-eval-history-record.mjs", [
      "--format",
      "json",
      "--history-dir",
      historyDir,
      "--workspace-root",
      workspaceRoot,
    ]);

    const reportsRoot = path.join(tempRoot, ".lime", "harness", "reports");
    const summaryJsonPath = path.join(reportsRoot, "harness-eval-summary.json");
    const summaryMarkdownPath = path.join(reportsRoot, "harness-eval-summary.md");
    const trendJsonPath = path.join(reportsRoot, "harness-eval-trend.json");
    const trendMarkdownPath = path.join(reportsRoot, "harness-eval-trend.md");
    const cleanupJsonPath = path.join(reportsRoot, "harness-cleanup-report.json");
    const cleanupMarkdownPath = path.join(reportsRoot, "harness-cleanup-report.md");
    const dashboardHtmlPath = path.join(reportsRoot, "harness-dashboard.html");

    expect(result.summary.outputJsonPath).toBe(summaryJsonPath);
    expect(result.summary.outputMarkdownPath).toBe(summaryMarkdownPath);
    expect(result.trend.outputJsonPath).toBe(trendJsonPath);
    expect(result.trend.outputMarkdownPath).toBe(trendMarkdownPath);
    expect(result.trend.currentRecoveredVerificationCaseCount).toBe(3);
    expect(result.trend.currentRecoveredBaselineFocus).toEqual(
      expect.arrayContaining([
        "artifactValidator:repaired",
        "browserVerification:success",
        "guiSmoke:passed",
      ]),
    );
    expect(result.cleanup.outputJsonPath).toBe(cleanupJsonPath);
    expect(result.cleanup.outputMarkdownPath).toBe(cleanupMarkdownPath);
    expect(result.cleanup.verificationFailureOutcomeFocus).toEqual(
      expect.arrayContaining([
        "artifactValidator:issues_present",
      ]),
    );
    expect(result.cleanup.verificationFailureCaseCount).toBe(1);
    expect(result.cleanup.verificationBlockingFailureCaseCount).toBe(0);
    expect(result.cleanup.verificationAdvisoryFailureCaseCount).toBe(1);
    expect(result.cleanup.verificationDegradedBlockingFailureCaseCount).toBe(0);
    expect(result.cleanup.verificationRecoveredCaseCount).toBe(3);
    expect(result.cleanup.currentVerificationRecoveredCaseCount).toBe(3);
    expect(result.cleanup.currentRecoveredBaselineFocus).toEqual(
      expect.arrayContaining([
        "artifactValidator:repaired",
        "browserVerification:success",
        "guiSmoke:passed",
      ]),
    );
    expect(result.dashboard.outputHtmlPath).toBe(dashboardHtmlPath);

    expect(fs.existsSync(summaryJsonPath)).toBe(true);
    expect(fs.existsSync(summaryMarkdownPath)).toBe(true);
    expect(fs.existsSync(trendJsonPath)).toBe(true);
    expect(fs.existsSync(trendMarkdownPath)).toBe(true);
    expect(fs.existsSync(cleanupJsonPath)).toBe(true);
    expect(fs.existsSync(cleanupMarkdownPath)).toBe(true);
    expect(fs.existsSync(dashboardHtmlPath)).toBe(true);

    const cleanupJson = JSON.parse(fs.readFileSync(cleanupJsonPath, "utf8"));
    expect(
      cleanupJson.recommendations.every(
        (entry: Record<string, unknown>) =>
          !Object.prototype.hasOwnProperty.call(
            entry,
            "focusObservabilityVerificationOutcomes",
          ),
      ),
    ).toBe(true);
    expect(() =>
      execFileSync(
        process.execPath,
        [
          path.join(repoRoot, "scripts/check-generated-slop-report.mjs"),
          "--input",
          cleanupJsonPath,
          "--format",
          "json",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    ).not.toThrow();
  }, 30_000);

  it("应记录本地 summary 历史，并生成非 seed 的 trend / cleanup", () => {
    const tempRoot = createTempRoot();
    const historyDir = path.join(tempRoot, ".lime", "harness", "history");
    const workspaceRoot = path.join(tempRoot, "workspace");
    const summaryJsonPath = path.join(
      tempRoot,
      ".lime",
      "harness",
      "reports",
      "harness-eval-summary.json",
    );
    const summaryMarkdownPath = path.join(
      tempRoot,
      ".lime",
      "harness",
      "reports",
      "harness-eval-summary.md",
    );
    const dashboardHtmlPath = path.join(
      tempRoot,
      ".lime",
      "harness",
      "reports",
      "harness-dashboard.html",
    );

    const firstResult = runNodeScript("scripts/harness-eval-history-record.mjs", [
      "--format",
      "json",
      "--history-dir",
      historyDir,
      "--workspace-root",
      workspaceRoot,
      "--summary-json",
      summaryJsonPath,
      "--summary-markdown",
      summaryMarkdownPath,
      "--dashboard-html",
      dashboardHtmlPath,
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
        "--summary-json",
        summaryJsonPath,
        "--summary-markdown",
        summaryMarkdownPath,
        "--dashboard-html",
        dashboardHtmlPath,
        "--output-json",
        path.join(tempRoot, "second.json"),
      ],
    );

    expect(firstResult.historyCount).toBe(1);
    expect(firstResult.trend.sampleCount).toBe(1);
    expect(firstResult.trend.currentObservabilityGapCaseCount).toBe(0);
    expect(firstResult.trend.degradedObservabilityGapCaseCount).toBe(1);
    expect(firstResult.trend.currentRecoveredVerificationCaseCount).toBe(3);
    expect(firstResult.trend.currentRecoveredBaselineFocus).toEqual(
      expect.arrayContaining([
        "artifactValidator:repaired",
        "browserVerification:success",
        "guiSmoke:passed",
      ]),
    );
    expect(firstResult.summary.outputJsonPath).toBe(summaryJsonPath);
    expect(firstResult.summary.outputMarkdownPath).toBe(summaryMarkdownPath);
    expect(firstResult.dashboard.outputHtmlPath).toBe(dashboardHtmlPath);

    expect(secondResult.historyCount).toBe(2);
    expect(secondResult.trend.sampleCount).toBe(2);
    expect(secondResult.trend.currentObservabilityGapCaseCount).toBe(0);
    expect(secondResult.trend.degradedObservabilityGapCaseCount).toBe(1);
    expect(secondResult.trend.currentRecoveredVerificationCaseCount).toBe(3);
    expect(secondResult.trend.currentRecoveredBaselineFocus).toEqual(
      expect.arrayContaining([
        "artifactValidator:repaired",
        "browserVerification:success",
        "guiSmoke:passed",
      ]),
    );
    expect(secondResult.cleanup.trendSampleCount).toBe(2);
    expect(secondResult.cleanup.currentObservabilityGapCaseCount).toBe(0);
    expect(secondResult.cleanup.degradedObservabilityGapCaseCount).toBe(1);
    expect(secondResult.cleanup.verificationFailureOutcomeFocus).toEqual(
      expect.arrayContaining([
        "artifactValidator:issues_present",
      ]),
    );
    expect(secondResult.cleanup.verificationFailureCaseCount).toBe(1);
    expect(secondResult.cleanup.verificationBlockingFailureCaseCount).toBe(0);
    expect(secondResult.cleanup.verificationAdvisoryFailureCaseCount).toBe(1);
    expect(secondResult.cleanup.verificationDegradedBlockingFailureCaseCount).toBe(0);
    expect(secondResult.cleanup.verificationRecoveredCaseCount).toBe(3);
    expect(secondResult.cleanup.currentVerificationRecoveredCaseCount).toBe(3);
    expect(secondResult.cleanup.currentRecoveredBaselineFocus).toEqual(
      expect.arrayContaining([
        "artifactValidator:repaired",
        "browserVerification:success",
        "guiSmoke:passed",
      ]),
    );
    expect(fs.existsSync(secondResult.recordedSummaryPath)).toBe(true);
    expect(fs.existsSync(summaryJsonPath)).toBe(true);
    expect(fs.existsSync(summaryMarkdownPath)).toBe(true);
    expect(fs.existsSync(dashboardHtmlPath)).toBe(true);
    const dashboardHtml = fs.readFileSync(dashboardHtmlPath, "utf8");
    expect(dashboardHtml).toContain("Harness Engine Nightly Dashboard");
    expect(dashboardHtml).toContain("Current Gap");
    expect(dashboardHtml).toContain("Degraded Gap");
    expect(dashboardHtml).toContain("Current Blocking");
    expect(dashboardHtml).toContain("Current Advisory");
    expect(dashboardHtml).toContain("Current Recovered");
    expect(dashboardHtml).toContain("Degraded Blocking");
    expect(dashboardHtml).toContain("Recovered Outcomes");
    expect(dashboardHtml).toContain("Cleanup 建议");
    expect(dashboardHtml).toContain("Observability Gap 角色");
    expect(dashboardHtml).toContain("Verification Outcome 焦点");
    expect(dashboardHtml).toContain("Current Recovered Baseline");
    expect(dashboardHtml).toContain("artifactValidator");
    expect(dashboardHtml).toContain("issues_present");
    expect(
      fs.existsSync(
        path.join(
          tempRoot,
          ".lime",
          "harness",
          "reports",
          "harness-eval-trend.json",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tempRoot,
          ".lime",
          "harness",
          "reports",
          "harness-cleanup-report.json",
        ),
      ),
    ).toBe(true);
  }, 30_000);

  it("并发记录 history 时不应覆盖已有样本", async () => {
    const tempRoot = createTempRoot();
    const historyDir = path.join(tempRoot, ".lime", "harness", "history");
    const workspaceRoot = path.join(tempRoot, "workspace");

    const [firstResult, secondResult] = (await Promise.all([
      runNodeScriptAsync("scripts/harness-eval-history-record.mjs", [
        "--format",
        "json",
        "--history-dir",
        historyDir,
        "--workspace-root",
        workspaceRoot,
      ]),
      runNodeScriptAsync("scripts/harness-eval-history-record.mjs", [
        "--format",
        "json",
        "--history-dir",
        historyDir,
        "--workspace-root",
        workspaceRoot,
      ]),
    ])) as Array<{ recordedSummaryPath: string }>;

    const historyFiles = fs
      .readdirSync(historyDir)
      .filter(
        (entry) =>
          entry.endsWith("-harness-eval-summary.json") ||
          /-harness-eval-summary-\d+\.json$/.test(entry),
      );

    expect(historyFiles).toHaveLength(2);
    expect(firstResult.recordedSummaryPath).not.toBe(secondResult.recordedSummaryPath);
  }, 30_000);
});
