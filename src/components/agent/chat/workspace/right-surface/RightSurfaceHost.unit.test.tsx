import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RightSurfaceHost } from "./RightSurfaceHost";
import {
  RightSurfaceTabStrip,
  type RightSurfaceTabStripProps,
} from "./RightSurfaceTabStrip";
import { ThreadSidePanelNewTab } from "./ThreadSidePanelNewTab";
import type { RightSurfaceDefinition } from "./rightSurfaceTypes";
import { useRightSurfaceTab } from "./rightSurfaceTabContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
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
function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  roots.push({ root, container });
  return container;
}
const definitions: RightSurfaceDefinition[] = [
  { kind: "files", label: "Files", render: () => <div>file-browser</div> },
  { kind: "changes", label: "Changes", render: () => <div>diff-review</div> },
  {
    kind: "workspace-new-tab",
    label: "New tab",
    render: () => <div>new-tab</div>,
  },
];
const defaults: RightSurfaceTabStripProps = {
  definitions,
  idPrefix: "fixture",
  tabs: [
    { tabId: "file-1", kind: "files" },
    { tabId: "change-1", kind: "changes" },
  ],
  activeTabId: "file-1",
  onNewTab: vi.fn(),
  onSelectTab: vi.fn(),
  onCloseTab: vi.fn(),
  previewTabId: null,
};
describe("Thread side panel presentation", () => {
  it("reuses one Browser presenter across canonical tabs and hides it on Files", () => {
    const tabs = [
      { tabId: "b1", kind: "browser" as const },
      { tabId: "b2", kind: "browser" as const },
      { tabId: "f1", kind: "files" as const },
    ];
    const unmount = vi.fn();
    function BrowserContent() {
      const context = useRightSurfaceTab();
      React.useEffect(() => unmount, []);
      return (
        <input
          data-browser-presenter
          data-tab={context?.tab.tabId}
          data-active={context?.active}
          defaultValue="draft"
        />
      );
    }
    const browserDefinitions: RightSurfaceDefinition[] = [
      { kind: "browser", render: () => <BrowserContent /> },
      { kind: "files", render: () => <div>Files</div> },
    ];
    const render = (active: string) => (
      <RightSurfaceHost
        idPrefix="fixture"
        tabId={active}
        tabs={tabs}
        definitions={browserDefinitions}
        activeSurface={active === "f1" ? "files" : "browser"}
        onPinTab={vi.fn()}
        previewTabId={null}
      />
    );
    const container = mount(render("b1"));
    const presenter = container.querySelector<HTMLInputElement>(
      "[data-browser-presenter]",
    )!;
    presenter.value = "retained draft";
    act(() => roots.at(-1)!.root.render(render("b2")));
    expect(container.querySelectorAll("[data-browser-presenter]")).toHaveLength(
      1,
    );
    expect(container.querySelector("[data-browser-presenter]")).toBe(presenter);
    expect(presenter.dataset.tab).toBe("b2");
    expect(presenter.value).toBe("retained draft");
    act(() => roots.at(-1)!.root.render(render("f1")));
    expect(presenter.dataset.active).toBe("false");
    expect(presenter.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(
      true,
    );
    act(() => roots.at(-1)!.root.render(render("b1")));
    expect(presenter.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(
      false,
    );
    expect(unmount).not.toHaveBeenCalled();
  });
  it("Files与Changes的标签及pane分别映射，ARIA按真实tabId关联", () => {
    const container = mount(
      <>
        <div role="tablist">
          <RightSurfaceTabStrip {...defaults} />
        </div>
        <RightSurfaceHost
          idPrefix="fixture"
          tabId="file-1"
          activeSurface="files"
          definitions={definitions}
          tabs={defaults.tabs}
          onPinTab={vi.fn()}
          previewTabId={null}
        />
      </>,
    );
    const file = container.querySelector(
      '[data-testid="workspace-right-surface-tab-files"]',
    )!;
    expect(file.id).toBe("fixture-tab-file-1");
    expect(file.getAttribute("aria-selected")).toBe("true");
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute("aria-labelledby")).toBe(file.id);
    expect(file.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.textContent).toBe("file-browser");
    expect(panel.textContent).not.toContain("diff-review");
  });
  it("文件标签显示basename与完整路径提示，切换保留内容DOM和局部状态", () => {
    const tabs = [
      {
        tabId: "file:/work/a.ts",
        kind: "files" as const,
        filePath: "/work/a.ts",
        contentInstance: "a",
      },
      {
        tabId: "file:/work/b.ts",
        kind: "files" as const,
        filePath: "/work/b.ts",
        contentInstance: "b",
      },
    ];
    function FileContent({ path }: { path: string }) {
      const [count, setCount] = React.useState(0);
      return (
        <button data-path={path} onClick={() => setCount(count + 1)}>
          {count}
        </button>
      );
    }
    const fileDefinitions: RightSurfaceDefinition[] = [
      {
        kind: "files",
        render: ({ tab }) => <FileContent path={tab.filePath!} />,
      },
    ];
    const render = (active: string) => (
      <>
        <RightSurfaceTabStrip
          {...defaults}
          definitions={fileDefinitions}
          tabs={tabs}
          activeTabId={active}
        />
        <RightSurfaceHost
          idPrefix="fixture"
          tabId={active}
          tabs={tabs}
          definitions={fileDefinitions}
          activeSurface="files"
          onPinTab={vi.fn()}
          previewTabId={null}
        />
      </>
    );
    const container = mount(render(tabs[0].tabId));
    const first = container.querySelector<HTMLButtonElement>(
      'button[data-path="/work/a.ts"]',
    )!;
    act(() => first.click());
    act(() => roots.at(-1)!.root.render(render(tabs[1].tabId)));
    expect(first.closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    act(() => roots.at(-1)!.root.render(render(tabs[0].tabId)));
    expect(container.querySelector('button[data-path="/work/a.ts"]')).toBe(
      first,
    );
    expect(first.textContent).toBe("1");
    const tab = container.querySelector(
      '[role="tab"][data-file-path="/work/a.ts"]',
    )!;
    expect(tab.textContent).toBe("a.ts");
    expect(tab.getAttribute("title")).toBe("/work/a.ts");
    expect(first.closest('[role="tabpanel"]')?.id).toBe(
      tab.getAttribute("aria-controls"),
    );
  });
  it("New tab按身份共存；选择、关闭与Delete委托同一owner", () => {
    const select = vi.fn(),
      close = vi.fn(),
      add = vi.fn();
    const container = mount(
      <RightSurfaceTabStrip
        {...defaults}
        tabs={[
          { tabId: "n1", kind: "workspace-new-tab" },
          { tabId: "n2", kind: "workspace-new-tab" },
        ]}
        activeTabId="n2"
        onSelectTab={select}
        onCloseTab={close}
        onNewTab={add}
      />,
    );
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].id).not.toBe(tabs[1].id);
    act(() => tabs[0].click());
    expect(select).toHaveBeenCalledWith("n1");
    act(() =>
      tabs[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      ),
    );
    expect(close).toHaveBeenCalledWith("n2");
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="workspace-right-surface-new-tab"]',
        )
        ?.click(),
    );
    expect(add).toHaveBeenCalledTimes(1);
  });
  it("预览只在非文件树的指针或键盘操作固定，固定后保留内容DOM", () => {
    const pin = vi.fn();
    const tab = {
      tabId: "file:/work/a.ts",
      kind: "files" as const,
      contentInstance: "preview-instance",
      filePath: "/work/a.ts",
    };
    const fileDefinitions: RightSurfaceDefinition[] = [
      {
        kind: "files",
        render: () => (
          <>
            <input aria-label="file editor" defaultValue="draft" />
            <div data-tab-preview-pin-exempt>
              <button>tree row</button>
            </div>
          </>
        ),
      },
    ];
    const render = (previewTabId: string | null) => (
      <RightSurfaceHost
        idPrefix="fixture"
        tabId={tab.tabId}
        tabs={[tab]}
        definitions={fileDefinitions}
        activeSurface="files"
        onPinTab={pin}
        previewTabId={previewTabId}
      />
    );
    const container = mount(render(tab.tabId));
    const treeRow = container.querySelector("button")!;
    const editor = container.querySelector("input")!;
    act(() => {
      treeRow.dispatchEvent(
        new Event("pointerdown", { bubbles: true, composed: true }),
      );
      treeRow.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          composed: true,
        }),
      );
    });
    expect(pin).not.toHaveBeenCalled();
    act(() =>
      editor.dispatchEvent(
        new Event("pointerdown", { bubbles: true, composed: true }),
      ),
    );
    expect(pin).toHaveBeenCalledExactlyOnceWith(tab.tabId);
    pin.mockClear();
    act(() =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          bubbles: true,
          composed: true,
        }),
      ),
    );
    expect(pin).toHaveBeenCalledExactlyOnceWith(tab.tabId);
    act(() => roots.at(-1)!.root.render(render(null)));
    expect(container.querySelector("input")).toBe(editor);
    expect(editor.value).toBe("draft");
    pin.mockClear();
    act(() =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          bubbles: true,
          composed: true,
        }),
      ),
    );
    expect(pin).not.toHaveBeenCalled();
  });
  it("替换预览复用面板和文件树DOM，但重建新文件的编辑内容", () => {
    const first = {
      tabId: "file:/work/a.ts",
      kind: "files" as const,
      filePath: "/work/a.ts",
      contentInstance: "a-content",
      dndId: "preview-pane",
    };
    const second = {
      ...first,
      tabId: "file:/work/b.ts",
      filePath: "/work/b.ts",
      contentInstance: "b-content",
    };
    const fileDefinitions: RightSurfaceDefinition[] = [
      {
        kind: "files",
        render: ({ tab }) => (
          <>
            <input key={tab.contentInstance} defaultValue={tab.filePath!} />
            <button data-tab-preview-pin-exempt>tree row</button>
          </>
        ),
      },
    ];
    const render = (tab: typeof first) => (
      <RightSurfaceHost
        idPrefix="fixture"
        tabId={tab.tabId}
        tabs={[tab]}
        definitions={fileDefinitions}
        activeSurface="files"
        onPinTab={vi.fn()}
        previewTabId={tab.tabId}
      />
    );
    const container = mount(render(first));
    const panel = container.querySelector('[role="tabpanel"]');
    const treeRow = container.querySelector("button");
    const editor = container.querySelector("input");
    act(() => roots.at(-1)!.root.render(render(second)));
    expect(container.querySelector('[role="tabpanel"]')).toBe(panel);
    expect(container.querySelector("button")).toBe(treeRow);
    expect(container.querySelector("input")).not.toBe(editor);
    expect(container.querySelector("input")?.value).toBe(second.filePath);
    expect(panel?.getAttribute("aria-labelledby")).toBe(
      `fixture-tab-${second.tabId}`,
    );
  });
  it("New tab调用真实工具选择与Chat动作，空列表不伪造Recents", () => {
    const action = {
      id: "open-file",
      kind: "files" as const,
      title: "Files",
      icon: null,
    };
    const open = vi.fn(),
      chat = vi.fn();
    const container = mount(
      <ThreadSidePanelNewTab
        actions={[action]}
        onActionSelect={open}
        onChatSelect={chat}
      />,
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="side-panel-new-tab-open-file"]',
        )
        ?.click(),
    );
    expect(open).toHaveBeenCalledWith(action);
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="side-panel-new-tab-chat"]',
        )
        ?.click(),
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Recents");
  });
});
