import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadSidePanelNewTab } from "./ThreadSidePanelNewTab";
import type { ThreadOutput } from "./threadOutputs";
import en from "@/i18n/resources/en-US/agent.json";
import zh from "@/i18n/resources/zh-CN/agent.json";
import tw from "@/i18n/resources/zh-TW/agent.json";
import ja from "@/i18n/resources/ja-JP/agent.json";
import ko from "@/i18n/resources/ko-KR/agent.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => en[key as keyof typeof en] ?? key,
    i18n: { language: "en-US" },
  }),
}));
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
const files: ThreadOutput[] = Array.from({ length: 12 }, (_, index) => ({
  type: "file",
  path: `/project/report-${index}.pdf`,
  threadId: "thread",
  turnId: "turn",
  itemId: `item-${index}`,
  ...(index === 0 ? { producedAtMs: Date.parse("2026-10-20T02:00:00Z") } : {}),
}));
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
});
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mount(outputs: readonly ThreadOutput[] = files) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const open = vi.fn();
  act(() =>
    root.render(
      <ThreadSidePanelNewTab
        actions={[]}
        onActionSelect={vi.fn()}
        onChatSelect={vi.fn()}
        outputs={outputs}
        onOpenOutput={open}
      />,
    ),
  );
  return { container, open };
}
describe("New tab Recents", () => {
  it.each([
    ["http://localhost:4317/demo?q=1#part", "localhost:4317/demo?q=1"],
    ["http://localhost:4317/", "localhost:4317"],
    ["out/index.html", "index.html"],
  ])("网站按参考合同显示名称并保留target/点击事件：%s", (target, name) => {
    const output: ThreadOutput = {
      type: "website",
      target,
      threadId: "thread",
      turnId: "turn",
      itemId: "website",
    };
    const { container, open } = mount([output]);
    const button = container.querySelector<HTMLButtonElement>(
      `ul button[title="${target}"]`,
    )!;
    expect(button.getAttribute("aria-label")).toBe(name);
    expect(button.textContent).toContain("Website");
    act(() =>
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true }),
      ),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(
      output,
      expect.objectContaining({ metaKey: true }),
    );
  });
  it("目录位于Tools之后，使用原生按钮打开同一资源且日期仅来自有效回合时间", () => {
    const { container, open } = mount();
    expect(
      [...container.querySelectorAll("h3")].map((node) => node.textContent),
    ).toEqual(["Tools", "Sources"]);
    const list = container.querySelector('ul[aria-label="Recent work"]')!;
    expect(list.children).toHaveLength(12);
    const button = list.querySelector<HTMLButtonElement>("button")!;
    act(() => button.click());
    expect(open).toHaveBeenCalledWith(
      files[0],
      expect.objectContaining({ type: "click" }),
    );
    expect(button.textContent).toContain("PDF");
    expect(container.querySelectorAll("time")).toHaveLength(1);
    expect(container.querySelector("time")?.dateTime).toBe(
      "2026-10-20T02:00:00.000Z",
    );
  });
  it("无产物显示空来源提示但不对渲染分页按钮", () => {
    const { container } = mount([]);
    expect(container.querySelector("ul")).toBeNull();
    expect(container.textContent).toContain("Sources");
    expect(container.textContent).toContain("No sources yet");
  });
  it("生成图片依canonical类型显示且打开保留原始thread/turn/item身份", () => {
    const image: ThreadOutput = {
      type: "generated-image",
      path: "/project/generated-output",
      threadId: "thread",
      turnId: "image-turn",
      itemId: "image-item",
    };
    const { container, open } = mount([image]);
    const button = container.querySelector<HTMLButtonElement>(
      'ul button[aria-label="generated-output"]',
    )!;
    expect(button.textContent).toContain(
      en["agentChat.rightSurface.newTab.fileType.image"],
    );
    act(() => button.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(
      image,
      expect.objectContaining({ type: "click" }),
    );
  });
  it("分页按整行移动，reduced motion立即滚动，末端按钮禁用", () => {
    const { container } = mount();
    const list = container.querySelector("ul")!;
    Object.defineProperties(list, {
      clientHeight: { value: 336 },
      scrollHeight: { value: 672 },
      scrollTop: { value: 0, writable: true },
    });
    list.scrollBy = vi.fn();
    act(() => list.dispatchEvent(new Event("scroll")));
    const previous = container.querySelector<HTMLButtonElement>(
      '[aria-label="Previous recent work"]',
    )!;
    const next = container.querySelector<HTMLButtonElement>(
      '[aria-label="Next recent work"]',
    )!;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    act(() => next.click());
    expect(list.scrollBy).toHaveBeenCalledWith({
      top: 280,
      behavior: "instant",
    });
    list.scrollTop = 336;
    act(() => list.dispatchEvent(new Event("scroll")));
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });
  it("新增文案覆盖五语言且key集合一致", () => {
    const keys = Object.keys(en).filter(
      (key) =>
        key.startsWith("agentChat.rightSurface.newTab.fileType.") ||
        /newTab\.(recents|recentWork|previousRecents|nextRecents)$/.test(key),
    );
    expect(keys).toHaveLength(11);
    for (const resource of [en, zh, tw, ja, ko])
      for (const key of keys)
        expect((resource as Record<string, string>)[key]).toBeTruthy();
  });

  it("查看全部可展开并收起来源列表", () => {
    const { container } = mount();
    const list = container.querySelector<HTMLUListElement>("ul[aria-label=\"Recent work\"]")!;
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="thread-side-panel-recents-toggle"]',
    )!;
    expect(list.style.maxHeight).not.toBe("");
    act(() => toggle.click());
    expect(list.style.maxHeight).toBe("");
    act(() => toggle.click());
    expect(list.style.maxHeight).not.toBe("");
  });
});
