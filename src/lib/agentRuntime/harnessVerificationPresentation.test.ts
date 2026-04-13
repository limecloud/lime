import { describe, expect, it } from "vitest";

import {
  buildHarnessEvidenceVerificationCardPresentations,
  resolveHarnessVerificationOutcomeBadgePresentation,
} from "./harnessVerificationPresentation";

describe("harnessVerificationPresentation", () => {
  it("应统一 outcome 徽标文案与样式", () => {
    expect(
      resolveHarnessVerificationOutcomeBadgePresentation("success"),
    ).toEqual({
      label: "通过",
      variant: "secondary",
    });
    expect(
      resolveHarnessVerificationOutcomeBadgePresentation("blocking_failure"),
    ).toEqual({
      label: "阻塞失败",
      variant: "destructive",
    });
    expect(
      resolveHarnessVerificationOutcomeBadgePresentation("advisory_failure"),
    ).toEqual({
      label: "提示失败",
      variant: "outline",
    });
    expect(
      resolveHarnessVerificationOutcomeBadgePresentation("recovered"),
    ).toEqual({
      label: "已恢复",
      variant: "outline",
    });
    expect(resolveHarnessVerificationOutcomeBadgePresentation()).toEqual({
      label: "未定",
      variant: "outline",
    });
  });

  it("应把 evidence verification summary 统一转换成前端展示卡片", () => {
    expect(
      buildHarnessEvidenceVerificationCardPresentations({
        artifact_validator: {
          applicable: true,
          record_count: 1,
          issue_count: 2,
          repaired_count: 1,
          fallback_used_count: 0,
          outcome: "blocking_failure",
        },
        browser_verification: {
          record_count: 2,
          success_count: 1,
          failure_count: 1,
          unknown_count: 0,
          outcome: "advisory_failure",
        },
        gui_smoke: {
          status: "failed",
          exit_code: 1,
          passed: false,
          has_output_preview: true,
          outcome: "recovered",
        },
        focus_verification_failure_outcomes: [],
        focus_verification_recovered_outcomes: [],
      }),
    ).toEqual([
      {
        key: "artifact_validator",
        title: "Artifact 校验",
        badge: {
          label: "阻塞失败",
          variant: "destructive",
        },
        description: "记录 1 · issues 2 · repaired 1 · fallback 0",
      },
      {
        key: "browser_verification",
        title: "浏览器验证",
        badge: {
          label: "提示失败",
          variant: "outline",
        },
        description: "记录 2 · 成功 1 · 失败 1 · 未判定 0",
      },
      {
        key: "gui_smoke",
        title: "GUI Smoke",
        badge: {
          label: "已恢复",
          variant: "outline",
        },
        description: "状态 failed · exit 1 · 未通过",
      },
    ]);
  });

  it("应为缺失或不适用的验证提供统一兜底文案", () => {
    expect(
      buildHarnessEvidenceVerificationCardPresentations({
        artifact_validator: {
          applicable: false,
          record_count: 0,
          issue_count: 0,
          repaired_count: 0,
          fallback_used_count: 0,
        },
        browser_verification: undefined,
        gui_smoke: {
          passed: true,
          has_output_preview: false,
        },
        focus_verification_failure_outcomes: [],
        focus_verification_recovered_outcomes: [],
      }),
    ).toEqual([
      {
        key: "artifact_validator",
        title: "Artifact 校验",
        badge: {
          label: "未定",
          variant: "outline",
        },
        description: "当前没有适用的 Artifact 校验。",
      },
      {
        key: "gui_smoke",
        title: "GUI Smoke",
        badge: {
          label: "未定",
          variant: "outline",
        },
        description: "状态 未知 · exit 未知 · 已通过",
      },
    ]);
  });
});
