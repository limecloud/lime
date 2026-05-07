import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tempRoots: string[] = [];

function createTempRoot() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "lime-harness-history-window-"),
  );
  tempRoots.push(tempRoot);
  return tempRoot;
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, payload: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, value: string) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

function delayMs(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function createHarnessManifest(caseDir: string) {
  return {
    manifestVersion: "v1",
    title: "Harness History Window Test Manifest",
    defaults: {
      requiredArtifacts: [
        "input.json",
        "expected.json",
        "grader.md",
        "evidence-links.json",
      ],
      requiredInputFields: [
        "session.sessionId",
        "session.threadId",
        "task.goalSummary",
        "classification.suiteTags",
        "classification.failureModes",
        "linkedArtifacts.handoffBundle.relativeRoot",
        "linkedArtifacts.evidencePack.relativeRoot",
      ],
      requiredExpectedFields: [
        "successCriteria",
        "blockingChecks",
        "artifactChecks",
        "graderSuggestion.preferredMode",
      ],
      requiredEvidenceFields: [
        "handoffBundle.relativeRoot",
        "evidencePack.relativeRoot",
      ],
    },
    suites: [
      {
        id: "repo-fixtures",
        title: "仓库固定 Replay 样本",
        cases: [
          {
            id: "fixture-history-window",
            title: "Harness 历史窗口样本",
            source: "repo_fixture",
            caseDir,
          },
        ],
      },
    ],
  };
}

function createReplayFixture(tempRoot: string) {
  const caseDir = path.join(tempRoot, "fixture-case");
  const handoffRoot = path.join(tempRoot, "handoff");
  const evidenceRoot = path.join(tempRoot, "evidence");

  writeJson(path.join(caseDir, "input.json"), {
    session: {
      sessionId: "fixture-history-session",
      threadId: "fixture-history-thread",
    },
    task: {
      goalSummary: "验证 harness eval history window",
    },
    classification: {
      suiteTags: ["conversation-runtime", "replay"],
      failureModes: ["pending_request"],
    },
    linkedArtifacts: {
      handoffBundle: {
        relativeRoot: ".lime/handoff",
        absoluteRoot: handoffRoot,
      },
      evidencePack: {
        relativeRoot: ".lime/evidence",
        absoluteRoot: evidenceRoot,
      },
    },
  });
  writeJson(path.join(caseDir, "expected.json"), {
    sessionId: "fixture-history-session",
    threadId: "fixture-history-thread",
    goalSummary: "验证 harness eval history window",
    successCriteria: ["history snapshot 可以被 trend 使用"],
    blockingChecks: ["summary history 目录会保留最近窗口"],
    artifactChecks: ["history dir 中存在 harness-eval-summary.json"],
    graderSuggestion: {
      preferredMode: "summary_only",
      requiresHumanReview: false,
    },
  });
  writeJson(path.join(caseDir, "evidence-links.json"), {
    handoffBundle: {
      relativeRoot: ".lime/handoff",
      absoluteRoot: handoffRoot,
    },
    evidencePack: {
      relativeRoot: ".lime/evidence",
      absoluteRoot: evidenceRoot,
    },
  });
  writeText(path.join(caseDir, "grader.md"), "# Grader\n");

  return caseDir;
}

function runNodeScript(scriptRelativePath: string, args: string[]) {
  return new Promise<any>((resolve, reject) => {
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

describe("Harness eval history window", () => {
  it("history-record 应记录并裁剪历史窗口，trend 应复用该目录", async () => {
    const tempRoot = createTempRoot();
    const caseDir = createReplayFixture(tempRoot);
    const manifestPath = path.join(tempRoot, "manifest.json");
    const historyDir = path.join(tempRoot, "history");

    writeJson(manifestPath, createHarnessManifest(caseDir));

    await runNodeScript("scripts/harness-eval-history-record.mjs", [
      "--format",
      "json",
      "--manifest",
      manifestPath,
      "--history-dir",
      historyDir,
      "--retain",
      "2",
    ]);
    await delayMs(10);
    await runNodeScript("scripts/harness-eval-history-record.mjs", [
      "--format",
      "json",
      "--manifest",
      manifestPath,
      "--history-dir",
      historyDir,
      "--retain",
      "2",
    ]);
    await delayMs(10);
    await runNodeScript("scripts/harness-eval-history-record.mjs", [
      "--format",
      "json",
      "--manifest",
      manifestPath,
      "--history-dir",
      historyDir,
      "--retain",
      "2",
    ]);

    const historyFiles = fs
      .readdirSync(historyDir)
      .filter((entry) => entry.endsWith("-harness-eval-summary.json"))
      .sort();
    expect(historyFiles).toHaveLength(2);

    const report = await runNodeScript("scripts/harness-eval-trend-report.mjs", [
      "--format",
      "json",
      "--manifest",
      manifestPath,
      "--history-dir",
      historyDir,
    ]);

    expect(report.sampleCount).toBe(2);
    expect(report.signals).not.toContain(
      "样本数不足 2，当前仅形成 trend seed，还不能判断长期退化。",
    );
  }, 90_000);
});
