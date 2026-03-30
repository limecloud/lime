import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsSettings } from ".";

vi.mock("@/components/channels/ImConfigPage", () => ({
  ImConfigPage: () => <div data-testid="im-config-page-proxy" />,
}));

interface MountedPage {
  container: HTMLDivElement;
  root: Root;
}

const mountedPages: MountedPage[] = [];

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ChannelsSettings />);
  });

  mountedPages.push({ container, root });
  return container;
}

describe("ChannelsSettings", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    while (mountedPages.length > 0) {
      const mounted = mountedPages.pop();
      if (!mounted) {
        continue;
      }

      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }

    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("设置页渠道管理应直接复用 IM 配置主页面", () => {
    const container = renderPage();

    expect(
      container.querySelector('[data-testid="im-config-page-proxy"]'),
    ).not.toBeNull();
  });
});
