import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assessRuntimeMemoryPrefetchHistoryDiff,
  clearRuntimeMemoryPrefetchHistory,
  compareRuntimeMemoryPrefetchHistoryEntries,
  describeRuntimeMemoryPrefetchHistoryDiffAssessment,
  filterRuntimeMemoryPrefetchHistory,
  formatRuntimeMemoryPrefetchHistoryDiffStatusLabel,
  listRuntimeMemoryPrefetchHistory,
  recordRuntimeMemoryPrefetchHistory,
  summarizeRuntimeMemoryPrefetchHistory,
} from "./runtimeMemoryPrefetchHistory";

describe("runtimeMemoryPrefetchHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    clearRuntimeMemoryPrefetchHistory();
  });

  it("应记录最近的运行时记忆预取历史", () => {
    const entries = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-1",
      workingDir: "/tmp/workspace",
      userMessage: "继续整理研究结论",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-1",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: "【task_plan.md】继续整理风险证据。",
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        workingDir: "/tmp/workspace",
        userMessage: "继续整理研究结论",
        source: "thread_reliability",
        counts: expect.objectContaining({
          rules: 1,
          working: true,
          durable: 0,
          team: 0,
          compaction: false,
        }),
        preview: expect.objectContaining({
          firstRuleSourcePath: "/tmp/workspace/.lime/AGENTS.md",
          workingExcerpt: "【task_plan.md】继续整理风险证据。",
        }),
      }),
    );
  });

  it("应对相同命中结果做去重并保留最新时间", () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-1",
      workingDir: "/tmp/workspace",
      userMessage: "继续整理研究结论",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-1",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    const entries = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-1",
      workingDir: "/tmp/workspace",
      userMessage: "继续整理研究结论",
      source: "memory_page",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-1",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        capturedAt: 1_712_345_679_900,
        source: "memory_page",
      }),
    );
  });

  it("应只保留最近 12 条记录", () => {
    for (let index = 0; index < 15; index += 1) {
      recordRuntimeMemoryPrefetchHistory({
        sessionId: `session-${index}`,
        workingDir: `/tmp/workspace-${index}`,
        userMessage: `message-${index}`,
        source: "thread_reliability",
        capturedAt: 1_712_345_678_900 + index,
        result: {
          session_id: `session-${index}`,
          rules_source_paths: [],
          working_memory_excerpt: null,
          durable_memories: [],
          team_memory_entries: [],
          latest_compaction: null,
          prompt: null,
        },
      });
    }

    const entries = listRuntimeMemoryPrefetchHistory();
    expect(entries).toHaveLength(12);
    expect(entries[0].sessionId).toBe("session-14");
    expect(entries[11].sessionId).toBe("session-3");
  });

  it("应支持按工作区和会话筛选历史记录", () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-1",
      workingDir: "/tmp/workspace/",
      userMessage: "当前工作区第一条",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-1",
        rules_source_paths: [],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-2",
      workingDir: "/tmp/workspace",
      userMessage: "当前工作区第二条",
      source: "thread_reliability",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-2",
        rules_source_paths: [],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-3",
      workingDir: "/tmp/other",
      userMessage: "其他工作区",
      source: "memory_page",
      capturedAt: 1_712_345_680_900,
      result: {
        session_id: "session-3",
        rules_source_paths: [],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    const entries = listRuntimeMemoryPrefetchHistory();

    expect(
      filterRuntimeMemoryPrefetchHistory(entries, {
        scope: "workspace",
        workingDir: "/tmp/workspace/",
      }).map((entry) => entry.userMessage),
    ).toEqual(["当前工作区第二条", "当前工作区第一条"]);
    expect(
      filterRuntimeMemoryPrefetchHistory(entries, {
        scope: "session",
        sessionId: "session-1",
      }).map((entry) => entry.userMessage),
    ).toEqual(["当前工作区第一条"]);
  });

  it("应能比较两次命中之间的层级与摘要变化", () => {
    const previous = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-prev",
      workingDir: "/tmp/workspace",
      userMessage: "继续输出第一版",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-prev",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    })[0];

    const current = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-prev",
      workingDir: "/tmp/workspace",
      userMessage: "继续输出第二版",
      source: "memory_page",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-prev",
        rules_source_paths: [
          "/tmp/workspace/.lime/AGENTS.md",
          "/tmp/workspace/.memory/rules.md",
        ],
        working_memory_excerpt: "【task_plan.md】补上证据与风险。",
        durable_memories: [
          {
            id: "durable-1",
            session_id: "session-prev",
            category: "experience",
            title: "研究输出格式偏好",
            summary: "先结论，再列风险",
            updated_at: 1_712_345_679_900,
            tags: [],
          },
        ],
        team_memory_entries: [
          {
            key: "team.selection",
            content: "研究协作队",
            updated_at: 1_712_345_679_900,
          },
        ],
        latest_compaction: {
          session_id: "session-prev",
          source: "summary_cache",
          summary_preview: "保留研究结论与证据结构。",
          created_at: 1_712_345_679_900,
          trigger: "token_budget",
        },
        prompt: null,
      },
    })[0];

    const diff = compareRuntimeMemoryPrefetchHistoryEntries(current, previous);
    expect(diff.layerChanges).toEqual({
      rulesDelta: 1,
      durableDelta: 1,
      teamDelta: 1,
      workingChanged: "added",
      compactionChanged: "added",
    });
    expect(diff.changed).toBe(true);
    expect(diff.previewChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "user_message",
          previous: "继续输出第一版",
          current: "继续输出第二版",
        }),
        expect.objectContaining({
          key: "durable",
          previous: null,
          current: "研究输出格式偏好",
        }),
        expect.objectContaining({
          key: "team",
          previous: null,
          current: "team.selection",
        }),
      ]),
    );
  });

  it("应把层变化收敛为补强、退化、持平与波动判断", () => {
    const strongerAssessment = assessRuntimeMemoryPrefetchHistoryDiff({
      layerChanges: {
        rulesDelta: 1,
        durableDelta: 0,
        teamDelta: 1,
        workingChanged: "added",
        compactionChanged: "same",
      },
      previewChanges: [],
      changed: true,
    });
    expect(strongerAssessment).toEqual({
      status: "stronger",
      addedLayers: ["rules", "working", "team"],
      removedLayers: [],
      previewChanged: false,
    });
    expect(formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(strongerAssessment.status)).toBe(
      "补强",
    );
    expect(describeRuntimeMemoryPrefetchHistoryDiffAssessment(strongerAssessment)).toBe(
      "补强层：规则层、工作层、Team 层。",
    );

    const weakerAssessment = assessRuntimeMemoryPrefetchHistoryDiff({
      layerChanges: {
        rulesDelta: 0,
        durableDelta: -1,
        teamDelta: 0,
        workingChanged: "removed",
        compactionChanged: "removed",
      },
      previewChanges: [{ key: "working", previous: "旧摘录", current: null }],
      changed: true,
    });
    expect(weakerAssessment).toEqual({
      status: "weaker",
      addedLayers: [],
      removedLayers: ["working", "durable", "compaction"],
      previewChanged: true,
    });
    expect(describeRuntimeMemoryPrefetchHistoryDiffAssessment(weakerAssessment)).toBe(
      "退化层：工作层、持久层、压缩层。 摘要内容也有更新。",
    );

    const mixedAssessment = assessRuntimeMemoryPrefetchHistoryDiff({
      layerChanges: {
        rulesDelta: 2,
        durableDelta: -1,
        teamDelta: 0,
        workingChanged: "same",
        compactionChanged: "same",
      },
      previewChanges: [],
      changed: true,
    });
    expect(mixedAssessment).toEqual({
      status: "mixed",
      addedLayers: ["rules"],
      removedLayers: ["durable"],
      previewChanged: false,
    });
    expect(formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(mixedAssessment.status)).toBe(
      "波动",
    );
    expect(describeRuntimeMemoryPrefetchHistoryDiffAssessment(mixedAssessment)).toBe(
      "补强层：规则层；退化层：持久层。",
    );

    const sameAssessment = assessRuntimeMemoryPrefetchHistoryDiff({
      layerChanges: {
        rulesDelta: 0,
        durableDelta: 0,
        teamDelta: 0,
        workingChanged: "same",
        compactionChanged: "same",
      },
      previewChanges: [{ key: "rule", previous: "/a", current: "/b" }],
      changed: true,
    });
    expect(sameAssessment).toEqual({
      status: "same",
      addedLayers: [],
      removedLayers: [],
      previewChanged: true,
    });
    expect(formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(sameAssessment.status)).toBe(
      "持平",
    );
    expect(describeRuntimeMemoryPrefetchHistoryDiffAssessment(sameAssessment)).toBe(
      "命中层级持平，但摘要内容有更新。",
    );
  });

  it("应汇总当前范围内的层级命中覆盖和变化次数", () => {
    const previous = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-summary",
      workingDir: "/tmp/workspace",
      userMessage: "继续输出第一版",
      source: "thread_reliability",
      capturedAt: 1_712_345_678_900,
      result: {
        session_id: "session-summary",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    })[0];

    const current = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-summary",
      workingDir: "/tmp/workspace",
      userMessage: "继续输出第二版",
      source: "memory_page",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-summary",
        rules_source_paths: [
          "/tmp/workspace/.lime/AGENTS.md",
          "/tmp/workspace/.memory/rules.md",
        ],
        working_memory_excerpt: "【task_plan.md】补上证据与风险。",
        durable_memories: [
          {
            id: "durable-1",
            session_id: "session-summary",
            category: "experience",
            title: "研究输出格式偏好",
            summary: "先结论，再列风险",
            updated_at: 1_712_345_679_900,
            tags: [],
          },
        ],
        team_memory_entries: [
          {
            key: "team.selection",
            content: "研究协作队",
            updated_at: 1_712_345_679_900,
          },
        ],
        latest_compaction: {
          session_id: "session-summary",
          source: "summary_cache",
          summary_preview: "保留研究结论与证据结构。",
          created_at: 1_712_345_679_900,
          trigger: "token_budget",
        },
        prompt: null,
      },
    })[0];

    const summary = summarizeRuntimeMemoryPrefetchHistory([current, previous]);
    expect(summary).toEqual({
      totalEntries: 2,
      uniqueSessions: 1,
      uniqueWorkingDirs: 1,
      layerEntryHits: {
        rules: 2,
        working: 1,
        durable: 1,
        team: 1,
        compaction: 1,
      },
      changedEntries: 1,
      layerStability: [
        {
          key: "rules",
          latestValue: 2,
          hitEntries: 2,
          missEntries: 0,
          valueChanges: 1,
          state: "varying",
        },
        {
          key: "working",
          latestValue: 1,
          hitEntries: 1,
          missEntries: 1,
          valueChanges: 1,
          state: "varying",
        },
        {
          key: "durable",
          latestValue: 1,
          hitEntries: 1,
          missEntries: 1,
          valueChanges: 1,
          state: "varying",
        },
        {
          key: "team",
          latestValue: 1,
          hitEntries: 1,
          missEntries: 1,
          valueChanges: 1,
          state: "varying",
        },
        {
          key: "compaction",
          latestValue: 1,
          hitEntries: 1,
          missEntries: 1,
          valueChanges: 1,
          state: "varying",
        },
      ],
    });
  });

  it("应识别稳定命中与一直缺失的层状态", () => {
    const latest = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-stable",
      workingDir: "/tmp/workspace",
      userMessage: "继续整理稳定层第二轮",
      source: "memory_page",
      capturedAt: 1_712_345_680_900,
      result: {
        session_id: "session-stable",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    })[0];

    const previous = recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-stable",
      workingDir: "/tmp/workspace",
      userMessage: "继续整理稳定层第一轮",
      source: "thread_reliability",
      capturedAt: 1_712_345_679_900,
      result: {
        session_id: "session-stable",
        rules_source_paths: ["/tmp/workspace/.lime/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    })[1];

    const summary = summarizeRuntimeMemoryPrefetchHistory([latest, previous]);
    expect(summary.layerStability).toEqual([
      {
        key: "rules",
        latestValue: 1,
        hitEntries: 2,
        missEntries: 0,
        valueChanges: 0,
        state: "steady_hit",
      },
      {
        key: "working",
        latestValue: 0,
        hitEntries: 0,
        missEntries: 2,
        valueChanges: 0,
        state: "steady_miss",
      },
      {
        key: "durable",
        latestValue: 0,
        hitEntries: 0,
        missEntries: 2,
        valueChanges: 0,
        state: "steady_miss",
      },
      {
        key: "team",
        latestValue: 0,
        hitEntries: 0,
        missEntries: 2,
        valueChanges: 0,
        state: "steady_miss",
      },
      {
        key: "compaction",
        latestValue: 0,
        hitEntries: 0,
        missEntries: 2,
        valueChanges: 0,
        state: "steady_miss",
      },
    ]);
  });
});
