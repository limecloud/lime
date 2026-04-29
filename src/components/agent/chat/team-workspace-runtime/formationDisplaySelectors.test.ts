import { describe, expect, it } from "vitest";
import {
  buildRuntimeFormationDisplayState,
  buildSelectedTeamPlanDisplayState,
} from "./formationDisplaySelectors";

describe("formationDisplaySelectors", () => {
  it("已选 Team 但无 runtime formation 时，应产出计划分工展示模型", () => {
    const state = buildSelectedTeamPlanDisplayState({
      selectedTeamLabel: "代码排障团队",
      selectedTeamSummary: "分析、执行、验证三段式推进。",
      selectedTeamRoles: [
        {
          id: "explorer",
          label: "分析",
          summary: "负责收敛问题边界。",
        },
      ],
    });

    expect(state.hasSelectedTeamPlan).toBe(true);
    expect(state.summaryBadges.map((badge) => badge.text)).toEqual([
      "分工方案 · 代码排障团队",
      "1 个计划分工",
    ]);
    expect(state.roleCards).toEqual([
      {
        id: "explorer",
        label: "分析",
        summary: "负责收敛问题边界。",
      },
    ]);
  });

  it("runtime formation 已就绪时，应产出状态、当前进展与参考分工", () => {
    const state = buildRuntimeFormationDisplayState({
      teamDispatchPreviewState: {
        requestId: "runtime-1",
        status: "formed",
        label: "修复 Team",
        summary: "分析、执行、验证协作闭环。",
        members: [
          {
            id: "member-1",
            label: "分析",
            summary: "收敛问题边界。",
            skillIds: [],
            status: "planned",
          },
        ],
        blueprint: {
          label: "代码排障团队",
          summary: "分析、执行、验证三段式推进。",
          roles: [
            {
              id: "explorer",
              label: "分析",
              summary: "先定位问题与影响面。",
            },
          ],
        },
        updatedAt: Date.now(),
      },
    });

    expect(state.hasRuntimeFormation).toBe(true);
    expect(state.hint).toContain("当前任务的分工已经准备好");
    expect(state.summaryBadges.map((badge) => badge.text)).toEqual([
      "分工方案 · 修复分工方案",
      "已就绪",
      "1 条当前进展",
      "参考方案 · 代码排障团队",
    ]);
    expect(state.panelHeadline).toBe("任务分工已准备好");
    expect(state.memberCards[0]).toMatchObject({
      label: "分析",
      badgeLabel: "待分配",
    });
    expect(state.blueprintRoleCards[0]).toMatchObject({
      label: "分析",
      summary: "先定位问题与影响面。",
    });
    expect(state.noticeText).toContain("当前分工方案已就绪");
    expect(state.noticeText).toContain("任务拆出后");
    expect(state.noticeText).toContain("当前进展");
  });

  it("runtime formation 失败时，应优先使用失败原因", () => {
    const state = buildRuntimeFormationDisplayState({
      teamDispatchPreviewState: {
        requestId: "runtime-2",
        status: "failed",
        label: "失败的 Team",
        summary: null,
        members: [],
        blueprint: null,
        errorMessage: "Provider 认证失败，无法生成 Team。",
        updatedAt: Date.now(),
      },
    });

    expect(state.panelDescription).toBe(
      "Provider 认证失败，无法生成分工方案。",
    );
    expect(state.emptyDetail).toBe("Provider 认证失败，无法生成分工方案。");
    expect(state.noticeText).toBe("Provider 认证失败，无法生成分工方案。");
  });
});
