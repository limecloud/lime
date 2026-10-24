import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SettingsTabs } from "@/types/settings";
import { getRegisteredCommands } from "@/lib/commands/registry";

import { SettingsSidebar } from "./SettingsSidebar";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderSidebar(activeTab: SettingsTabs = SettingsTabs.General) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SettingsSidebar
        activeTab={activeTab}
        onTabChange={vi.fn()}
        onTabPrefetch={vi.fn()}
      />,
    );
  });

  mounted.push({ container, root });
  return container;
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("en-US");
  vi.clearAllMocks();
});

afterEach(async () => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) {
      break;
    }

    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
  vi.clearAllMocks();
  await changeLimeLocale("zh-CN");
});

describe("SettingsSidebar", () => {
  it("关于始终位于全部设置菜单的最后且不归入编程分组", () => {
    const container = renderSidebar(SettingsTabs.About);
    const items = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid^="settings-sidebar-tab-"]',
    );
    const about = items[items.length - 1];
    expect(about.dataset.testid).toBe("settings-sidebar-tab-about");
    expect(about.getAttribute("aria-current")).toBe("page");
    expect(about.parentElement?.parentElement?.textContent).toBe("About");
    expect(container.textContent).not.toContain("settings.group.null");
  });

  it("搜索键位与可用列表同源，导航在途和卸载时一并撤销", () => {
    const container = renderSidebar();
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-sidebar-search"]',
    )!;
    const button = document.createElement("button");
    container.append(button);
    act(() => button.focus());
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(input);
    expect(getRegisteredCommands().map((command) => command.id)).toEqual([
      "searchSettings",
    ]);
    const root = mounted[mounted.length - 1].root;
    act(() =>
      root.render(
        <SettingsSidebar
          activeTab={SettingsTabs.General}
          onTabChange={vi.fn()}
          navigationPending
        />,
      ),
    );
    act(() => button.focus());
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          ctrlKey: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(button);
    expect(getRegisteredCommands()).toEqual([]);
    act(() => root.render(null));
    expect(getRegisteredCommands()).toEqual([]);
  });

  it("应通过 settings namespace 渲染搜索名称并移除实验入口", () => {
    const container = renderSidebar();
    expect(container.textContent).not.toContain("Labs");
    expect(
      container
        .querySelector('[data-testid="settings-sidebar-search"]')
        ?.getAttribute("aria-label"),
    ).toBe("Search settings");
    expect(container.textContent).not.toContain("settings.layout.sidebar");
  });

  it("无 active item 时导航仍可访问且不会选中错误设置", () => {
    const container = renderSidebar("__missing__" as SettingsTabs);
    expect(container.querySelector('[aria-current="page"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="settings-sidebar-search"]'),
    ).not.toBeNull();
  });
});
