import { renderEmptyState, flushAsyncEffects } from "./EmptyState.testFixtures";

import { act } from "react";

import { describe, expect, it } from "vitest";

describe("EmptyState layout current integration", () => {
  it("首页保留欢迎标题与统一输入区，旧任务目录和 Banner 不再挂载", async () => {
    const container = renderEmptyState({ projectId: "lime" });
    await flushAsyncEffects();
    const page = container.querySelector('[data-testid="home-composer-page"]');
    expect(page).toBeTruthy();
    expect(
      page?.querySelectorAll('[data-testid="composer-editor"]'),
    ).toHaveLength(1);
    expect(
      page?.querySelector('[data-testid="dream-blossom-home-artwork"]'),
    ).toBeNull();
    for (const selector of [
      '[data-testid="home-ambient-suggestions"]',
      '[data-testid="home-starter-chips"]',
      '[data-testid="home-more-skills-trigger"]',
      '[data-testid="home-guide-help-trigger"]',
      '[data-testid="entry-recent-session-resume"]',
    ])
      expect(container.querySelector(selector)).toBeNull();
  });

  it("首页共享编辑器显示当前占位文案", async () => {
    const container = renderEmptyState();

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = container.querySelector<HTMLElement>(
      '[data-testid="composer-editor"][role="textbox"]',
    );
    expect(textarea?.getAttribute("data-placeholder")).toBe("随心输入");
  });

  it("高级设置不再渲染联网搜索前置开关", async () => {
    const container = renderEmptyState({ activeTheme: "general" });
    await act(async () => {
      await Promise.resolve();
    });

    const plusTrigger = container.querySelector(
      '[data-testid="inputbar-plus-trigger"]',
    ) as HTMLButtonElement | null;
    expect(plusTrigger).toBeTruthy();
    const globeToggle = container.querySelector(
      'button[title="联网搜索已关闭"]',
    ) as HTMLButtonElement | null;
    expect(globeToggle).toBeNull();

    act(() => {
      plusTrigger?.click();
    });

    const expandedGlobeToggle = container.querySelector(
      'button[title="联网搜索已关闭"]',
    ) as HTMLButtonElement | null;
    expect(expandedGlobeToggle).toBeNull();
  });
});
