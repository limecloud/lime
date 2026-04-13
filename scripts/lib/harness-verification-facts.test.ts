import { describe, expect, it } from "vitest";

import {
  buildAdvisoryVerificationFollowUp,
  buildAdvisoryVerificationRecommendationRationale,
  buildBlockingVerificationFollowUp,
  buildBlockingVerificationRecommendationRationale,
  buildObservabilityRecommendationBacklog,
  buildObservabilityRecommendationRationale,
  buildVerificationOutcomeSignalMessages,
  buildRecoveredVerificationRecommendationRationale,
  deriveVerificationDashboardPresentation,
  describeVerificationOutcome,
  formatVerificationOutcomeCompactLabels,
  buildRecoveredVerificationFollowUp,
  buildVerificationOutcomeEntriesFromBreakdowns,
  buildVerificationOutcomeEntriesFromDeltas,
  buildVerificationFocusEntriesFromDeltas,
  buildVerificationOutcomeSummary,
  deriveVerificationOutcomePresentationFromTrend,
  formatVerificationOutcomeCompactLabel,
  getVerificationOutcomeRole,
  getVerificationOutcomeWeight,
  hasVerificationOutcome,
  isVerificationFailureOutcome,
  isVerificationRecoveredOutcome,
  splitVerificationOutcomeName,
} from "./harness-verification-facts.mjs";

describe("harness-verification-facts", () => {
  it("应统一解析 outcome 名称、角色与权重", () => {
    expect(splitVerificationOutcomeName("browserVerification:failure")).toEqual({
      name: "browserVerification:failure",
      signal: "browserVerification",
      outcome: "failure",
    });
    expect(splitVerificationOutcomeName("guiSmoke")).toEqual({
      name: "guiSmoke",
      signal: "guiSmoke",
      outcome: "",
    });

    expect(getVerificationOutcomeRole("browserVerification", "failure")).toBe(
      "blocking_failure",
    );
    expect(getVerificationOutcomeRole("artifactValidator", "issues_present")).toBe(
      "advisory_failure",
    );
    expect(getVerificationOutcomeRole("browserVerification", "success")).toBe(
      "recovered",
    );
    expect(getVerificationOutcomeRole("other", "noop")).toBe("other");

    expect(isVerificationFailureOutcome("fallback_used")).toBe(true);
    expect(isVerificationRecoveredOutcome("repaired")).toBe(true);
    expect(getVerificationOutcomeWeight("failed")).toBe(140);
    expect(getVerificationOutcomeWeight("repaired")).toBe(70);
    expect(getVerificationOutcomeWeight("noop")).toBe(0);
  });

  it("应统一从 delta 与 breakdown 派生 verification entries 与 summary", () => {
    const deltaEntries = buildVerificationOutcomeEntriesFromDeltas([
      {
        name: "guiSmoke:failed",
        latest: { caseCount: 2 },
        delta: { caseCount: 1 },
      },
      {
        name: "browserVerification:success",
        latest: { caseCount: 1 },
        delta: { caseCount: 0 },
      },
    ]);
    const breakdownEntries = buildVerificationOutcomeEntriesFromBreakdowns([
      {
        name: "artifactValidator:issues_present",
        caseCount: 1,
      },
    ]);

    expect(deltaEntries.map((entry) => entry.name)).toEqual([
      "guiSmoke:failed",
      "browserVerification:success",
    ]);
    expect(breakdownEntries[0]).toMatchObject({
      signal: "artifactValidator",
      outcome: "issues_present",
      latest: { caseCount: 1 },
      delta: { caseCount: 0 },
    });

    expect(
      buildVerificationOutcomeSummary([...deltaEntries, ...breakdownEntries]),
    ).toMatchObject({
      failureCaseCount: 3,
      blockingFailureCaseCount: 2,
      advisoryFailureCaseCount: 1,
      recoveredCaseCount: 1,
      topBlockingFailureOutcomes: ["guiSmoke:failed"],
      topRecoveredOutcomes: ["browserVerification:success"],
    });
  });

  it("应从 trend classification deltas 派生 cleanup 可复用的 verification presentation", () => {
    const presentation = deriveVerificationOutcomePresentationFromTrend({
      sampleCount: 2,
      trendReport: {
        classificationDeltas: {
          observabilityVerificationOutcomes: [
            {
              name: "guiSmoke:failed",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
            {
              name: "artifactValidator:repaired",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
          ],
          currentObservabilityVerificationOutcomes: [
            {
              name: "guiSmoke:failed",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
            {
              name: "artifactValidator:repaired",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
          ],
          currentRecoveredObservabilityVerificationOutcomes: [
            {
              name: "artifactValidator:repaired",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
          ],
          degradedObservabilityVerificationOutcomes: [
            {
              name: "browserVerification:failure",
              latest: { caseCount: 1 },
              delta: { caseCount: 0 },
            },
          ],
        },
      },
    });

    expect(
      buildVerificationFocusEntriesFromDeltas([
        {
          name: "guiSmoke:failed",
          latest: { caseCount: 1 },
          delta: { caseCount: 1 },
        },
      ], 2)[0],
    ).toMatchObject({
      signal: "guiSmoke",
      outcome: "failed",
      state: "regressing",
    });
    expect(
      presentation.focusCurrentVerificationFailureOutcomes.map(
        (entry) => entry.name,
      ),
    ).toEqual(["guiSmoke:failed"]);
    expect(
      presentation.focusCurrentRecoveredVerificationOutcomes.map(
        (entry) => entry.name,
      ),
    ).toEqual(["artifactValidator:repaired"]);
    expect(
      presentation.focusDegradedVerificationFailureOutcomes.map(
        (entry) => entry.name,
      ),
    ).toEqual(["browserVerification:failure"]);
    expect(presentation.verificationOutcomeSummary).toMatchObject({
      failureCaseCount: 1,
      recoveredCaseCount: 1,
      current: {
        blockingFailureCaseCount: 1,
        recoveredCaseCount: 1,
      },
      degraded: {
        blockingFailureCaseCount: 1,
      },
    });
  });

  it("应统一生成 blocking/advisory/recovered follow-up 建议", () => {
    const blockingEntries = [
      {
        signal: "guiSmoke",
        outcome: "failed",
      },
      {
        signal: "browserVerification",
        outcome: "failure",
      },
    ];
    const advisoryEntries = [
      {
        signal: "artifactValidator",
        outcome: "issues_present",
      },
      {
        signal: "browserVerification",
        outcome: "unknown",
      },
    ];
    const recoveredEntries = [
      {
        signal: "artifactValidator",
        outcome: "repaired",
      },
      {
        signal: "browserVerification",
        outcome: "success",
      },
      {
        signal: "guiSmoke",
        outcome: "passed",
      },
    ];

    expect(
      hasVerificationOutcome(blockingEntries, "guiSmoke", "failed"),
    ).toBe(true);
    expect(
      hasVerificationOutcome(blockingEntries, "guiSmoke", "passed"),
    ).toBe(false);

    expect(buildBlockingVerificationFollowUp(blockingEntries)).toMatchObject({
      commands: [
        "npm run harness:eval",
        "npm run harness:eval:trend",
        "npm run verify:gui-smoke",
      ],
      backlogTools: expect.arrayContaining([
        "优先收敛 GUI 壳 / DevBridge / Workspace 主路径，再复跑 `npm run verify:gui-smoke`。",
        "回看 browser replay / browser verification 失败样本，并把失败断言回挂到受影响主路径。",
      ]),
      rationale: expect.arrayContaining([
        "current 样本已出现 guiSmoke:failed，先恢复 GUI 壳 / DevBridge / Workspace 主路径的最小可启动性。",
        "current 样本已出现 browserVerification:failure，应先回看 browser replay / verification 失败样本，把失败断言回挂到受影响主路径。",
      ]),
    });

    expect(buildAdvisoryVerificationFollowUp(advisoryEntries)).toMatchObject({
      backlogTools: expect.arrayContaining([
        "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。",
        "回看 browser verification 导出链，确保 evidence pack / replay / analysis handoff 写出明确 success 或 failure，而不是 unknown。",
      ]),
      rationale: expect.arrayContaining([
        "current 样本已出现 artifactValidator:issues_present，应先回看 validator issue 明细，再收敛 artifact 导出字段。",
        "current 样本已出现 browserVerification:unknown，需要先把浏览器验证结果收敛成明确 outcome，再继续扩大分析。",
      ]),
    });

    expect(buildRecoveredVerificationFollowUp(recoveredEntries)).toMatchObject({
      commands: [
        "npm run harness:eval",
        "npm run harness:eval:trend",
        "npm run verify:gui-smoke",
      ],
      backlogTools: expect.arrayContaining([
        "在 evidence pack / analysis handoff 里同时保留 artifact issue 与 repaired outcome，避免只剩修复结论而丢失修复上下文。",
        "把 browser verification 成功样本固定进 current replay 基线，后续 failure 或 unknown 直接对比这条正向路径。",
        "主路径变更时优先复跑 `npm run verify:gui-smoke`，确认 GUI 壳 / DevBridge / Workspace 不从 passed 回退。",
      ]),
      rationale: expect.arrayContaining([
        "current 样本已出现 artifactValidator:repaired，说明 artifact 修复链已经回到可复用的主路径。",
        "current 样本已出现 browserVerification:success，可把浏览器验证成功样本固化成主路径正向基线。",
        "current 样本已出现 guiSmoke:passed，可继续把 GUI smoke 通过链路当成桌面主路径的正向守卫。",
      ]),
    });
  });

  it("应统一为 dashboard 派生 verification presentation 与说明文案", () => {
    const presentation = deriveVerificationDashboardPresentation({
      summaryReport: {
        breakdowns: {
          observabilityVerificationOutcomes: [
            { name: "guiSmoke:failed", caseCount: 1 },
            { name: "browserVerification:success", caseCount: 1 },
          ],
          currentObservabilityVerificationOutcomes: [
            { name: "guiSmoke:failed", caseCount: 1 },
            { name: "browserVerification:success", caseCount: 1 },
          ],
          currentRecoveredObservabilityVerificationOutcomes: [
            { name: "browserVerification:success", caseCount: 1 },
          ],
        },
      },
      trendReport: {
        classificationDeltas: {
          observabilityVerificationOutcomes: [
            {
              name: "guiSmoke:failed",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
            {
              name: "browserVerification:success",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
          ],
          currentObservabilityVerificationOutcomes: [
            {
              name: "guiSmoke:failed",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
            {
              name: "browserVerification:success",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
          ],
          currentRecoveredObservabilityVerificationOutcomes: [
            {
              name: "browserVerification:success",
              latest: { caseCount: 1 },
              delta: { caseCount: 1 },
            },
          ],
          degradedObservabilityVerificationOutcomes: [],
        },
      },
      cleanupReport: {
        focus: {
          currentObservabilityVerificationOutcomes: [
            {
              signal: "artifactValidator",
              outcome: "fallback_used",
              latest: { caseCount: 2 },
              delta: { caseCount: 2 },
            },
          ],
        },
        summary: {
          verificationOutcomes: {
            current: {
              advisoryFailureCaseCount: 2,
            },
          },
        },
      },
    });

    expect(presentation.verificationSummary).toMatchObject({
      current: {
        blockingFailureCaseCount: 1,
        recoveredCaseCount: 1,
      },
    });
    expect(
      presentation.verificationFocusRows.map((entry) => entry.name),
    ).toEqual(["guiSmoke:failed"]);
    expect(
      presentation.currentRecoveredRows.map((entry) => entry.name),
    ).toEqual(["browserVerification:success"]);
    expect(presentation.currentRecoveredSummaryLabel).toBe(
      "browserVerification (success)",
    );
    expect(
      formatVerificationOutcomeCompactLabel("artifactValidator:repaired"),
    ).toBe("artifactValidator (repaired)");
    expect(
      formatVerificationOutcomeCompactLabels(
        [
          { signal: "artifactValidator", outcome: "repaired" },
          "browserVerification:success",
        ],
        2,
      ),
    ).toEqual([
      "artifactValidator (repaired)",
      "browserVerification (success)",
    ]);
    expect(
      describeVerificationOutcome({
        signal: "browserVerification",
        outcome: "success",
      }),
    ).toContain("浏览器验证已有成功样本");
  });

  it("应统一生成 verification summary signal 文案", () => {
    expect(
      buildVerificationOutcomeSignalMessages({
        focusVerificationFailureOutcomes: [
          { signal: "browserVerification", outcome: "failure" },
        ],
        verificationOutcomeSummary: {
          failureFocusCount: 1,
          failureCaseCount: 1,
          recoveredFocusCount: 1,
          recoveredCaseCount: 1,
        },
        currentVerificationOutcomeSummary: {
          blockingFailureCaseCount: 1,
          advisoryFailureCaseCount: 0,
          recoveredCaseCount: 1,
        },
        degradedVerificationOutcomeSummary: {
          blockingFailureCaseCount: 0,
        },
        currentRecoveredVerificationOutcomes: [
          { signal: "artifactValidator", outcome: "repaired" },
        ],
      }),
    ).toEqual([
      "当前 verification failure outcome 焦点：browserVerification (failure)。",
      "当前 verification failure 聚焦 1 类 outcome，共 1 个 case。",
      "当前 current 样本里有 1 个 blocking verification failure。",
      "当前没有额外的 advisory verification failure。",
      "当前 current recovered verification baseline：artifactValidator (repaired)。",
      "当前没有额外的 degraded blocking verification baseline。",
      "当前 verification recovered 聚焦 1 类 outcome，共 1 个 case。",
    ]);
  });

  it("应统一生成 recommendation 用的 verification rationale 片段", () => {
    expect(
      buildBlockingVerificationRecommendationRationale({
        topCurrentVerificationFailureOutcomes: [
          { signal: "browserVerification", outcome: "failure" },
        ],
        currentVerificationSummary: {
          blockingFailureCaseCount: 1,
          topBlockingFailureOutcomes: ["browserVerification:failure"],
        },
        degradedVerificationSummary: {
          blockingFailureCaseCount: 0,
        },
      }),
    ).toEqual([
      "当前 current verification failure outcome 焦点：browserVerification (failure)。",
      "其中 current blocking verification failure 共 1 个 case：browserVerification:failure。",
      "当前没有额外的 degraded blocking verification baseline。",
    ]);

    expect(
      buildAdvisoryVerificationRecommendationRationale({
        topCurrentVerificationFailureOutcomes: [
          { signal: "artifactValidator", outcome: "issues_present" },
        ],
        topDegradedVerificationFailureOutcomes: [
          { signal: "guiSmoke", outcome: "failed" },
        ],
        currentVerificationSummary: {
          advisoryFailureCaseCount: 1,
          topAdvisoryFailureOutcomes: ["artifactValidator:issues_present"],
        },
      }),
    ).toEqual([
      "当前 current verification failure outcome 焦点：artifactValidator (issues_present)。可用它们直接定位先补 artifact/browser/gui 哪一层。",
      "当前 current advisory verification failure 共 1 个 case：artifactValidator:issues_present。",
      "当前保留的 degraded verification baseline：guiSmoke (failed)。",
    ]);

    expect(
      buildRecoveredVerificationRecommendationRationale({
        topCurrentRecoveredVerificationOutcomes: [
          { signal: "artifactValidator", outcome: "repaired" },
        ],
        currentVerificationSummary: {
          recoveredCaseCount: 1,
        },
      }),
    ).toEqual([
      "当前 current recovered outcome 焦点：artifactValidator (repaired)。",
    ]);
  });

  it("应统一生成 observability recommendation 的混合文案与待办", () => {
    expect(
      buildObservabilityRecommendationRationale({
        trendSummary: {
          latestCurrentObservabilityGapCaseCount: 1,
          latestDegradedObservabilityGapCaseCount: 0,
        },
        topObservabilitySignals: ["requestTelemetry (known_gap)"],
        topCurrentVerificationFailureOutcomes: [
          { signal: "artifactValidator", outcome: "issues_present" },
        ],
        topDegradedVerificationFailureOutcomes: [
          { signal: "guiSmoke", outcome: "failed" },
        ],
        currentVerificationSummary: {
          advisoryFailureCaseCount: 1,
          topAdvisoryFailureOutcomes: ["artifactValidator:issues_present"],
        },
      }),
    ).toEqual([
      "当前仍有 1 个 current case 带着 observability 证据缺口进入 replay/eval。",
      "当前没有额外保留的 degraded observability gap 样本。",
      "当前缺口焦点：requestTelemetry (known_gap)。这些缺口会直接降低 analysis handoff、人工审核和 cleanup report 的判断质量。",
      "当前 current verification failure outcome 焦点：artifactValidator (issues_present)。可用它们直接定位先补 artifact/browser/gui 哪一层。",
      "当前 current advisory verification failure 共 1 个 case：artifactValidator:issues_present。",
      "当前保留的 degraded verification baseline：guiSmoke (failed)。",
    ]);

    expect(
      buildObservabilityRecommendationBacklog({
        topCurrentVerificationFailureOutcomes: [
          { signal: "artifactValidator", outcome: "issues_present" },
        ],
        advisoryFollowUpBacklogTools: [
          "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。",
        ],
      }),
    ).toEqual([
      "优先补 request telemetry 关联键、artifact validator outcome、browser/gui smoke 结果到 evidence pack / analysis handoff / replay。",
      "先对齐 current verification failure outcome：artifactValidator (issues_present)。",
      "回看 artifact validator issue 明细，并收敛 evidence pack / artifacts.json / analysis handoff 的 artifact 字段。",
    ]);
  });
});
