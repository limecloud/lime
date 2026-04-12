import { describe, expect, it } from "vitest";
import { buildTeamWorkspaceBoardChromeDisplayState } from "./boardChromeSelectors";

describe("boardChromeSelectors", () => {
  it("真实成员图应产出紧凑 chrome 标题与工具条 chips", () => {
    const state = buildTeamWorkspaceBoardChromeDisplayState({
      hasRuntimeSessions: true,
      isChildSession: false,
      totalTeamSessions: 2,
      siblingCount: 0,
      selectedSession: {
        name: "研究员",
        runtimeStatus: "running",
        updatedAt: 0,
        isCurrent: true,
      },
      zoom: 1,
      canWaitAnyActiveTeamSession: true,
      waitableCount: 2,
      canCloseCompletedTeamSessions: true,
      completedCount: 1,
      statusSummary: {
        running: 1,
        queued: 1,
      },
    });

    expect(state.boardHeadline).toBe("任务进行中 · 1 项处理中 / 1 项稍后开始");
    expect(state.boardHint).toBe(
      "这里只展示当前有哪些任务在处理、状态如何，以及最近更新到了哪里。",
    );
    expect(state.compactBoardHeadline).toBe(
      "任务进行中 · 1 项处理中 / 1 项稍后开始",
    );
    expect(state.compactToolbarChips).toEqual([
      { key: "focus", text: "当前焦点 研究员", tone: "summary" },
      { key: "status", text: "处理中", tone: "status", status: "running" },
      { key: "updated-at", text: "更新于 刚刚", tone: "muted" },
      { key: "current", text: "当前任务", tone: "muted" },
      { key: "waitable", text: "2 项处理中", tone: "muted" },
      { key: "completed", text: "1 项已完成", tone: "muted" },
    ]);
    expect(state.statusSummaryBadges).toEqual([
      { key: "running", text: "处理中 1", status: "running" },
      { key: "queued", text: "稍后开始 1", status: "queued" },
    ]);
  });

  it("forming 阶段应优先显示 runtime formation 的标题与提示", () => {
    const state = buildTeamWorkspaceBoardChromeDisplayState({
      hasRuntimeSessions: false,
      runtimeFormationTitle: "任务分工已准备好",
      runtimeFormationHint: "当前任务的分工已经准备好，任务拆出后会继续接手处理。",
      isChildSession: false,
      totalTeamSessions: 0,
      siblingCount: 0,
      selectedSession: null,
      zoom: 0.88,
      canWaitAnyActiveTeamSession: false,
      waitableCount: 0,
      canCloseCompletedTeamSessions: false,
      completedCount: 0,
      statusSummary: {},
    });

    expect(state.boardHeadline).toBe("任务分工已准备好");
    expect(state.boardHint).toBe("当前任务的分工已经准备好，任务拆出后会继续接手处理。");
    expect(state.compactBoardHeadline).toBe("任务分工已准备好");
    expect(state.compactToolbarChips).toEqual([
      { key: "focus", text: "等待任务接手", tone: "summary" },
    ]);
  });

  it("子线程应优先显示父会话标题与 sibling 提示", () => {
    const state = buildTeamWorkspaceBoardChromeDisplayState({
      hasRuntimeSessions: true,
      isChildSession: true,
      parentSessionName: "主线程总览",
      totalTeamSessions: 1,
      siblingCount: 2,
      selectedSession: null,
      zoom: 1,
      canWaitAnyActiveTeamSession: false,
      waitableCount: 0,
      canCloseCompletedTeamSessions: false,
      completedCount: 0,
      statusSummary: {
        completed: 1,
      },
    });

    expect(state.boardHeadline).toBe("主线程总览");
    expect(state.boardHint).toBe("当前任务正与 2 项并行子任务一起推进");
    expect(state.compactBoardHeadline).toBe("主线程总览");
    expect(state.statusSummaryBadges).toEqual([
      { key: "completed", text: "已完成 1", status: "completed" },
    ]);
  });
});
