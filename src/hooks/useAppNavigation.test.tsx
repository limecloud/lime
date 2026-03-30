import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY } from "@/types/page";
import { useAppNavigation } from "./useAppNavigation";

interface ProbeProps {
  onReady: (value: ReturnType<typeof useAppNavigation>) => void;
}

function HookProbe({ onReady }: ProbeProps) {
  const navigation = useAppNavigation();

  useEffect(() => {
    onReady(navigation);
  }, [navigation, onReady]);

  return null;
}

describe("useAppNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestNavigation: ReturnType<typeof useAppNavigation> | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latestNavigation = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
  });

  async function flushEffects() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderProbe() {
    await act(async () => {
      root.render(
        <HookProbe
          onReady={(value) => {
            latestNavigation = value;
          }}
        />,
      );
    });
    await flushEffects();
  }

  it("projects 跳转应复用保存的主题工作台页", async () => {
    window.localStorage.setItem(
      LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
      "workspace-poster",
    );
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("projects", {
        projectId: "project-1",
      });
    });

    expect(latestNavigation?.currentPage).toBe("workspace-poster");
    expect(latestNavigation?.pageParams).toEqual({
      projectId: "project-1",
      workspaceViewMode: "project-management",
    });
  });

  it("project-detail 跳转应保留工作台上下文参数", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("project-detail", {
        projectId: "project-2",
        workspaceTheme: "music",
      });
    });

    expect(latestNavigation?.currentPage).toBe("workspace-music");
    expect(latestNavigation?.pageParams).toEqual({
      projectId: "project-2",
      workspaceViewMode: "workspace",
    });
  });

  it("skills 跳转应直接进入技能主页面", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("skills");
    });

    expect(latestNavigation?.currentPage).toBe("skills");
    expect(latestNavigation?.pageParams).toEqual({});
  });
});
