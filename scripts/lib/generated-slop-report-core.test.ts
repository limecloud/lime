import { describe, expect, it } from "vitest";

import {
  assertGeneratedSlopReportContract,
  buildGeneratedSlopReport,
  renderGeneratedSlopMarkdown,
} from "./generated-slop-report-core.mjs";

describe("generated-slop-report-core", () => {
  it("应把 trend seed 与活跃 legacy surface 转成治理建议", () => {
    const report = buildGeneratedSlopReport({
      repoRoot: "/tmp/lime",
      trendReport: {
        sampleCount: 1,
        delta: {
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
          reviewDecisionRecordedCount: 0,
          observabilityGapCaseCount: 1,
          currentObservabilityGapCaseCount: 1,
          degradedObservabilityGapCaseCount: 0,
          readyRate: 0,
        },
        signals: ["样本数不足 2，当前仅形成 trend seed，还不能判断长期退化。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 1,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 1,
            currentObservabilityGapCaseCount: 1,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        classificationDeltas: {
          failureModes: [
            {
              name: "pending_request",
              baseline: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 1,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 1,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          suiteTags: [
            {
              name: "conversation-runtime",
              baseline: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 1,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 1,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          reviewDecisionStatuses: [
            {
              name: "pending_review",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 0,
                invalidCount: 1,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 1,
              },
              delta: {
                caseCount: 1,
                readyCount: 0,
                invalidCount: 1,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 1,
              },
            },
          ],
          reviewRiskLevels: [
            {
              name: "high",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 0,
                invalidCount: 1,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 1,
              },
              delta: {
                caseCount: 1,
                readyCount: 0,
                invalidCount: 1,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 1,
              },
            },
          ],
          observabilitySignals: [
            {
              name: "artifactValidator:known_gap",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          observabilityVerificationOutcomes: [
            {
              name: "browserVerification:failure",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "artifactValidator:repaired",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          currentObservabilityVerificationOutcomes: [
            {
              name: "browserVerification:failure",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "artifactValidator:repaired",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          degradedObservabilityVerificationOutcomes: [],
        },
      },
      governanceReport: {
        summary: {
          zeroReferenceCandidates: [],
          classificationDriftCandidates: [],
          violations: [],
        },
        importResults: [
          {
            id: "settings-api-server-page-entry",
            classification: "dead-candidate",
            description: "deleted settings page entry",
            existingTargets: ["src/components/api-server/ApiServerPage.tsx"],
            references: [],
            testReferences: [],
            violations: [],
          },
        ],
        commandResults: [],
        frontendTextResults: [
          {
            id: "migration-setting-key-leak",
            classification: "deprecated",
            description: "migration keys",
            references: ["src-tauri/crates/core/src/database/migration/foo.rs"],
            testReferences: [],
            violations: [],
          },
        ],
        rustTextResults: [],
        rustTextCountResults: [],
      },
      docFreshnessReport: {
        summary: {
          monitoredDocumentCount: 10,
          existingDocumentCount: 10,
          issueCount: 0,
          missingDocumentCount: 0,
          missingRequiredReferenceCount: 0,
          brokenMarkdownLinkCount: 0,
          brokenCodePathReferenceCount: 0,
          deletedSurfaceReferenceCount: 0,
        },
        issues: [],
      },
      sources: {
        trend: { kind: "generated-current" },
        docFreshness: { kind: "live-scan" },
        governance: { kind: "live-scan" },
      },
    });

    expect(report.summary.trend.isSeed).toBe(true);
    expect(report.summary.trend.reviewDecisionBacklogCount).toBe(1);
    expect(report.summary.trend.latestObservabilityGapCaseCount).toBe(1);
    expect(report.summary.verificationOutcomes).toMatchObject({
      failureFocusCount: 1,
      recoveredFocusCount: 1,
      failureCaseCount: 1,
      blockingFailureFocusCount: 1,
      advisoryFailureFocusCount: 0,
      blockingFailureCaseCount: 1,
      advisoryFailureCaseCount: 0,
      recoveredCaseCount: 1,
      topFailureOutcomes: ["browserVerification:failure"],
      topBlockingFailureOutcomes: ["browserVerification:failure"],
      topAdvisoryFailureOutcomes: [],
      topRecoveredOutcomes: ["artifactValidator:repaired"],
      current: expect.objectContaining({
        blockingFailureCaseCount: 1,
        advisoryFailureCaseCount: 0,
        recoveredCaseCount: 1,
      }),
      degraded: expect.objectContaining({
        blockingFailureCaseCount: 0,
        advisoryFailureCaseCount: 0,
      }),
    });
    expect(report.summary.docFreshness.issueCount).toBe(0);
    expect(report.focus.failureModes[0].name).toBe("pending_request");
    expect(report.focus.reviewDecisionStatuses[0].name).toBe("pending_review");
    expect(report.focus.reviewRiskLevels[0].name).toBe("high");
    expect(report.focus.observabilitySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: "artifactValidator",
          status: "known_gap",
        }),
      ]),
    );
    expect(report.focus.observabilityVerificationOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: "browserVerification",
          outcome: "failure",
        }),
      ]),
    );
    expect(report.focus.currentObservabilityVerificationOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: "browserVerification",
          outcome: "failure",
        }),
      ]),
    );
    expect(report.focus.degradedObservabilityVerificationOutcomes).toEqual([]);
    expect(report.focus.governanceSurfaces[0].id).toBe(
      "migration-setting-key-leak",
    );
    expect(report.recommendations.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "promote-high-value-replay",
        "replay-and-smoke-follow-up",
        "review-decision-follow-up",
        "observability-evidence-follow-up",
        "recovered-baseline-follow-up",
        "governance-cleanup-priority",
        "doc-freshness-review",
      ]),
    );
    expect(
      report.recommendations.find(
        (entry) => entry.id === "review-decision-follow-up",
      )?.focusReviewRiskLevels,
    ).toContain("high");
    expect(
      report.recommendations.find((entry) => entry.id === "doc-freshness-review")
        ?.commands,
    ).toContain("npm run harness:doc-freshness");
    expect(
      report.recommendations.find(
        (entry) => entry.id === "observability-evidence-follow-up",
      )?.focusVerificationFailureOutcomes,
    ).toContain("browserVerification (failure)");
    expect(
      report.recommendations.find(
        (entry) => entry.id === "observability-evidence-follow-up",
      ),
    ).not.toHaveProperty("focusObservabilityVerificationOutcomes");
    expect(
      report.recommendations.find(
        (entry) => entry.id === "replay-and-smoke-follow-up",
      )?.priority,
    ).toBe("P0");
    expect(
      report.recommendations.find(
        (entry) => entry.id === "replay-and-smoke-follow-up",
      )?.commands,
    ).not.toContain("npm run verify:gui-smoke");
    expect(
      report.recommendations.find(
        (entry) => entry.id === "replay-and-smoke-follow-up",
      )?.backlogTools,
    ).toContain(
      "回看 browser replay / browser verification 失败样本，并把失败断言回挂到受影响主路径。",
    );
    expect(
      report.recommendations.find(
        (entry) => entry.id === "replay-and-smoke-follow-up",
      )?.rationale,
    ).toContain(
      "current 样本已出现 browserVerification:failure，应先回看 browser replay / verification 失败样本，把失败断言回挂到受影响主路径。",
    );
    expect(
      report.recommendations.find(
        (entry) => entry.id === "observability-evidence-follow-up",
      )?.priority,
    ).toBe("P1");
    expect(report.summary.trend.latestCurrentObservabilityGapCaseCount).toBe(1);
    expect(report.summary.trend.latestDegradedObservabilityGapCaseCount).toBe(0);
    expect(report.signals).toContain(
      "当前 verification failure outcome 焦点：browserVerification (failure)。",
    );
    expect(report.signals).toContain(
      "当前 verification failure 聚焦 1 类 outcome，共 1 个 case。",
    );
    expect(report.signals).toContain(
      "当前 current 样本里有 1 个 blocking verification failure。",
    );
    expect(report.signals).toContain(
      "当前没有额外的 advisory verification failure。",
    );
    expect(report.signals).toContain(
      "当前 current recovered verification baseline：artifactValidator (repaired)。",
    );
    expect(report.signals).toContain(
      "当前 verification recovered 聚焦 1 类 outcome，共 1 个 case。",
    );
  });

  it("应把 current guiSmoke failed 回挂成显式 GUI smoke 动作", () => {
    const report = buildGeneratedSlopReport({
      repoRoot: "/tmp/lime",
      trendReport: {
        sampleCount: 2,
        delta: {
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
          reviewDecisionRecordedCount: 0,
          observabilityGapCaseCount: 0,
          currentObservabilityGapCaseCount: 0,
          degradedObservabilityGapCaseCount: 0,
          readyRate: 0,
        },
        signals: ["当前没有检测到明显退化信号。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        classificationDeltas: {
          failureModes: [],
          suiteTags: [],
          reviewDecisionStatuses: [],
          reviewRiskLevels: [],
          observabilitySignals: [],
          observabilityVerificationOutcomes: [
            {
              name: "guiSmoke:failed",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          currentObservabilityVerificationOutcomes: [
            {
              name: "guiSmoke:failed",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          degradedObservabilityVerificationOutcomes: [],
        },
      },
      governanceReport: {
        summary: {
          zeroReferenceCandidates: [],
          classificationDriftCandidates: [],
          violations: [],
        },
        importResults: [],
        commandResults: [],
        frontendTextResults: [],
        rustTextResults: [],
        rustTextCountResults: [],
      },
      docFreshnessReport: {
        summary: {
          monitoredDocumentCount: 10,
          existingDocumentCount: 10,
          issueCount: 0,
          missingDocumentCount: 0,
          missingRequiredReferenceCount: 0,
          brokenMarkdownLinkCount: 0,
          brokenCodePathReferenceCount: 0,
          deletedSurfaceReferenceCount: 0,
        },
        issues: [],
      },
      sources: {
        trend: { kind: "input-json" },
        docFreshness: { kind: "input-json" },
        governance: { kind: "input-json" },
      },
    });

    const recommendation = report.recommendations.find(
      (entry) => entry.id === "replay-and-smoke-follow-up",
    );

    expect(recommendation?.priority).toBe("P0");
    expect(recommendation?.commands).toEqual(
      expect.arrayContaining([
        "npm run harness:eval",
        "npm run harness:eval:trend",
        "npm run verify:gui-smoke",
      ]),
    );
    expect(recommendation?.backlogTools).toContain(
      "优先收敛 GUI 壳 / DevBridge / Workspace 主路径，再复跑 `npm run verify:gui-smoke`。",
    );
    expect(recommendation?.rationale).toContain(
      "current 样本已出现 guiSmoke:failed，先恢复 GUI 壳 / DevBridge / Workspace 主路径的最小可启动性。",
    );
  });

  it("应把 current advisory verification outcome 回挂成具体补证据动作", () => {
    const report = buildGeneratedSlopReport({
      repoRoot: "/tmp/lime",
      trendReport: {
        sampleCount: 2,
        delta: {
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
          reviewDecisionRecordedCount: 0,
          observabilityGapCaseCount: 0,
          currentObservabilityGapCaseCount: 0,
          degradedObservabilityGapCaseCount: 0,
          readyRate: 0,
        },
        signals: ["当前没有检测到明显退化信号。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        classificationDeltas: {
          failureModes: [],
          suiteTags: [],
          reviewDecisionStatuses: [],
          reviewRiskLevels: [],
          observabilitySignals: [],
          observabilityVerificationOutcomes: [
            {
              name: "artifactValidator:issues_present",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "browserVerification:unknown",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          currentObservabilityVerificationOutcomes: [
            {
              name: "artifactValidator:issues_present",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "browserVerification:unknown",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          degradedObservabilityVerificationOutcomes: [],
        },
      },
      governanceReport: {
        summary: {
          zeroReferenceCandidates: [],
          classificationDriftCandidates: [],
          violations: [],
        },
        importResults: [],
        commandResults: [],
        frontendTextResults: [],
        rustTextResults: [],
        rustTextCountResults: [],
      },
      docFreshnessReport: {
        summary: {
          monitoredDocumentCount: 10,
          existingDocumentCount: 10,
          issueCount: 0,
          missingDocumentCount: 0,
          missingRequiredReferenceCount: 0,
          brokenMarkdownLinkCount: 0,
          brokenCodePathReferenceCount: 0,
          deletedSurfaceReferenceCount: 0,
        },
        issues: [],
      },
      sources: {
        trend: { kind: "input-json" },
        docFreshness: { kind: "input-json" },
        governance: { kind: "input-json" },
      },
    });

    const recommendation = report.recommendations.find(
      (entry) => entry.id === "observability-evidence-follow-up",
    );

    expect(
      report.recommendations.find(
        (entry) => entry.id === "replay-and-smoke-follow-up",
      ),
    ).toBeUndefined();
    expect(recommendation?.priority).toBe("P1");
    expect(recommendation?.commands).toEqual(
      expect.arrayContaining([
        "npm run harness:eval",
        "npm run harness:eval:trend",
        "npm run harness:cleanup-report",
      ]),
    );
    expect(recommendation?.commands).not.toContain("npm run verify:gui-smoke");
    expect(recommendation?.backlogTools).toContain(
      "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。",
    );
    expect(recommendation?.backlogTools).toContain(
      "回看 browser verification 导出链，确保 evidence pack / replay / analysis handoff 写出明确 success 或 failure，而不是 unknown。",
    );
    expect(recommendation?.rationale).toContain(
      "current 样本已出现 artifactValidator:issues_present，应先回看 validator issue 明细，再收敛 artifact 导出字段。",
    );
    expect(recommendation?.rationale).toContain(
      "current 样本已出现 browserVerification:unknown，需要先把浏览器验证结果收敛成明确 outcome，再继续扩大分析。",
    );
  });

  it("应把 current recovered verification outcome 固化成正向基线建议", () => {
    const report = buildGeneratedSlopReport({
      repoRoot: "/tmp/lime",
      trendReport: {
        sampleCount: 2,
        delta: {
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
          reviewDecisionRecordedCount: 0,
          observabilityGapCaseCount: 0,
          currentObservabilityGapCaseCount: 0,
          degradedObservabilityGapCaseCount: 0,
          readyRate: 0,
        },
        signals: ["当前没有检测到明显退化信号。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        classificationDeltas: {
          failureModes: [],
          suiteTags: [],
          reviewDecisionStatuses: [],
          reviewRiskLevels: [],
          observabilitySignals: [],
          observabilityVerificationOutcomes: [
            {
              name: "artifactValidator:repaired",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "browserVerification:success",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "guiSmoke:passed",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          currentObservabilityVerificationOutcomes: [
            {
              name: "artifactValidator:repaired",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "browserVerification:success",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "guiSmoke:passed",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          currentRecoveredObservabilityVerificationOutcomes: [
            {
              name: "artifactValidator:repaired",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "browserVerification:success",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
            {
              name: "guiSmoke:passed",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          degradedObservabilityVerificationOutcomes: [],
        },
      },
      governanceReport: {
        summary: {
          zeroReferenceCandidates: [],
          classificationDriftCandidates: [],
          violations: [],
        },
        importResults: [],
        commandResults: [],
        frontendTextResults: [],
        rustTextResults: [],
        rustTextCountResults: [],
      },
      docFreshnessReport: {
        summary: {
          monitoredDocumentCount: 10,
          existingDocumentCount: 10,
          issueCount: 0,
          missingDocumentCount: 0,
          missingRequiredReferenceCount: 0,
          brokenMarkdownLinkCount: 0,
          brokenCodePathReferenceCount: 0,
          deletedSurfaceReferenceCount: 0,
        },
        issues: [],
      },
      sources: {
        trend: { kind: "input-json" },
        docFreshness: { kind: "input-json" },
        governance: { kind: "input-json" },
      },
    });

    const recommendation = report.recommendations.find(
      (entry) => entry.id === "recovered-baseline-follow-up",
    );

    expect(report.summary.verificationOutcomes.recoveredCaseCount).toBe(3);
    expect(report.summary.verificationOutcomes.recoveredFocusCount).toBe(3);
    expect(report.summary.verificationOutcomes.topRecoveredOutcomes).toEqual(
      expect.arrayContaining([
        "artifactValidator:repaired",
        "browserVerification:success",
        "guiSmoke:passed",
      ]),
    );
    expect(report.summary.verificationOutcomes.current.recoveredCaseCount).toBe(3);
    expect(
      report.focus.currentRecoveredObservabilityVerificationOutcomes,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: "artifactValidator",
          outcome: "repaired",
        }),
        expect.objectContaining({
          signal: "browserVerification",
          outcome: "success",
        }),
        expect.objectContaining({
          signal: "guiSmoke",
          outcome: "passed",
        }),
      ]),
    );
    expect(recommendation?.priority).toBe("P2");
    expect(recommendation?.focusVerificationRecoveredOutcomes).toEqual(
      expect.arrayContaining([
        "artifactValidator (repaired)",
        "browserVerification (success)",
        "guiSmoke (passed)",
      ]),
    );
    expect(recommendation).not.toHaveProperty(
      "focusObservabilityVerificationOutcomes",
    );
    expect(recommendation?.commands).toEqual(
      expect.arrayContaining([
        "npm run harness:eval",
        "npm run harness:eval:trend",
        "npm run verify:gui-smoke",
      ]),
    );
    expect(recommendation?.backlogTools).toContain(
      "把 browser verification 成功样本固定进 current replay 基线，后续 failure 或 unknown 直接对比这条正向路径。",
    );
    expect(recommendation?.backlogTools).toContain(
      "主路径变更时优先复跑 `npm run verify:gui-smoke`，确认 GUI 壳 / DevBridge / Workspace 不从 passed 回退。",
    );
    expect(recommendation?.rationale).toContain(
      "current 样本已出现 browserVerification:success，可把浏览器验证成功样本固化成主路径正向基线。",
    );
    expect(recommendation?.rationale).toContain(
      "current 样本已出现 guiSmoke:passed，可继续把 GUI smoke 通过链路当成桌面主路径的正向守卫。",
    );
    expect(report.signals).toContain(
      "当前 current recovered verification baseline：artifactValidator (repaired)、browserVerification (success)、guiSmoke (passed)。",
    );
    expect(report.signals).toContain(
      "当前 verification recovered 聚焦 3 类 outcome，共 3 个 case。",
    );
  });

  it("仅 degraded observability gap 不应触发主线补证据建议", () => {
    const report = buildGeneratedSlopReport({
      repoRoot: "/tmp/lime",
      trendReport: {
        sampleCount: 2,
        delta: {
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
          reviewDecisionRecordedCount: 0,
          observabilityGapCaseCount: 0,
          currentObservabilityGapCaseCount: 0,
          degradedObservabilityGapCaseCount: 0,
          readyRate: 0,
        },
        signals: ["当前没有检测到明显退化信号。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 1,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 1,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 1,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 1,
          },
        },
        classificationDeltas: {
          failureModes: [],
          suiteTags: [],
          reviewDecisionStatuses: [],
          reviewRiskLevels: [],
          observabilitySignals: [
            {
              name: "requestTelemetry:known_gap",
              baseline: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          observabilityVerificationOutcomes: [],
          currentObservabilityVerificationOutcomes: [],
          degradedObservabilityVerificationOutcomes: [
            {
              name: "guiSmoke:failed",
              baseline: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
        },
      },
      governanceReport: {
        summary: {
          zeroReferenceCandidates: [],
          classificationDriftCandidates: [],
          violations: [],
        },
        importResults: [],
        commandResults: [],
        frontendTextResults: [],
        rustTextResults: [],
        rustTextCountResults: [],
      },
      docFreshnessReport: {
        summary: {
          monitoredDocumentCount: 10,
          existingDocumentCount: 10,
          issueCount: 0,
          missingDocumentCount: 0,
          missingRequiredReferenceCount: 0,
          brokenMarkdownLinkCount: 0,
          brokenCodePathReferenceCount: 0,
          deletedSurfaceReferenceCount: 0,
        },
        issues: [],
      },
      sources: {
        trend: { kind: "input-json" },
        docFreshness: { kind: "input-json" },
        governance: { kind: "input-json" },
      },
    });

    expect(report.summary.trend.latestObservabilityGapCaseCount).toBe(1);
    expect(report.summary.trend.latestCurrentObservabilityGapCaseCount).toBe(0);
    expect(report.summary.trend.latestDegradedObservabilityGapCaseCount).toBe(1);
    expect(report.summary.verificationOutcomes.failureCaseCount).toBe(1);
    expect(report.summary.verificationOutcomes.blockingFailureCaseCount).toBe(1);
    expect(report.summary.verificationOutcomes.advisoryFailureCaseCount).toBe(0);
    expect(report.summary.verificationOutcomes.recoveredCaseCount).toBe(0);
    expect(report.summary.verificationOutcomes.degraded.blockingFailureCaseCount).toBe(1);
    expect(
      report.recommendations.find(
        (entry) => entry.id === "observability-evidence-follow-up",
      ),
    ).toBeUndefined();
    expect(
      report.recommendations.find(
        (entry) => entry.id === "replay-and-smoke-follow-up",
      ),
    ).toBeUndefined();
    expect(report.signals).toContain(
      "当前 current 样本没有额外的 observability 证据缺口。",
    );
    expect(report.signals).toContain(
      "当前保留 1 个 degraded blocking verification failure 样本作为诊断基线。",
    );
    expect(report.signals).toContain(
      "当前保留 1 个 degraded observability gap 样本作为诊断基线。",
    );
    const markdown = renderGeneratedSlopMarkdown(report);
    expect(markdown).toContain("## Observability Gap 角色");
    expect(markdown).toContain("| current | 0 | 0 |");
    expect(markdown).toContain("| degraded | 1 | 0 |");
  });

  it("应把 governance 违规提升为 P0 守卫动作", () => {
    const report = buildGeneratedSlopReport({
      repoRoot: "/tmp/lime",
      trendReport: {
        sampleCount: 2,
        delta: {
          invalidCount: 1,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
          reviewDecisionRecordedCount: 0,
          observabilityGapCaseCount: 0,
          readyRate: -0.5,
        },
        signals: ["invalid case 增加 1，存在回归候选。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
          },
        },
        classificationDeltas: {
          failureModes: [],
          suiteTags: [],
          reviewDecisionStatuses: [],
          reviewRiskLevels: [],
          observabilitySignals: [],
          observabilityVerificationOutcomes: [],
        },
      },
      governanceReport: {
        summary: {
          zeroReferenceCandidates: [],
          classificationDriftCandidates: [],
          violations: ["chat-compat -> src/foo.ts"],
        },
        importResults: [],
        commandResults: [
          {
            id: "chat-compat-command",
            classification: "deprecated",
            description: "legacy command",
            referencesByCommand: {
              chat_create_session: ["src/lib/api/legacy.ts"],
            },
            testReferencesByCommand: {},
            violations: ["chat_create_session -> src/lib/api/legacy.ts"],
          },
        ],
        frontendTextResults: [],
        rustTextResults: [],
        rustTextCountResults: [],
      },
      docFreshnessReport: {
        summary: {
          monitoredDocumentCount: 10,
          existingDocumentCount: 9,
          issueCount: 2,
          missingDocumentCount: 0,
          missingRequiredReferenceCount: 1,
          brokenMarkdownLinkCount: 0,
          brokenCodePathReferenceCount: 1,
          deletedSurfaceReferenceCount: 0,
        },
        issues: [
          {
            kind: "missing-required-reference",
            documentPath: "docs/tech/harness/entropy-governance-workflow.md",
            detail: "harness-evals.md",
          },
          {
            kind: "broken-code-path-reference",
            documentPath: "docs/tech/harness/tooling-roadmap.md",
            detail: "scripts/missing-tool.mjs",
          },
        ],
      },
      sources: {
        trend: { kind: "input-json" },
        docFreshness: { kind: "input-json" },
        governance: { kind: "input-json" },
      },
    });

    expect(report.recommendations[0].id).toBe("contracts-and-boundary-guards");
    expect(report.recommendations[0].priority).toBe("P0");
    expect(report.signals).toContain("doc freshness 发现 2 个问题。");
    expect(report.focus.docFreshness.issueKinds[0]).toEqual({
      kind: "broken-code-path-reference",
      count: 1,
    });
    expect(report.recommendations[0].commands).toEqual(
      expect.arrayContaining([
        "npm run governance:legacy-report",
        "npm run test:contracts",
      ]),
    );
    expect(
      report.recommendations.find((entry) => entry.id === "doc-freshness-review")
        ?.priority,
    ).toBe("P1");
  });

  it("应把旧 requestTelemetry:unlinked 样本折叠成 known_gap", () => {
    const report = buildGeneratedSlopReport({
      repoRoot: "/tmp/lime",
      trendReport: {
        sampleCount: 2,
        delta: {
          invalidCount: 0,
          pendingRequestCaseCount: 0,
          needsHumanReviewCount: 0,
          reviewDecisionRecordedCount: 0,
          observabilityGapCaseCount: 1,
          currentObservabilityGapCaseCount: 1,
          degradedObservabilityGapCaseCount: 0,
          readyRate: 0,
        },
        signals: ["request telemetry 仍有旧样本待清理。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 0,
            currentObservabilityGapCaseCount: 0,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
            observabilityGapCaseCount: 1,
            currentObservabilityGapCaseCount: 1,
            degradedObservabilityGapCaseCount: 0,
          },
        },
        classificationDeltas: {
          failureModes: [],
          suiteTags: [],
          reviewDecisionStatuses: [],
          reviewRiskLevels: [],
          observabilitySignals: [
            {
              name: "requestTelemetry:unlinked",
              baseline: {
                caseCount: 0,
                readyCount: 0,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              latest: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
              delta: {
                caseCount: 1,
                readyCount: 1,
                invalidCount: 0,
                pendingRequestCaseCount: 0,
                needsHumanReviewCount: 0,
              },
            },
          ],
          observabilityVerificationOutcomes: [],
          currentObservabilityVerificationOutcomes: [],
          degradedObservabilityVerificationOutcomes: [],
          currentRecoveredObservabilityVerificationOutcomes: [],
        },
      },
      docFreshnessReport: {
        summary: {
          monitoredDocumentCount: 0,
          existingDocumentCount: 0,
          issueCount: 0,
          missingDocumentCount: 0,
          missingRequiredReferenceCount: 0,
          brokenMarkdownLinkCount: 0,
          brokenCodePathReferenceCount: 0,
          deletedSurfaceReferenceCount: 0,
        },
        issues: [],
      },
      governanceReport: {
        summary: {
          compatibilityCount: 0,
        },
      },
    });

    expect(report.focus.observabilitySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "requestTelemetry:known_gap",
          signal: "requestTelemetry",
          status: "known_gap",
        }),
      ]),
    );
    expect(report.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "observability-evidence-follow-up",
          priority: "P1",
        }),
      ]),
    );
  });

  it("应拒绝 recommendation 回流旧 verification outcome 字段", () => {
    expect(() =>
      assertGeneratedSlopReportContract({
        recommendations: [
          {
            id: "legacy-outcome-field",
            title: "旧字段示例",
            priority: "P1",
            rationale: ["示例"],
            commands: [],
            backlogTools: [],
            focusFailureModes: [],
            focusSuiteTags: [],
            focusReviewDecisionStatuses: [],
            focusReviewRiskLevels: [],
            focusVerificationFailureOutcomes: [],
            focusVerificationRecoveredOutcomes: [],
            focusSurfaceIds: [],
            focusObservabilityVerificationOutcomes: [
              "browserVerification (failure)",
            ],
          },
        ],
        focus: {
          observabilityVerificationOutcomes: [],
        },
      }),
    ).toThrow(/focusObservabilityVerificationOutcomes/);
  });
});
