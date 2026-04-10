import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasPanel } from "./CanvasPanel";

interface MountedCanvasPanel {
  container: HTMLDivElement;
  root: Root;
}

const mountedPanels: MountedCanvasPanel[] = [];

function mountCanvasPanel(
  props: ComponentProps<typeof CanvasPanel>,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<CanvasPanel {...props} />);
  });

  mountedPanels.push({ container, root });
  return container;
}

describe("CanvasPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:canvas-panel"),
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    while (mountedPanels.length > 0) {
      const mounted = mountedPanels.pop();
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

  it("嵌入式模式不应再渲染重复文件工具栏", () => {
    const container = mountCanvasPanel({
      state: {
        isOpen: true,
        contentType: "markdown",
        content: "# 标题\n\n正文内容",
        filename: "index.md",
        isEditing: false,
      },
      onClose: vi.fn(),
      onContentChange: vi.fn(),
      chrome: "embedded",
    });

    expect(container.textContent).toContain("标题");
    expect(container.textContent).not.toContain("index.md");
    expect(container.querySelector('[title="关闭"]')).toBeNull();
    expect(container.querySelector('[title="下载"]')).toBeNull();
    expect(container.querySelector('[title="复制"]')).toBeNull();
  });
});
