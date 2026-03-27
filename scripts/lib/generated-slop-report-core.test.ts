import { describe, expect, it } from "vitest";

import { buildGeneratedSlopReport } from "./generated-slop-report-core.mjs";

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
          readyRate: 0,
        },
        signals: ["样本数不足 2，当前仅形成 trend seed，还不能判断长期退化。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 1,
            reviewDecisionRecordedCount: 0,
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
            id: "team-subagent-scheduler-hook",
            classification: "compat",
            description: "compat hook",
            existingTargets: ["src/hooks/useSubAgentScheduler.ts"],
            references: [
              "src/components/agent/chat/hooks/useCompatSubagentRuntime.ts",
            ],
            testReferences: ["src/hooks/useSubAgentScheduler.test.tsx"],
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
    expect(report.summary.docFreshness.issueCount).toBe(0);
    expect(report.focus.failureModes[0].name).toBe("pending_request");
    expect(report.focus.reviewDecisionStatuses[0].name).toBe("pending_review");
    expect(report.focus.reviewRiskLevels[0].name).toBe("high");
    expect(report.focus.governanceSurfaces[0].id).toBe(
      "migration-setting-key-leak",
    );
    expect(report.recommendations.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "promote-high-value-replay",
        "replay-and-smoke-follow-up",
        "review-decision-follow-up",
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
          readyRate: -0.5,
        },
        signals: ["invalid case 增加 1，存在回归候选。"],
        baseline: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
          },
        },
        latest: {
          totals: {
            needsHumanReviewCount: 0,
            reviewDecisionRecordedCount: 0,
          },
        },
        classificationDeltas: {
          failureModes: [],
          suiteTags: [],
          reviewDecisionStatuses: [],
          reviewRiskLevels: [],
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
});
