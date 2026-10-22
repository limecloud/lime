import { useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zhCN from "@/i18n/resources/zh-CN/agent.json";
import zhTW from "@/i18n/resources/zh-TW/agent.json";
import enUS from "@/i18n/resources/en-US/agent.json";
import jaJP from "@/i18n/resources/ja-JP/agent.json";
import koKR from "@/i18n/resources/ko-KR/agent.json";
import { type FilePreviewContext } from "./filePreviewTarget";

import { FilePreviewPanel } from "./FilePreviewPanel";
import {
  resolveFilePreviewModeState,
  type FilePreviewMode,
} from "./filePreviewModel";

vi.mock("@/components/artifact", () => ({ ArtifactRenderer: () => null }));
vi.mock("../components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <article>{content}</article>
  ),
}));

const roots: Array<{ root: Root; container: HTMLDivElement }> = [];
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function render(
  path: string,
  content: string,
  translations: Record<string, string> = enUS,
) {
  const context: FilePreviewContext = {
    title: path.split("/").at(-1)!,

    selectionPath: path,
    content,

    target: {
      kind: "text",
      title: path,
      filePath: path,
      absolutePath: path,
      content,
    },
  };
  const modeState = resolveFilePreviewModeState(context);
  function Probe() {
    const [mode, setMode] = useState<FilePreviewMode>(modeState.defaultMode);
    return (
      <FilePreviewPanel
        context={context}
        mode={mode}
        modeState={modeState}
        onSelectMode={setMode}
        translate={(key) => translations[key] ?? key}
        toolbarActions={<button aria-label="Toggle file tree">Tree</button>}
      />
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  roots.push({ root, container });
  return container;
}

describe("文件源码/预览切换", () => {
  it.each([
    ["zh-CN", zhCN],
    ["zh-TW", zhTW],
    ["en-US", enUS],
    ["ja-JP", jaJP],
    ["ko-KR", koKR],
  ] as const)("%s 使用一个按钮切换，并保留文件树操作", (_, copy) => {
    const container = render("/work/README.md", "# Source", copy);
    const prefix = "agentChat.filePreview.";
    const tree = container.querySelector('[aria-label="Toggle file tree"]');
    const toggle = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-testid="file-preview-mode-toggle"]',
      )!;
    expect(toggle().textContent).toBe(copy[`${prefix}viewSource`]);
    expect(toggle().getAttribute("aria-label")).toBe(toggle().textContent);
    expect(container.querySelectorAll("button")).toHaveLength(2);
    act(() => toggle().click());
    expect(container.querySelector("pre")?.textContent).toBe("# Source");
    expect(toggle().textContent).toBe(copy[`${prefix}viewPreview`]);
    act(() => toggle().click());
    expect(container.querySelector("article")?.textContent).toBe("# Source");
    expect(container.querySelector('[aria-label="Toggle file tree"]')).toBe(
      tree,
    );
  });

  it("普通源码只显示内容和可用操作，不显示不可用的预览按钮", () => {
    const source = "export const value = 1;";
    const container = render("/work/source.ts", source);
    expect(container.querySelector("pre")?.textContent).toBe(source);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("button:disabled")).toBeNull();
  });

  it("HTML 预览与同一文件的源码相互切换", () => {
    const source = "<!doctype html><html><body>Preview</body></html>";
    const container = render("/work/index.html", source);
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
      source,
    );
    const toggle = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-testid="file-preview-mode-toggle"]',
      )!;
    act(() => toggle().click());
    expect(container.querySelector("pre")?.textContent).toBe(source);
    act(() => toggle().click());
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
      source,
    );
  });
});
