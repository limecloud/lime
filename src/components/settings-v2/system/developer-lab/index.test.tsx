import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockDeveloperSettings, mockExperimentalSettings } = vi.hoisted(() => ({
  mockDeveloperSettings: vi.fn(),
  mockExperimentalSettings: vi.fn(),
}));

vi.mock("../developer", () => ({
  DeveloperSettings: (props: unknown) => {
    mockDeveloperSettings(props);
    return <div>开发者工具占位</div>;
  },
}));

vi.mock("../experimental", () => ({
  ExperimentalSettings: (props: unknown) => {
    mockExperimentalSettings(props);
    return <div>实验功能占位</div>;
  },
}));

import { DeveloperLabSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(
  initialTab?: "developer" | "experimental",
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<DeveloperLabSettings initialTab={initialTab} />);
  });

  mounted.push({ container, root });
  return container;
}

afterEach(() => {
  mockDeveloperSettings.mockReset();
  mockExperimentalSettings.mockReset();

  while (mounted.length > 0) {
    const current = mounted.pop();
    if (!current) {
      break;
    }

    act(() => {
      current.root.unmount();
    });
    current.container.remove();
  }
});

describe("DeveloperLabSettings", () => {
  it("应默认在合并页展示开发者工具 tab", () => {
    const container = renderComponent();
    const text = container.textContent ?? "";

    expect(text).toContain("开发者与实验功能");
    expect(text).toContain("开发者工具占位");
    expect(text).not.toContain("实验功能占位");
    expect(mockDeveloperSettings).toHaveBeenCalledWith({ embedded: true });
    expect(mockExperimentalSettings).not.toHaveBeenCalled();
  });

  it("旧实验功能入口进入合并页时应默认选中实验功能 tab", () => {
    const container = renderComponent("experimental");
    const text = container.textContent ?? "";

    expect(text).toContain("实验功能占位");
    expect(text).not.toContain("开发者工具占位");
    expect(mockExperimentalSettings).toHaveBeenCalledWith({ embedded: true });
  });

  it("切换实验功能 tab 后应只挂载实验功能内容", () => {
    const container = renderComponent();
    const experimentalTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="developer-lab-tab-experimental"]',
    );

    act(() => {
      experimentalTab?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("实验功能占位");
    expect(text).not.toContain("开发者工具占位");
    expect(mockExperimentalSettings).toHaveBeenCalledWith({ embedded: true });
  });
});
