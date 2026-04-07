import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import { useWorkspaceArtifactViewModeControl } from "./useWorkspaceArtifactViewModeControl";

type HookProps = Parameters<typeof useWorkspaceArtifactViewModeControl>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  const content = overrides.content ?? "<html></html>";
  return {
    id: overrides.id ?? "artifact-html-1",
    type: overrides.type ?? "html",
    title: overrides.title ?? "spring.html",
    content,
    status: overrides.status ?? "streaming",
    meta: {
      filePath: overrides.meta?.filePath ?? "spring.html",
      filename: overrides.meta?.filename ?? "spring.html",
      writePhase: overrides.meta?.writePhase ?? "streaming",
      ...overrides.meta,
    },
    position: overrides.position ?? { start: 0, end: content.length },
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    error: overrides.error,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<
    typeof useWorkspaceArtifactViewModeControl
  > | null = null;

  const defaultProps: HookProps = {
    activeTheme: "general",
    displayedArtifact: createArtifact(),
    activeArtifactId: "artifact-html-1",
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceArtifactViewModeControl(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

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
});

describe("useWorkspaceArtifactViewModeControl", () => {
  it("流式 HTML 产物应优先展示源码，完成后自动切到预览", async () => {
    const { render, getValue } = renderHook();

    await render();
    expect(getValue().artifactViewMode).toBe("source");

    await render({
      displayedArtifact: createArtifact({
        status: "complete",
        meta: {
          filePath: "spring.html",
          filename: "spring.html",
          writePhase: "completed",
        },
      }),
    });

    expect(getValue().artifactViewMode).toBe("preview");
  });

  it("用户手动切回源码后，完成态不应覆盖当前选择", async () => {
    const { render, getValue } = renderHook();

    await render();

    act(() => {
      getValue().handleArtifactViewModeChange("source");
    });

    await render({
      displayedArtifact: createArtifact({
        status: "complete",
        meta: {
          filePath: "spring.html",
          filename: "spring.html",
          writePhase: "completed",
        },
      }),
    });

    expect(getValue().artifactViewMode).toBe("source");
  });

  it("切换到新的 active artifact 后应恢复自动视图流转", async () => {
    const { render, getValue } = renderHook();

    await render();

    act(() => {
      getValue().handleArtifactViewModeChange("source");
    });

    await render({
      activeArtifactId: "artifact-html-2",
      displayedArtifact: createArtifact({
        id: "artifact-html-2",
        status: "complete",
        meta: {
          filePath: "landing.html",
          filename: "landing.html",
          writePhase: "completed",
        },
      }),
    });

    expect(getValue().artifactViewMode).toBe("preview");
  });
});
