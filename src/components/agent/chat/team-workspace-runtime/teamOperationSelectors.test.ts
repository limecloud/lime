import { describe, expect, it } from "vitest";
import {
  buildTeamOperationDisplayEntries,
  buildVisibleTeamOperationState,
  formatOperationUpdatedAt,
} from "./teamOperationSelectors";

describe("teamOperationSelectors", () => {
  it("wait 命中结果时应生成聚合结果条目", () => {
    const entries = buildTeamOperationDisplayEntries({
      sessionNameById: new Map([
        ["child-1", "研究员"],
        ["child-2", "执行器"],
      ]),
      teamWaitSummary: {
        awaitedSessionIds: ["child-1", "child-2"],
        timedOut: false,
        resolvedSessionId: "child-2",
        resolvedStatus: "completed",
        updatedAt: 1_710_000_100_000,
      },
    });

    expect(entries).toEqual([
      {
        id: "wait-1710000100000",
        title: "收到结果",
        detail: "刚才等到 执行器 返回了新结果，当前状态为已完成。",
        badgeClassName:
          "border border-emerald-200 bg-emerald-50 text-emerald-700",
        updatedAt: 1_710_000_100_000,
        targetSessionId: "child-2",
      },
    ]);
  });

  it("control 汇总应按 action 生成稳定标题与文案", () => {
    const entries = buildTeamOperationDisplayEntries({
      sessionNameById: new Map([["child-1", "研究员"]]),
      teamControlSummary: {
        action: "close",
        requestedSessionIds: ["child-1"],
        cascadeSessionIds: [],
        affectedSessionIds: ["child-1"],
        updatedAt: 1_710_000_200_000,
      },
    });

    expect(entries).toEqual([
      {
        id: "control-close-1710000200000",
        title: "暂停处理",
        detail: "刚才已暂停 研究员 的处理。",
        badgeClassName:
          "border border-slate-200 bg-slate-100 text-slate-700",
        updatedAt: 1_710_000_200_000,
        targetSessionId: "child-1",
      },
    ]);
  });

  it("应按更新时间倒序排序，并提供操作时间文案格式化", () => {
    const entries = buildTeamOperationDisplayEntries({
      sessionNameById: new Map([["child-1", "研究员"]]),
      teamWaitSummary: {
        awaitedSessionIds: ["child-1"],
        timedOut: true,
        updatedAt: 1_710_000_100_000,
      },
      teamControlSummary: {
        action: "resume",
        requestedSessionIds: ["child-1"],
        cascadeSessionIds: [],
        affectedSessionIds: ["child-1"],
        updatedAt: 1_710_000_200_000,
      },
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "control-resume-1710000200000",
      "wait-1710000100000",
    ]);
    expect(formatOperationUpdatedAt()).toBe("刚刚");
  });

  it("应只保留当前画布可见的 team operation 条目", () => {
    const state = buildVisibleTeamOperationState({
      railSessions: [{ id: "child-1", name: "研究员" }],
      teamWaitSummary: {
        awaitedSessionIds: ["child-1"],
        timedOut: false,
        resolvedSessionId: "child-2",
        resolvedStatus: "completed",
        updatedAt: 1_710_000_100_000,
      },
      teamControlSummary: {
        action: "close",
        requestedSessionIds: ["child-2"],
        cascadeSessionIds: [],
        affectedSessionIds: ["child-1"],
        updatedAt: 1_710_000_200_000,
      },
    });

    expect(state.visibleTeamWaitSummary?.resolvedSessionId).toBe("child-2");
    expect(state.visibleTeamControlSummary?.affectedSessionIds).toEqual([
      "child-1",
    ]);
    expect(state.entries).toEqual([
      {
        id: "control-close-1710000200000",
        title: "暂停处理",
        detail: "刚才已暂停 研究员 的处理。",
        badgeClassName:
          "border border-slate-200 bg-slate-100 text-slate-700",
        updatedAt: 1_710_000_200_000,
        targetSessionId: "child-1",
      },
    ]);
  });

  it("未命中当前画布 session 时应隐藏 team operation 摘要", () => {
    const state = buildVisibleTeamOperationState({
      railSessions: [{ id: "child-1", name: "研究员" }],
      teamWaitSummary: {
        awaitedSessionIds: ["child-2"],
        timedOut: true,
        updatedAt: 1_710_000_100_000,
      },
      teamControlSummary: {
        action: "resume",
        requestedSessionIds: ["child-2"],
        cascadeSessionIds: [],
        affectedSessionIds: ["child-2"],
        updatedAt: 1_710_000_200_000,
      },
    });

    expect(state.visibleTeamWaitSummary).toBeNull();
    expect(state.visibleTeamControlSummary).toBeNull();
    expect(state.entries).toEqual([]);
  });
});
