import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTopicBranchBoard } from "./useTopicBranchBoard";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  sessionStorage.clear();
});

interface ProbeProps {
  enabled: boolean;
  projectId?: string;
  currentTopicId: string | null;
  onSnapshot: (value: ReturnType<typeof useTopicBranchBoard>) => void;
  externalStatusMap?: Record<
    string,
    "in_progress" | "pending" | "merged" | "candidate"
  >;
  onStatusMapChange?: (
    next: Record<string, "in_progress" | "pending" | "merged" | "candidate">,
  ) => void;
}

function Probe({
  enabled,
  projectId,
  currentTopicId,
  onSnapshot,
  externalStatusMap,
  onStatusMapChange,
}: ProbeProps) {
  const result = useTopicBranchBoard({
    enabled,
    projectId,
    currentTopicId,
    topics: [
      { id: "topic-a", title: "话题 A", messagesCount: 3 },
      { id: "topic-b", title: "话题 B", messagesCount: 0 },
    ],
    externalStatusMap,
    onStatusMapChange,
  });
  onSnapshot(result);
  return null;
}

describe("useTopicBranchBoard", () => {
  it("当前话题应自动为进行中", async () => {
    let snapshot = null as ReturnType<typeof useTopicBranchBoard> | null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(
        <Probe
          enabled={true}
          projectId="project-1"
          currentTopicId="topic-a"
          onSnapshot={(value) => {
            snapshot = value;
          }}
        />,
      );
    });

    const current = snapshot?.branchItems.find(
      (item: { id: string }) => item.id === "topic-a",
    );
    expect(current?.status).toBe("in_progress");
  });

  it("应允许手动设置分支状态", async () => {
    let snapshot = null as ReturnType<typeof useTopicBranchBoard> | null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(
        <Probe
          enabled={true}
          projectId="project-2"
          currentTopicId="topic-a"
          onSnapshot={(value) => {
            snapshot = value;
          }}
        />,
      );
    });

    await act(async () => {
      snapshot?.setTopicStatus("topic-b", "merged");
    });

    const merged = snapshot?.branchItems.find(
      (item: { id: string }) => item.id === "topic-b",
    );
    expect(merged?.status).toBe("merged");
  });

  it("应忽略 sessionStorage 中非法状态值", async () => {
    sessionStorage.setItem(
      "agent_topic_branch_status_project-3",
      JSON.stringify({
        "topic-a": "unknown_status",
        "topic-b": "merged",
      }),
    );

    let snapshot = null as ReturnType<typeof useTopicBranchBoard> | null;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(
        <Probe
          enabled={true}
          projectId="project-3"
          currentTopicId="topic-a"
          onSnapshot={(value) => {
            snapshot = value;
          }}
        />,
      );
    });

    const current = snapshot?.branchItems.find(
      (item: { id: string }) => item.id === "topic-a",
    );
    const merged = snapshot?.branchItems.find(
      (item: { id: string }) => item.id === "topic-b",
    );
    expect(current?.status).toBe("in_progress");
    expect(merged?.status).toBe("merged");
  });

  it("外部托管模式应回调状态变更", async () => {
    let snapshot = null as ReturnType<typeof useTopicBranchBoard> | null;
    let controlledMap: Record<
      string,
      "in_progress" | "pending" | "merged" | "candidate"
    > = {
      "topic-a": "in_progress",
      "topic-b": "candidate",
    };
    const handleStatusMapChange = (
      next: Record<string, "in_progress" | "pending" | "merged" | "candidate">,
    ) => {
      controlledMap = next;
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(
        <Probe
          enabled={true}
          projectId="project-4"
          currentTopicId="topic-a"
          externalStatusMap={controlledMap}
          onStatusMapChange={handleStatusMapChange}
          onSnapshot={(value) => {
            snapshot = value;
          }}
        />,
      );
    });

    await act(async () => {
      snapshot?.setTopicStatus("topic-b", "merged");
    });

    expect(controlledMap["topic-b"]).toBe("merged");
  });
});
