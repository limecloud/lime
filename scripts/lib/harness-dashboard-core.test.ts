import { describe, expect, it } from "vitest";

import { renderHarnessDashboardHtml } from "./harness-dashboard-core.mjs";

describe("harness-dashboard-core", () => {
  it("应把 summary、trend、cleanup 渲染成单一事实源 dashboard", () => {
    const html = renderHarnessDashboardHtml({
      title: "Harness Engine Dashboard",
      summaryReport: {
        generatedAt: "2026-04-12T08:00:00.000Z",
        totals: {
          readyCount: 2,
          invalidCount: 1,
        },
      },
      trendReport: {
        generatedAt: "2026-04-12T08:01:00.000Z",
        signals: ["current gap 保持为 0。"],
        samples: [
          {
            generatedAt: "2026-04-12T08:00:00.000Z",
            sourcePath: "/tmp/history/summary.json",
            totals: {
              caseCount: 2,
              readyCount: 2,
              invalidCount: 0,
              currentObservabilityGapCaseCount: 0,
              degradedObservabilityGapCaseCount: 1,
            },
          },
        ],
      },
      cleanupReport: {
        generatedAt: "2026-04-12T08:02:00.000Z",
        signals: ["当前没有新的治理风险。"],
        recommendations: [
          {
            priority: "P1",
            title: "保持 current gap 为 0",
            rationale: ["继续沿用 current/degraded 分层。"],
            backlogTools: [
              "回看 browser replay / browser verification 失败样本，并把失败断言回挂到受影响主路径。",
            ],
            commands: ["npm run harness:eval:history:record"],
            focusVerificationFailureOutcomes: [
              "browserVerification (failure)",
            ],
            focusVerificationRecoveredOutcomes: [
              "artifactValidator (repaired)",
              "browserVerification (success)",
            ],
          },
        ],
        focus: {
          currentObservabilityVerificationOutcomes: [
            {
              signal: "browserVerification",
              outcome: "failure",
              state: "regressing",
              latest: {
                caseCount: 1,
              },
              delta: {
                caseCount: 1,
              },
            },
          ],
          currentRecoveredObservabilityVerificationOutcomes: [
            {
              signal: "artifactValidator",
              outcome: "repaired",
              state: "expanding",
              latest: {
                caseCount: 1,
              },
              delta: {
                caseCount: 1,
              },
            },
            {
              signal: "browserVerification",
              outcome: "success",
              state: "present",
              latest: {
                caseCount: 1,
              },
              delta: {
                caseCount: 0,
              },
            },
            {
              signal: "guiSmoke",
              outcome: "passed",
              state: "present",
              latest: {
                caseCount: 1,
              },
              delta: {
                caseCount: 0,
              },
            },
          ],
          degradedObservabilityVerificationOutcomes: [
            {
              signal: "guiSmoke",
              outcome: "failed",
              state: "present",
              latest: {
                caseCount: 1,
              },
              delta: {
                caseCount: 0,
              },
            },
          ],
        },
        summary: {
          trend: {
            sampleCount: 1,
            latestCurrentObservabilityGapCaseCount: 0,
            latestDegradedObservabilityGapCaseCount: 1,
            currentObservabilityGapCaseDelta: 0,
            degradedObservabilityGapCaseDelta: 0,
          },
          verificationOutcomes: {
            blockingFailureCaseCount: 2,
            advisoryFailureCaseCount: 0,
            recoveredCaseCount: 3,
            current: {
              blockingFailureCaseCount: 1,
              advisoryFailureCaseCount: 0,
              recoveredCaseCount: 3,
            },
            degraded: {
              blockingFailureCaseCount: 1,
              advisoryFailureCaseCount: 0,
            },
          },
          governance: {
            violationCount: 0,
          },
        },
      },
    });

    expect(html).toContain("Harness Engine Nightly Dashboard");
    expect(html).toContain("Harness Engine Dashboard");
    expect(html).toContain("Current Gap");
    expect(html).toContain("Degraded Gap");
    expect(html).toContain("Current Blocking");
    expect(html).toContain("Current Advisory");
    expect(html).toContain("Current Recovered");
    expect(html).toContain("Degraded Blocking");
    expect(html).toContain("Recovered Outcomes");
    expect(html).toContain("Cleanup 建议");
    expect(html).toContain("Observability Gap 角色");
    expect(html).toContain("Verification Outcome 焦点");
    expect(html).toContain("Current Recovered Baseline");
    expect(html).toContain("current");
    expect(html).toContain("degraded");
    expect(html).toContain("browserVerification");
    expect(html).toContain("failure");
    expect(html).toContain("success");
    expect(html).toContain("artifactValidator");
    expect(html).toContain("repaired");
    expect(html).toContain("guiSmoke");
    expect(html).toContain("failed");
    expect(html).toContain("artifact validator 已执行修复");
    expect(html).toContain("浏览器验证已有成功样本");
    expect(html).toContain("当前 Recovered 基线");
    expect(html).toContain(
      "artifactValidator (repaired)、browserVerification (success)、guiSmoke (passed)",
    );
    expect(html).toContain("关注 failure outcome");
    expect(html).toContain("关注 recovered outcome");
    expect(html).toContain("artifactValidator (repaired)");
    expect(html).toContain("后续动作");
    expect(html).toContain(
      "回看 browser replay / browser verification 失败样本，并把失败断言回挂到受影响主路径。",
    );
    expect(html).toContain("推荐命令");
    expect(html).toContain("summary - history - trend - cleanup");
  });
});
