import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { WorkbenchRightRail } from "./WorkbenchRightRail";
import {
  cleanupMountedRoots,
  clickElement,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "../hooks/testUtils";

setupReactActEnvironment();

describe("WorkbenchRightRail", () => {
  const mountedRoots: MountedRoot[] = [];

  beforeEach(() => {
    act(() => {
      useWorkbenchStore.setState({
        leftSidebarCollapsed: true,
        contentReviewRailState: null,
      });
    });
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    act(() => {
      useWorkbenchStore.getState().clearContentReviewRailState();
    });
  });

  it("创作视图默认显示能力面板", async () => {
    const { container } = mountHarness(
      WorkbenchRightRail,
      {
        shouldRender: true,
        isCreateWorkspaceView: true,
        projectId: "project-1",
        onBackToCreateView: vi.fn(),
        onCreateContentFromPrompt: vi.fn(),
      },
      mountedRoots,
    );

    await flushEffects();

    expect(container.querySelector("[data-testid='workbench-right-rail-expanded']")).not.toBeNull();
  });

  it("创作右侧栏不再显示项目风格策略入口", async () => {
    const { container } = mountHarness(
      WorkbenchRightRail,
      {
        shouldRender: true,
        isCreateWorkspaceView: true,
        projectId: "project-1",
        onBackToCreateView: vi.fn(),
        onCreateContentFromPrompt: vi.fn(),
      },
      mountedRoots,
    );

    await flushEffects();

    expect(container.textContent).not.toContain("风格策略");
    expect(container.textContent).not.toContain("编辑项目风格");
  });

  it("存在评审状态时应切换为评审专家团面板，关闭后恢复能力面板", async () => {
    const closeSpy = vi.fn();

    act(() => {
      useWorkbenchStore.getState().setContentReviewRailState({
        experts: [
          {
            id: "reviewer-1",
            name: "林岑·叙事总编",
            title: "结构整饬 · 主线聚焦",
            description: "用于测试的评审专家。",
            tags: ["结构整饬", "主线聚焦"],
            badgeText: "+1",
            avatarLabel: "林岑",
            avatarColor: "linear-gradient(135deg, #4f8cff 0%, #56d8ff 100%)",
          },
        ],
        selectedExpertIds: ["reviewer-1"],
        onToggleExpert: vi.fn(),
        onClose: () => {
          closeSpy();
          useWorkbenchStore.getState().clearContentReviewRailState();
        },
        onCreateExpert: vi.fn(),
        onStartReview: vi.fn(),
        reviewRunning: false,
        reviewResult: "",
        reviewError: "",
      });
    });

    const { container } = mountHarness(
      WorkbenchRightRail,
      {
        shouldRender: true,
        isCreateWorkspaceView: true,
        projectId: "project-1",
        onBackToCreateView: vi.fn(),
        onCreateContentFromPrompt: vi.fn(),
      },
      mountedRoots,
    );

    await flushEffects();

    expect(container.textContent).toContain("评审专家团");
    expect(container.textContent).toContain("林岑·叙事总编");
    expect(container.querySelector("[data-testid='workbench-right-rail-expanded']")).toBeNull();

    clickElement(
      container.querySelector("button[aria-label='关闭评审专家团']"),
    );

    await flushEffects();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='workbench-right-rail-expanded']")).not.toBeNull();
  });
});
