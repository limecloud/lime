import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findCuratedTaskTemplateById,
  recordCuratedTaskTemplateUsage,
  resolveCuratedTaskFollowUpActionTarget,
  subscribeCuratedTaskTemplateUsageChanged,
} from "./curatedTaskTemplates";

describe("curatedTaskTemplates", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("复盘模板的下游动作应能路由到正确的结果模板", () => {
    const resolved = resolveCuratedTaskFollowUpActionTarget({
      taskId: "account-project-review",
      action: "生成下一轮内容方案",
    });

    expect(resolved).toEqual({
      task: findCuratedTaskTemplateById("social-post-starter"),
      promptHint: "请承接这轮复盘结论，直接生成下一轮最值得执行的内容方案。",
    });
  });

  it("没有显式路由的动作应继续返回空结果", () => {
    expect(
      resolveCuratedTaskFollowUpActionTarget({
        taskId: "daily-trend-briefing",
        action: "继续展开其中一个选题",
      }),
    ).toBeNull();
  });

  it("记录 recent usage 时应发出统一 changed 事件", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeCuratedTaskTemplateUsageChanged(callback);

    recordCuratedTaskTemplateUsage({
      templateId: "daily-trend-briefing",
      launchInputValues: {
        theme_target: "AI 内容创作",
      },
    });

    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
