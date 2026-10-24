import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useWorkspaceContextSurfaceRuntime } from "./useWorkspaceContextSurfaceRuntime";

vi.mock("./useWorkspaceContextHarnessRuntime", () => ({
  useWorkspaceContextHarnessRuntime: () => ({ harnessPanelVisible: false }),
}));
vi.mock("./useWorkspaceRightSurfaceLocalStateRuntime", () => ({
  useWorkspaceRightSurfaceLocalStateRuntime: () => ({
    manualRightSurface: null,
  }),
}));

it("发布同一可见会话的实际工作区变化，并在会话清空时保留首页工作区", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onLocationChange = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe({
    workspaceId,
    sessionId,
  }: {
    workspaceId: string | null;
    sessionId: string | null;
  }) {
    useWorkspaceContextSurfaceRuntime({
      mappedTheme: "general",
      layoutMode: "chat",

      isSending: false,
      messages: [],
      pendingActions: [],
      todoItems: [],
      threadItems: [],
      projectMemory: null,
      projectId: "route-workspace",
      runtimeWorkspaceId: workspaceId,
      sessionId,
      onLocationChange,
    });
    return null;
  }
  try {
    await act(async () => {
      root.render(<Probe workspaceId="actual-workspace" sessionId="thread" />);
    });
    expect(onLocationChange).toHaveBeenLastCalledWith({
      sessionId: "thread",
      workspaceId: "actual-workspace",
    });
    await act(async () => {
      root.render(
        <Probe workspaceId="switched-workspace" sessionId="thread" />,
      );
    });
    expect(onLocationChange).toHaveBeenLastCalledWith({
      sessionId: "thread",
      workspaceId: "switched-workspace",
    });
    await act(async () => {
      root.render(<Probe workspaceId="switched-workspace" sessionId={null} />);
    });
    expect(onLocationChange).toHaveBeenLastCalledWith({
      sessionId: null,
      workspaceId: "switched-workspace",
    });
    expect(onLocationChange).toHaveBeenCalledTimes(3);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
