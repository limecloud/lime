import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tempRoots: string[] = [];

function createTempRoot() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "lime-harness-review-evals-"),
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

function createHarnessManifest(overrides?: Record<string, unknown>) {
  return {
    manifestVersion: "v1",
    title: "Test Harness Eval Manifest",
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
    suites: [],
    ...overrides,
  };
}

function createWorkspaceSessionArtifacts(tempRoot: string, sessionId: string) {
  const workspaceRoot = path.join(tempRoot, "workspace");
  const sessionRoot = path.join(
    workspaceRoot,
    ".lime",
    "harness",
    "sessions",
    sessionId,
  );
  const replayDir = path.join(sessionRoot, "replay");
  const reviewDir = path.join(sessionRoot, "review");
  ensureDir(replayDir);
  ensureDir(reviewDir);

  const handoffRoot = path.join(sessionRoot, "handoff");
  const evidenceRoot = path.join(sessionRoot, "evidence");
  const inputPayload = {
    session: {
      sessionId: sessionId,
      threadId: `${sessionId}-thread`,
    },
    task: {
      goalSummary: "验证 review decision 会进入 replay/eval 资产",
    },
    classification: {
      suiteTags: ["conversation-runtime", "replay"],
      failureModes: ["pending_request"],
      primaryBlockingKind: "pending_request",
    },
    runtimeContext: {
      pendingRequests: [
        {
          id: "req-1",
        },
      ],
    },
    observability: {
      correlation: {
        correlationKeys: ["session_id", "thread_id", "turn_id"],
      },
      signalCoverage: [
        {
          signal: "correlation",
          status: "exported",
        },
        {
          signal: "timeline",
          status: "exported",
        },
        {
          signal: "requestTelemetry",
          status: "exported",
        },
        {
          signal: "artifactValidator",
          status: "known_gap",
        },
      ],
      verificationSummary: {
        artifactValidator: {
          applicable: true,
          recordCount: 1,
          issueCount: 1,
          repairedCount: 1,
          fallbackUsedCount: 0,
        },
        browserVerification: {
          recordCount: 1,
          successCount: 1,
          failureCount: 0,
          unknownCount: 0,
          latestUpdatedAt: "2026-03-27T11:22:00Z",
        },
        guiSmoke: {
          status: "completed",
          exitCode: 0,
          passed: true,
          updatedAt: "2026-03-27T11:23:30Z",
          hasOutputPreview: true,
        },
      },
    },
    linkedArtifacts: {
      handoffBundle: {
        relativeRoot: `.lime/harness/sessions/${sessionId}/handoff`,
        absoluteRoot: handoffRoot,
      },
      evidencePack: {
        relativeRoot: `.lime/harness/sessions/${sessionId}/evidence`,
        absoluteRoot: evidenceRoot,
      },
    },
  };
  const expectedPayload = {
    sessionId: sessionId,
    threadId: `${sessionId}-thread`,
    goalSummary: "验证 review decision 会进入 replay/eval 资产",
    successCriteria: ["人工审核状态进入 eval 摘要"],
    blockingChecks: ["review decision 不再停留在工作区孤岛"],
    artifactChecks: ["review-decision.json 被识别"],
    graderSuggestion: {
      preferredMode: "manual_review",
      requiresHumanReview: true,
    },
  };
  const evidencePayload = {
    handoffBundle: {
      relativeRoot: `.lime/harness/sessions/${sessionId}/handoff`,
      absoluteRoot: handoffRoot,
    },
    evidencePack: {
      relativeRoot: `.lime/harness/sessions/${sessionId}/evidence`,
      absoluteRoot: evidenceRoot,
    },
    observabilitySummary: inputPayload.observability,
  };
  const reviewDecisionPayload = {
    schemaVersion: "v1",
    contractShape: "lime_review_decision_template",
    decision: {
      decisionStatus: "accepted",
      decisionSummary: "确认该失败应沉淀为长期回归样本。",
      chosenFixStrategy: "继续把人工审核结果挂到 replay/eval 主链。",
      riskLevel: "high",
      riskTags: ["runtime", "eval"],
      humanReviewer: "Lime Maintainer",
      reviewedAt: "2026-03-27T12:00:00Z",
      followupActions: ["补 trend 汇总"],
      regressionRequirements: ["npm run harness:eval"],
      notes: `工作区目录 ${workspaceRoot} 已参与人工审核。`,
    },
  };

  writeJson(path.join(replayDir, "input.json"), inputPayload);
  writeJson(path.join(replayDir, "expected.json"), expectedPayload);
  writeJson(path.join(replayDir, "evidence-links.json"), evidencePayload);
  writeText(
    path.join(replayDir, "grader.md"),
    `# Grader\n\n- 工作区：\`${workspaceRoot}\`\n`,
  );
  writeJson(
    path.join(reviewDir, "review-decision.json"),
    reviewDecisionPayload,
  );
  writeText(
    path.join(reviewDir, "review-decision.md"),
    `# Review\n\n- 工作区：\`${workspaceRoot}\`\n`,
  );

  return {
    workspaceRoot,
    replayDir,
    reviewDir,
  };
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

describe("Harness review decision / eval integration", () => {
  it("harness-replay-promote 应复制并脱敏 review decision 制品", () => {
    const tempRoot = createTempRoot();
    const { workspaceRoot } = createWorkspaceSessionArtifacts(
      tempRoot,
      "session-promote-1",
    );
    const manifestPath = path.join(tempRoot, "manifest.json");
    const fixturesRoot = path.join(tempRoot, "fixtures");

    writeJson(
      manifestPath,
      createHarnessManifest({
        suites: [
          {
            id: "repo-promoted-replays",
            title: "仓库沉淀 Replay 样本",
            cases: [],
          },
        ],
      }),
    );

    const result = runNodeScript("scripts/harness-replay-promote.mjs", [
      "--workspace-root",
      workspaceRoot,
      "--session-id",
      "session-promote-1",
      "--slug",
      "review-promoted-case",
      "--manifest",
      manifestPath,
      "--fixtures-root",
      fixturesRoot,
      "--format",
      "json",
    ]);

    const promotedCaseDir = path.join(fixturesRoot, "review-promoted-case");
    const promotedReviewJson = JSON.parse(
      fs.readFileSync(
        path.join(promotedCaseDir, "review-decision.json"),
        "utf8",
      ),
    );
    const promotedReviewMarkdown = fs.readFileSync(
      path.join(promotedCaseDir, "review-decision.md"),
      "utf8",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const caseEntry = manifest.suites[0].cases[0];

    expect(result.reviewDecisionStatus).toBe("accepted");
    expect(promotedReviewJson.decision.decisionStatus).toBe("accepted");
    expect(promotedReviewJson.decision.notes).toContain("/workspace/lime");
    expect(promotedReviewMarkdown).toContain("/workspace/lime");
    expect(caseEntry.reviewDecision).toMatchObject({
      decisionStatus: "accepted",
      riskLevel: "high",
      humanReviewer: "Lime Maintainer",
    });
  });

  it("harness-eval-runner 应在 workspace replay discovery 中读取 sibling review decision", () => {
    const tempRoot = createTempRoot();
    const { workspaceRoot } = createWorkspaceSessionArtifacts(
      tempRoot,
      "session-runner-1",
    );
    const manifestPath = path.join(tempRoot, "manifest.json");

    writeJson(
      manifestPath,
      createHarnessManifest({
        suites: [
          {
            id: "workspace-replay-discovery",
            title: "工作区 Replay 自动发现",
            cases: [
              {
                id: "workspace-session-replays",
                title: "工作区会话 Replay 样本",
                source: "workspace_replay_discovery",
                root: ".lime/harness/sessions",
                allowZeroMatches: false,
                tags: ["workspace", "replay"],
              },
            ],
          },
        ],
      }),
    );

    const summary = runNodeScript("scripts/harness-eval-runner.mjs", [
      "--format",
      "json",
      "--manifest",
      manifestPath,
      "--workspace-root",
      workspaceRoot,
      "--no-strict",
    ]);

    expect(summary.totals.reviewDecisionRecordedCount).toBe(1);
    expect(summary.totals.observabilityGapCaseCount).toBe(1);
    expect(summary.totals.currentObservabilityGapCaseCount).toBe(1);
    expect(summary.totals.degradedObservabilityGapCaseCount).toBe(0);
    expect(summary.breakdowns.reviewDecisionStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "accepted",
          caseCount: 1,
        }),
      ]),
    );
    expect(summary.breakdowns.reviewRiskLevels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "high",
          caseCount: 1,
        }),
      ]),
    );
    expect(summary.breakdowns.observabilitySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "artifactValidator:known_gap",
          caseCount: 1,
        }),
      ]),
    );
    expect(summary.breakdowns.observabilityVerificationOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "artifactValidator:issues_present",
          caseCount: 1,
        }),
        expect.objectContaining({
          name: "artifactValidator:repaired",
          caseCount: 1,
        }),
        expect.objectContaining({
          name: "browserVerification:success",
          caseCount: 1,
        }),
        expect.objectContaining({
          name: "guiSmoke:passed",
          caseCount: 1,
        }),
      ]),
    );
    expect(summary.breakdowns.currentObservabilityVerificationOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "browserVerification:success",
          caseCount: 1,
        }),
      ]),
    );
    expect(summary.breakdowns.degradedObservabilityVerificationOutcomes).toEqual(
      [],
    );
    expect(summary.suites[0].cases[0]).toMatchObject({
      reviewDecisionStatus: "accepted",
      reviewRiskLevel: "high",
      reviewHumanReviewer: "Lime Maintainer",
      observabilityGapCount: 1,
      observabilityVerificationOutcomes: expect.arrayContaining([
        "artifactValidator:issues_present",
        "artifactValidator:repaired",
        "browserVerification:success",
        "guiSmoke:passed",
      ]),
    });
  });

  it("harness-eval-trend-report 应聚合人工审核状态与风险等级变化", () => {
    const tempRoot = createTempRoot();
    const baselinePath = path.join(tempRoot, "baseline.json");
    const latestPath = path.join(tempRoot, "latest.json");

    writeJson(baselinePath, {
      generatedAt: "2026-03-27T10:00:00Z",
      totals: {
        suiteCount: 1,
        caseCount: 1,
        readyCount: 1,
        invalidCount: 0,
        pendingRequestCaseCount: 0,
        needsHumanReviewCount: 1,
        observabilityGapCaseCount: 1,
        currentObservabilityGapCaseCount: 1,
        degradedObservabilityGapCaseCount: 0,
      },
      breakdowns: {
        suiteTags: [],
        failureModes: [],
        reviewDecisionStatuses: [
          {
            name: "needs_more_evidence",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 1,
          },
        ],
        reviewRiskLevels: [
          {
            name: "high",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 1,
          },
        ],
        observabilitySignals: [],
        observabilityVerificationOutcomes: [
          {
            name: "browserVerification:unknown",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 1,
          },
        ],
        currentObservabilityVerificationOutcomes: [
          {
            name: "browserVerification:unknown",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 1,
          },
        ],
        degradedObservabilityVerificationOutcomes: [],
      },
      suites: [],
    });

    writeJson(latestPath, {
      generatedAt: "2026-03-27T12:00:00Z",
      totals: {
        suiteCount: 1,
        caseCount: 1,
        readyCount: 1,
        invalidCount: 0,
        pendingRequestCaseCount: 0,
        needsHumanReviewCount: 0,
        observabilityGapCaseCount: 1,
        currentObservabilityGapCaseCount: 0,
        degradedObservabilityGapCaseCount: 1,
      },
      breakdowns: {
        suiteTags: [],
        failureModes: [],
        reviewDecisionStatuses: [
          {
            name: "accepted",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        reviewRiskLevels: [
          {
            name: "medium",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        observabilitySignals: [
          {
            name: "artifactValidator:known_gap",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        observabilityVerificationOutcomes: [
          {
            name: "browserVerification:failure",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
          {
            name: "guiSmoke:failed",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        currentObservabilityVerificationOutcomes: [],
        degradedObservabilityVerificationOutcomes: [
          {
            name: "browserVerification:failure",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
          {
            name: "guiSmoke:failed",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
      },
      suites: [],
    });

    const report = runNodeScript("scripts/harness-eval-trend-report.mjs", [
      "--format",
      "json",
      "--input",
      baselinePath,
      "--input",
      latestPath,
    ]);

    expect(report.classificationDeltas.reviewDecisionStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "accepted",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
        expect.objectContaining({
          name: "needs_more_evidence",
          delta: expect.objectContaining({
            caseCount: -1,
          }),
        }),
      ]),
    );
    expect(report.classificationDeltas.reviewRiskLevels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "high",
          delta: expect.objectContaining({
            caseCount: -1,
          }),
        }),
        expect.objectContaining({
          name: "medium",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
      ]),
    );
    expect(report.classificationDeltas.observabilitySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "artifactValidator:known_gap",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
      ]),
    );
    expect(
      report.classificationDeltas.observabilitySignals.find(
        (entry) => entry.name === "requestTelemetry:known_gap",
        ),
    ).toBeUndefined();
    expect(report.classificationDeltas.observabilityVerificationOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "browserVerification:failure",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
        expect.objectContaining({
          name: "browserVerification:unknown",
          delta: expect.objectContaining({
            caseCount: -1,
          }),
        }),
        expect.objectContaining({
          name: "guiSmoke:failed",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
      ]),
    );
    expect(
      report.classificationDeltas.currentObservabilityVerificationOutcomes,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "browserVerification:unknown",
          delta: expect.objectContaining({
            caseCount: -1,
          }),
        }),
      ]),
    );
    expect(
      report.classificationDeltas.degradedObservabilityVerificationOutcomes,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "browserVerification:failure",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
        expect.objectContaining({
          name: "guiSmoke:failed",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
      ]),
    );
    expect(report.delta.currentObservabilityGapCaseCount).toBe(-1);
    expect(report.delta.degradedObservabilityGapCaseCount).toBe(1);
    expect(report.latest.totals.currentObservabilityGapCaseCount).toBe(0);
    expect(report.latest.totals.degradedObservabilityGapCaseCount).toBe(1);
  });

  it("harness-eval-trend-report 应暴露 current recovered baseline 的新增趋势", () => {
    const tempRoot = createTempRoot();
    const baselinePath = path.join(tempRoot, "baseline-recovered.json");
    const latestPath = path.join(tempRoot, "latest-recovered.json");

    writeJson(baselinePath, {
      generatedAt: "2026-03-28T10:00:00Z",
      totals: {
        suiteCount: 1,
        caseCount: 1,
        readyCount: 1,
        invalidCount: 0,
        pendingRequestCaseCount: 0,
        needsHumanReviewCount: 0,
        observabilityGapCaseCount: 0,
        currentObservabilityGapCaseCount: 0,
        degradedObservabilityGapCaseCount: 0,
      },
      breakdowns: {
        suiteTags: [],
        failureModes: [],
        reviewDecisionStatuses: [],
        reviewRiskLevels: [],
        observabilitySignals: [],
        observabilityVerificationOutcomes: [
          {
            name: "browserVerification:success",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        currentObservabilityVerificationOutcomes: [
          {
            name: "browserVerification:success",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        degradedObservabilityVerificationOutcomes: [],
      },
      suites: [],
    });

    writeJson(latestPath, {
      generatedAt: "2026-03-28T12:00:00Z",
      totals: {
        suiteCount: 1,
        caseCount: 1,
        readyCount: 1,
        invalidCount: 0,
        pendingRequestCaseCount: 0,
        needsHumanReviewCount: 0,
        observabilityGapCaseCount: 0,
        currentObservabilityGapCaseCount: 0,
        degradedObservabilityGapCaseCount: 0,
      },
      breakdowns: {
        suiteTags: [],
        failureModes: [],
        reviewDecisionStatuses: [],
        reviewRiskLevels: [],
        observabilitySignals: [],
        observabilityVerificationOutcomes: [
          {
            name: "artifactValidator:repaired",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
          {
            name: "browserVerification:success",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
          {
            name: "guiSmoke:passed",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        currentObservabilityVerificationOutcomes: [
          {
            name: "artifactValidator:repaired",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
          {
            name: "browserVerification:success",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
          {
            name: "guiSmoke:passed",
            caseCount: 1,
            readyCount: 1,
            invalidCount: 0,
            pendingRequestCaseCount: 0,
            needsHumanReviewCount: 0,
          },
        ],
        degradedObservabilityVerificationOutcomes: [],
      },
      suites: [],
    });

    const report = runNodeScript("scripts/harness-eval-trend-report.mjs", [
      "--format",
      "json",
      "--input",
      baselinePath,
      "--input",
      latestPath,
    ]);

    expect(report.latest.totals.currentRecoveredVerificationCaseCount).toBe(3);
    expect(report.delta.currentRecoveredVerificationCaseCount).toBe(2);
    expect(
      report.classificationDeltas.currentRecoveredObservabilityVerificationOutcomes,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "artifactValidator:repaired",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
        expect.objectContaining({
          name: "browserVerification:success",
          delta: expect.objectContaining({
            caseCount: 0,
          }),
        }),
        expect.objectContaining({
          name: "guiSmoke:passed",
          delta: expect.objectContaining({
            caseCount: 1,
          }),
        }),
      ]),
    );
    expect(report.signals).toContain(
      "current recovered verification baseline `artifactValidator:repaired` 新增 1，说明主线路径正在形成正向基线。",
    );
    expect(report.signals).toContain(
      "current recovered verification baseline `guiSmoke:passed` 新增 1，说明主线路径正在形成正向基线。",
    );
  });
});
