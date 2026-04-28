import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Home, Palette } from "lucide-react";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";

const mockUseSettingsCategory = vi.fn();

vi.mock("../hooks/useSettingsCategory", () => ({
  useSettingsCategory: () => mockUseSettingsCategory(),
}));

import { SettingsSidebar } from "./SettingsSidebar";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mounted: RenderResult[] = [];

function renderSidebar(
  props?: Partial<{
    activeTab: SettingsTabs;
    onTabChange: (tab: SettingsTabs) => void;
    onTabPrefetch: (tab: SettingsTabs) => void;
  }>,
): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SettingsSidebar
        activeTab={props?.activeTab ?? SettingsTabs.Home}
        onTabChange={props?.onTabChange ?? vi.fn()}
        onTabPrefetch={props?.onTabPrefetch}
      />,
    );
  });

  const rendered = { container, root };
  mounted.push(rendered);
  return rendered;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockUseSettingsCategory.mockReturnValue([
    {
      key: SettingsGroupKey.Overview,
      title: "概览",
      items: [
        {
          key: SettingsTabs.Home,
          label: "设置首页",
          icon: Home,
        },
      ],
    },
    {
      key: SettingsGroupKey.General,
      title: "通用",
      items: [
        {
          key: SettingsTabs.Appearance,
          label: "外观",
          icon: Palette,
        },
      ],
    },
  ]);
});

afterEach(() => {
  mockUseSettingsCategory.mockReset();

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
});

describe("SettingsSidebar", () => {
  it("侧边栏应暴露主题化容器和当前导航状态", () => {
    const { container } = renderSidebar({
      activeTab: SettingsTabs.Appearance,
    });
    const sidebar = container.querySelector('[data-testid="settings-sidebar"]');
    const activeButton = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("外观"),
    );
    const inactiveButton = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("设置首页"),
    );

    expect(sidebar).not.toBeNull();
    expect(activeButton?.getAttribute("data-active")).toBe("true");
    expect(inactiveButton?.getAttribute("data-active")).toBe("false");
  });

  it("点击导航项时应触发 tab 切换", () => {
    const onTabChange = vi.fn();
    const { container } = renderSidebar({ onTabChange });
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("外观"),
    );

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onTabChange).toHaveBeenCalledWith(SettingsTabs.Appearance);
  });

  it("悬停导航项时应触发 tab 预取", () => {
    const onTabPrefetch = vi.fn();
    const { container } = renderSidebar({ onTabPrefetch });
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("外观"),
    );

    act(() => {
      button?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(onTabPrefetch).toHaveBeenCalledWith(SettingsTabs.Appearance);
  });
});
