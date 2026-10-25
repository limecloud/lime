import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import * as skillCatalog from "@/lib/api/skillCatalog";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import {
  collectPendingA2UIFormIds,
  commitNewConversationRoute,
  createMockAgentChatUnifiedState,
  flushEffects,
  installMockAgentChatUnifiedState,
  mountPage,
  renderPage,
  waitForElement,
  waitForPendingA2UIForm,
} from "./index.testFixtures";

describe("LocalConversationPage 服务技能 A2UI", () => {
  it("Skills 首页入口带着 pending service skill 时，应挂起服务技能 A2UI", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({ sessionId: null }),
    );

    const container = renderPage({
      ...buildHomeAgentParams({ projectId: "project-service-skill-a2ui" }),
      initialPendingServiceSkillLaunch: {
        skillId: "daily-trend-briefing",
        requestKey: 20260409,
        initialSlotValues: {
          industry_keywords: "",
          schedule_time: "每天 10:00",
        },
        prefillHint: "已根据 Skills 页入口推荐自动预填。",
      },
    });
    await waitForElement(container, '[data-testid="layout-transition"]');

    expect(
      container
        .querySelector('[data-testid="layout-transition"]')
        ?.getAttribute("data-mode"),
    ).toBe("chat");

    const pendingA2UIForm = (await waitForPendingA2UIForm(
      (form) =>
        form?.id ===
        "service-skill-launch:daily-trend-briefing:daily-trend-briefing:20260409",
    )) as {
      id?: string;
      components?: Array<Record<string, unknown>>;
    } | null;

    expect(
      pendingA2UIForm?.id,
      `pending A2UI 调用历史：${JSON.stringify(collectPendingA2UIFormIds())}`,
    ).toBe(
      "service-skill-launch:daily-trend-briefing:daily-trend-briefing:20260409",
    );
    expect(pendingA2UIForm?.components || []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining(":prefill-hint"),
          text: "已根据 Skills 页入口推荐自动预填。",
        }),
        expect.objectContaining({
          id: "service-skill-slot-industry_keywords",
          component: "TextField",
        }),
        expect.objectContaining({
          id: "service-skill-slot-schedule_time",
          value: "每天 10:00",
        }),
      ]),
    );
  });

  it("从挂起服务技能补参态新建任务时，应清掉旧补参表单", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({ sessionId: null }),
    );

    const mounted = mountPage({
      ...buildHomeAgentParams({ projectId: "project-service-skill-a2ui" }),
      initialPendingServiceSkillLaunch: {
        skillId: "daily-trend-briefing",
        requestKey: 20260409,
        initialSlotValues: {
          industry_keywords: "",
          schedule_time: "每天 10:00",
        },
        prefillHint: "已根据 Skills 页入口推荐自动预填。",
      },
    });

    const pendingFormBefore = await waitForPendingA2UIForm((form) =>
      Boolean(form?.id?.includes("service-skill-launch:daily-trend-briefing")),
    );
    expect(
      pendingFormBefore?.id,
      `pending A2UI 调用历史：${JSON.stringify(collectPendingA2UIFormIds())}`,
    ).toContain("service-skill-launch");

    expect(commitNewConversationRoute(mounted, {})).toBe(true);
    await flushEffects();
    mounted.rerender();
    await flushEffects();

    expect(
      await waitForElement(mounted.container, '[data-testid="empty-state"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector(
        '[data-testid="workspace-pending-a2ui-panel"]',
      ),
    ).toBeNull();
  });

  it("目录加载期间新建空任务，迟到目录不能重新挂起旧技能表单", async () => {
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({ sessionId: null }),
    );
    const catalog = skillCatalog.getSeededSkillCatalog();
    let resolveCatalog!: (value: skillCatalog.SkillCatalog) => void;
    const loadCatalog = vi
      .spyOn(skillCatalog, "getSkillCatalog")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCatalog = resolve;
        }),
      );
    const mounted = mountPage({
      ...buildHomeAgentParams({ projectId: "project-service-skill-a2ui" }),
      initialPendingServiceSkillLaunch: {
        skillId: "daily-trend-briefing",
        requestKey: 20260410,
      },
    });
    await flushEffects(1);
    expect(loadCatalog).toHaveBeenCalledOnce();
    expect(collectPendingA2UIFormIds()).toEqual([]);

    commitNewConversationRoute(mounted, {});
    await act(async () => resolveCatalog(catalog));
    await flushEffects();

    expect(collectPendingA2UIFormIds()).toEqual([]);
    expect(
      mounted.container.querySelector('[data-testid="empty-state"]'),
    ).not.toBeNull();
  });
});
