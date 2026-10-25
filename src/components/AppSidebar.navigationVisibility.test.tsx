import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTabs } from "@/types/settings";
import {
  act,
  cleanupAppSidebarTest,
  flushEffects,
  mountSidebarContainer,
  APP_SIDEBAR_COLLAPSED_STORAGE_KEY,
  resetAppSidebarTest,
} from "./AppSidebar.testFixtures";

describe("AppSidebar navigation visibility", () => {
  beforeEach(resetAppSidebarTest);
  afterEach(cleanupAppSidebarTest);

  it.each(["false", "true"])(
    "设置保留图标栏且不改写已保存的折叠偏好 %s",
    async (preference) => {
      window.localStorage.setItem(
        APP_SIDEBAR_COLLAPSED_STORAGE_KEY,
        preference,
      );
      const onNavigate = vi.fn();
      const container = mountSidebarContainer({
        currentPage: "settings",
        onNavigate,
      });
      await flushEffects(2);
      expect(
        container
          .querySelector('[data-testid="app-sidebar"]')
          ?.getAttribute("data-collapsed"),
      ).toBe("true");
      expect(
        container.querySelector('[data-testid="app-sidebar-rail"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="app-sidebar-expand"]'),
      ).toBeNull();
      expect(
        window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY),
      ).toBe(preference);
      const home = container.querySelector<HTMLButtonElement>(
        '[data-testid="app-sidebar-rail-home"]',
      )!;
      act(() => home.click());
      expect(onNavigate).toHaveBeenCalledWith("agent", expect.any(Object));
    },
  );

  it.each(["new-task", "conversation"] as const)(
    "%s 页面应显示并打开设置、插件和已安排任务",
    async (agentEntry) => {
      const onNavigate = vi.fn();
      const container = mountSidebarContainer({
        currentPage: "agent",
        currentPageParams: { agentEntry },
        onNavigate,
      });
      await flushEffects(2);

      for (const { id, page, params } of [
        {
          id: "settings",
          page: "settings",
          params: { tab: SettingsTabs.General },
        },
        { id: "plugins", page: "plugins", params: undefined },
        { id: "scheduled-tasks", page: "scheduled-tasks", params: undefined },
      ]) {
        const button = container.querySelector<HTMLButtonElement>(
          `[data-testid="app-sidebar-nav-${id}"]`,
        );
        expect(button, `${agentEntry}: ${id} 入口存在`).not.toBeNull();
        expect(
          getComputedStyle(button!).display,
          `${agentEntry}: ${id} 入口可见`,
        ).not.toBe("none");
        act(() => button!.click());
        expect(onNavigate).toHaveBeenLastCalledWith(page, params);
      }
    },
  );
});
