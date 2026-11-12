import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  updateExpertAgentInstanceSkillRefs,
} from "@/features/experts";
import type { ExpertAgentLaunchParams } from "@/types/page";
import {
  resolveNextExpertSkillRefsOverride,
  useWorkspaceExpertAgentLaunchSyncRuntime,
} from "./useWorkspaceExpertAgentLaunchSyncRuntime";

vi.mock("@/features/experts", () => ({
  updateExpertAgentInstanceSkillRefs: vi.fn(() => ({ id: "record-skills" })),
}));

type HookProps = Parameters<typeof useWorkspaceExpertAgentLaunchSyncRuntime>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const expertAgentLaunch: ExpertAgentLaunchParams = {
  catalogId: "tenant-1",
  projectId: "project-1",
  expertId: "expert-1",
  releaseId: "release-1",
  agentInstanceKey: "tenant-1:project-1:expert-1:release-1",
  launchMode: "new_thread",
  catalogVersion: "catalog-1",
  skillRefsOverride: ["workspace_skill:daily_brief"],
};

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<
    typeof useWorkspaceExpertAgentLaunchSyncRuntime
  > | null = null;

  const defaultProps: HookProps = {
    expertAgentLaunch,
    expertPanelRequestMetadata: { expert: { id: "expert-1" } },
    pruneWorkspaceSkillRuntimeEnableRefs: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceExpertAgentLaunchSyncRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

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

describe("workspace expert agent launch sync runtime", () => {
  it("skill refs 相同时应复用当前 override 引用", () => {
    const current = ["workspace_skill:daily_brief"];
    expect(resolveNextExpertSkillRefsOverride(current, current)).toBe(current);
    expect(
      resolveNextExpertSkillRefsOverride(current, [
        "workspace_skill:daily_brief",
        "workspace_skill:writer",
      ]),
    ).toEqual(["workspace_skill:daily_brief", "workspace_skill:writer"]);
  });

  it("skill refs 变化时应更新本地 override、裁剪 runtime enable refs 并保存专家配置", async () => {
    const pruneWorkspaceSkillRuntimeEnableRefs = vi.fn();
    const { render, getValue } = renderHook({
      pruneWorkspaceSkillRuntimeEnableRefs,
    });

    await render();
    await act(async () => {
      getValue().handleExpertSkillRefsChange(["workspace_skill:writer"]);
      await Promise.resolve();
    });

    expect(getValue().expertSkillRefsOverride).toEqual([
      "workspace_skill:writer",
    ]);
    expect(pruneWorkspaceSkillRuntimeEnableRefs).toHaveBeenCalledWith([
      "workspace_skill:writer",
    ]);
    expect(updateExpertAgentInstanceSkillRefs).toHaveBeenCalledWith({
      catalogId: "tenant-1",
      projectId: "project-1",
      expertId: "expert-1",
      releaseId: "release-1",
      catalogVersion: "catalog-1",
      skillRefsOverride: ["workspace_skill:writer"],
    });
  });

  it("request metadata 变化时应清空本地 override", async () => {
    const { render, getValue } = renderHook();

    await render();
    await act(async () => {
      getValue().handleExpertSkillRefsChange(["workspace_skill:writer"]);
      await Promise.resolve();
    });
    expect(getValue().expertSkillRefsOverride).toEqual([
      "workspace_skill:writer",
    ]);

    await render({
      expertPanelRequestMetadata: { expert: { id: "expert-2" } },
    });

    expect(getValue().expertSkillRefsOverride).toBeNull();
  });
});
