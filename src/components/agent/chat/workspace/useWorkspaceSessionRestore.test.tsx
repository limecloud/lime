import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSessionRestore } from "./useWorkspaceSessionRestore";

type HookProps = Parameters<typeof useWorkspaceSessionRestore>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderHook(props: HookProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe(currentProps: HookProps) {
    useWorkspaceSessionRestore(currentProps);
    return null;
  }

  const render = async (nextProps = props) => {
    await act(async () => {
      root.render(<Probe {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return { render };
}

async function flushEffects(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    act(() => {});
  }
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
  vi.restoreAllMocks();
});

describe("useWorkspaceSessionRestore", () => {
  it("恢复嵌套内容文件时应保留文件 metadata", async () => {
    const setActiveTheme = vi.fn();
    const setCreationMode = vi.fn();
    const setTaskFiles = vi.fn();
    const readSessionFile = vi.fn(async (name: string) =>
      name === "content-posts/restored-preview.md"
        ? "# 春日咖啡活动\n\n首屏预览"
        : null,
    );
    const { render } = renderHook({
      sessionId: "session-content-preview",
      sessionMeta: {
        sessionId: "session-content-preview",
        theme: "general",
        creationMode: "guided",
      },
      lockTheme: true,
      initialTheme: "general",
      sessionFiles: [
        {
          name: "content-posts/restored-preview.md",
          fileType: "document",
          metadata: {
            contentPostIntent: "preview",
            contentPostLabel: "渠道预览稿",
            contentPostPlatformLabel: "小红书",
          },
          createdAt: 100,
          updatedAt: 200,
        },
      ],
      readSessionFile,
      taskFilesLength: 0,
      setActiveTheme,
      setCreationMode,
      setTaskFiles,
    });

    await render();
    await flushEffects();

    expect(readSessionFile).toHaveBeenCalledWith(
      "content-posts/restored-preview.md",
    );
    expect(setCreationMode).toHaveBeenCalledWith("guided");
    expect(setTaskFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "content-posts/restored-preview.md",
          type: "document",
          content: "# 春日咖啡活动\n\n首屏预览",
          metadata: expect.objectContaining({
            contentPostIntent: "preview",
            contentPostLabel: "渠道预览稿",
            contentPostPlatformLabel: "小红书",
          }),
        }),
      ]),
    );
    expect(setActiveTheme).not.toHaveBeenCalled();
  });
});
