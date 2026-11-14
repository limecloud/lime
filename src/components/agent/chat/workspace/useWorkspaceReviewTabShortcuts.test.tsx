import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestWorkspaceReviewTab,
  requestWorkspaceReviewTabClose,
  requestWorkspaceReviewTabToggle,
} from "@/lib/workspaceReviewTabEvents";
import type { WorkspaceRightSurfaceKind } from "./right-surface";
import { useWorkspaceReviewTabShortcuts } from "./useWorkspaceReviewTabShortcuts";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const onOpen = vi.fn();
const onClose = vi.fn();

function Harness({
  activeSurface,
}: {
  activeSurface: WorkspaceRightSurfaceKind | null;
}) {
  useWorkspaceReviewTabShortcuts({ activeSurface, onOpen, onClose });
  return null;
}

function render(activeSurface: WorkspaceRightSurfaceKind | null) {
  act(() => root.render(<Harness activeSurface={activeSurface} />));
}

beforeEach(() => {
  onOpen.mockReset();
  onClose.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useWorkspaceReviewTabShortcuts", () => {
  it("changes 未打开时 open/toggle 打开，close 不产生关闭动作", () => {
    render(null);

    act(() => requestWorkspaceReviewTab());
    act(() => requestWorkspaceReviewTabToggle());
    act(() => requestWorkspaceReviewTabClose());

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("changes 已打开时 toggle/close 关闭，open 不重复打开", () => {
    render("changes");

    act(() => requestWorkspaceReviewTab());
    act(() => requestWorkspaceReviewTabToggle());
    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("其他右侧面板打开时 toggle 切到 changes，close 不关闭其它面板", () => {
    render("files");

    act(() => requestWorkspaceReviewTabToggle());
    act(() => requestWorkspaceReviewTabClose());

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("卸载后不再接收请求", () => {
    render(null);
    act(() => root.render(<div />));
    act(() => requestWorkspaceReviewTabToggle());
    expect(onOpen).not.toHaveBeenCalled();
  });
});
