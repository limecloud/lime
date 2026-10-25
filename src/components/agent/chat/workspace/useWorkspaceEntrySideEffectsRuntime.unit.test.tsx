import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { toast } from "sonner";
import type { TaskFile } from "../components/TaskFiles";
import {
  buildServiceSkillDirectoryErrorToastMessage,
  resolveInitialActiveTheme,
  resolveWorkspaceEntryBannerVisible,
  shouldResetRuntimeEntryBannerMessage,
  shouldShowServiceSkillDirectoryErrorToast,
  useWorkspaceActiveContentTargetRuntime,
  useWorkspaceEntryStateRuntime,
  useWorkspaceServiceSkillDirectoryToastRuntime,

  useWorkspaceTaskFilesRefSyncRuntime,
} from "./useWorkspaceEntrySideEffectsRuntime";

vi.mock("@/lib/activeContentTarget", () => ({
  setActiveContentTarget: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function mountProbe(renderProbe: () => React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe() {
    return <>{renderProbe()}</>;
  }

  const render = async () => {
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return { render };
}

const taskFile = {
  id: "file-1",
  name: "draft.md",
  type: "document",
  content: "draft",
  version: 1,
  createdAt: 1,
  updatedAt: 1,
} satisfies TaskFile;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("workspace entry side effects runtime", () => {
  it("入口态纯决策应保持原同步语义", () => {
    expect(resolveInitialActiveTheme("general")).toBe("general");
    expect(resolveInitialActiveTheme(null)).toBeNull();
    expect(shouldResetRuntimeEntryBannerMessage("继续任务")).toBe(true);
    expect(shouldResetRuntimeEntryBannerMessage("")).toBe(false);
    expect(resolveWorkspaceEntryBannerVisible("继续任务")).toBe(true);
    expect(resolveWorkspaceEntryBannerVisible(null)).toBe(false);
    expect(
      shouldShowServiceSkillDirectoryErrorToast({
        activeTheme: "general",
        serviceSkillsError: "network",
      }),
    ).toBe(true);
    expect(
      shouldShowServiceSkillDirectoryErrorToast({
        activeTheme: "article",
        serviceSkillsError: "network",
      }),
    ).toBe(false);
    expect(buildServiceSkillDirectoryErrorToastMessage("network")).toBe(
      "加载技能目录失败：network",
    );
  });

  it("入口状态 runtime 应同步初始主题、创作模式和 banner 可见性", async () => {
    const setActiveTheme = vi.fn();
    const setCreationMode = vi.fn();
    const setEntryBannerVisible = vi.fn();
    const setRuntimeEntryBannerMessage = vi.fn();
    const { render } = mountProbe(() => {
      useWorkspaceEntryStateRuntime({
        effectiveEntryBannerMessage: "继续任务",
        entryBannerMessage: "入口提示",
        initialCreationMode: "guided",
        initialTheme: "general",
        setActiveTheme,
        setCreationMode,
        setEntryBannerVisible,
        setRuntimeEntryBannerMessage,
      });
      return null;
    });

    await render();

    expect(setActiveTheme).toHaveBeenCalledWith("general");
    expect(setCreationMode).toHaveBeenCalledWith("guided");
    expect(setRuntimeEntryBannerMessage).toHaveBeenCalledWith(null);
    expect(setEntryBannerVisible).toHaveBeenCalledWith(true);
  });

  it("active content target runtime 应同步当前 project/content/canvas 类型", async () => {
    const { render } = mountProbe(() => {
      useWorkspaceActiveContentTargetRuntime({
        projectId: "project-1",
        contentId: "content-1",
        canvasType: "document",
      });
      return null;
    });

    await render();

    expect(setActiveContentTarget).toHaveBeenCalledWith(
      "project-1",
      "content-1",
      "document",
    );
  });

  it("task files ref runtime 应保持 ref 指向最新文件数组", async () => {
    const taskFilesRef = { current: [] as TaskFile[] };
    const { render } = mountProbe(() => {
      useWorkspaceTaskFilesRefSyncRuntime({
        taskFiles: [taskFile],
        taskFilesRef,
      });
      return null;
    });

    await render();

    expect(taskFilesRef.current).toEqual([taskFile]);
  });



  it("service skill 目录错误只在 general 主题展示 toast", async () => {
    const { render: renderArticle } = mountProbe(() => {
      useWorkspaceServiceSkillDirectoryToastRuntime({
        activeTheme: "article",
        serviceSkillsError: "network",
      });
      return null;
    });
    await renderArticle();
    expect(toast.error).not.toHaveBeenCalled();

    const { render: renderGeneral } = mountProbe(() => {
      useWorkspaceServiceSkillDirectoryToastRuntime({
        activeTheme: "general",
        serviceSkillsError: "network",
      });
      return null;
    });
    await renderGeneral();

    expect(toast.error).toHaveBeenCalledWith("加载技能目录失败：network");
  });
});
