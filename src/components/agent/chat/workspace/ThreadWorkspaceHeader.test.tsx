import { AppShell, AppShellHeader } from "@/components/app-shell/AppShell";
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ThreadWorkspaceHeader } from "./ThreadWorkspaceHeader";
import { LayoutTransition } from "@/components/workspace/layout/LayoutTransition";
import { ThreadSidePanelLauncher } from "./right-surface/ThreadSidePanelLauncher";

beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  document.body.innerHTML = "";
  await changeLimeLocale("en-US");
});

describe("ThreadWorkspaceHeader", () => {
  it.each([
    ["zh-CN", "打开侧边面板", "关闭侧边面板"],
    ["zh-TW", "開啟側邊面板", "關閉側邊面板"],
    ["en-US", "Open side panel", "Close side panel"],
    ["ja-JP", "サイドパネルを開く", "サイドパネルを閉じる"],
    ["ko-KR", "측면 패널 열기", "측면 패널 닫기"],
  ] as const)(
    "%s 的窗口侧栏开关保持可访问名称和展开状态",
    async (locale, openLabel, closeLabel) => {
      await changeLimeLocale(locale);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const onToggle = vi.fn();
      const render = (open: boolean) =>
        act(() =>
          root.render(
            <AppShell>
              <AppShellHeader />
              <ThreadSidePanelLauncher open={open} onToggle={onToggle} />
            </AppShell>,
          ),
        );
      try {
        render(false);
        const button = container.querySelector<HTMLButtonElement>("button")!;
        expect(button.getAttribute("aria-label")).toBe(openLabel);
        expect(button.getAttribute("aria-expanded")).toBe("false");
        act(() => button.click());
        expect(onToggle).toHaveBeenCalledOnce();
        render(true);
        expect(container.querySelector("button")).toBe(button);
        expect(button.getAttribute("aria-label")).toBe(closeLabel);
        expect(button.getAttribute("aria-expanded")).toBe("true");
      } finally {
        act(() => root.unmount());
      }
    },
  );

  it("侧栏开关独立留在窗口右槽，工具栏迁移保留按钮实例与回调", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onToggle = vi.fn();
    const render = (mode: "chat" | "chat-canvas", open = true) =>
      act(() =>
        root.render(
          <AppShell>
            <AppShellHeader />
            <LayoutTransition
              mode={mode}
              mainTabLabel="thread"
              mainToolbar={
                <ThreadWorkspaceHeader
                  sessionId="thread-1"
                  title="thread"
                  actions={
                    <>
                      <input aria-label="tool draft" defaultValue="draft" />
                      <ThreadSidePanelLauncher
                        open={open}
                        onToggle={onToggle}
                      />
                    </>
                  }
                />
              }
              chatContent={<textarea aria-label="composer" />}
              canvasContent={<div>browser</div>}
            />
          </AppShell>,
        ),
      );
    const check = () => {
      const button = container.querySelector<HTMLButtonElement>(
        '[data-testid="thread-side-panel-toggle"]',
      )!;
      expect(
        button.closest('[data-app-shell-header-slot="end"]'),
      ).not.toBeNull();
      expect(
        button.closest('[data-header-action-id="thread-side-panel-close"]'),
      ).not.toBeNull();
      expect(
        button.closest('[data-testid="thread-workspace-header-tools"]'),
      ).toBeNull();
      return button;
    };
    try {
      render("chat");
      const button = check();
      expect(button.getAttribute("aria-expanded")).toBe("true");
      render("chat-canvas");
      expect(check()).toBe(button);
      act(() => button.click());
      expect(onToggle).toHaveBeenCalledOnce();
      act(() =>
        container
          .querySelector('[data-testid="layout-content-tab"]')!
          .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
      );
      expect(check()).toBe(button);
      render("chat", false);
      expect(check()).toBe(button);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      act(() => button.click());
      expect(onToggle).toHaveBeenCalledTimes(2);
    } finally {
      act(() => root.unmount());
    }
    expect(
      document.querySelector('[data-testid="thread-side-panel-toggle"]'),
    ).toBeNull();
  });

  it("动作在window/chat/tab-strip之间移动时保持同一实例，More始终留在窗口槽", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (mode: "chat" | "chat-canvas") =>
      act(() =>
        root.render(
          <AppShell>
            <AppShellHeader />
            <LayoutTransition
              mode={mode}
              mainTabLabel="canonical title"
              mainToolbar={
                <ThreadWorkspaceHeader
                  sessionId="thread-1"
                  title="canonical title"
                  onRename={vi.fn()}
                  summaryToggle={
                    <button data-testid="thread-workspace-summary-toggle">
                      Summary
                    </button>
                  }
                  actions={
                    <input
                      aria-label="tool draft"
                      defaultValue="retained tool state"
                    />
                  }
                />
              }
              chatContent={
                <textarea
                  aria-label="composer"
                  defaultValue="retained composer"
                />
              }
              canvasContent={<div>files</div>}
            />
          </AppShell>,
        ),
      );
    const tools = () =>
      container.querySelector('[data-testid="thread-workspace-header-tools"]')!;
    render("chat");
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="tool draft"]',
    )!;
    expect(
      tools().closest('[data-app-shell-header-slot="end"]'),
    ).not.toBeNull();
    render("chat-canvas");
    expect(
      tools().closest('[data-testid="thread-workspace-header"]'),
    ).not.toBeNull();
    act(() =>
      container
        .querySelector('[data-testid="layout-content-tab"]')!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(tools().closest('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="tool draft"]')).toBe(
      input,
    );
    expect(input.value).toBe("retained tool state");
    expect(
      container
        .querySelector('[data-testid="thread-workspace-header-action-menu"]')
        ?.closest('[data-app-shell-header-slot="end"]'),
    ).not.toBeNull();
    render("chat");
    expect(
      tools().closest('[data-app-shell-header-slot="end"]'),
    ).not.toBeNull();
    expect(container.querySelector('input[aria-label="tool draft"]')).toBe(
      input,
    );
    act(() => root.unmount());
    expect(document.querySelector('input[aria-label="tool draft"]')).toBeNull();
  });

  it("共享页头保留线程身份和动作，删除重复导航、状态与目录", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <AppShell>
          <AppShellHeader />
          <ThreadWorkspaceHeader
            sessionId="thread-1"
            title="对齐 Codex App GUI"
            actions={<button data-testid="header-action">打开位置</button>}
          />
        </AppShell>,
      );
    });
    expect(
      container.querySelector("[data-app-shell-header-toolbar]"),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="thread-workspace-header-title"]')
        ?.textContent,
    ).toBe("对齐 Codex App GUI");
    for (const id of ["navigation", "status", "directory"]) {
      expect(
        container.querySelector(
          `[data-testid="thread-workspace-header-${id}"]`,
        ),
      ).toBeNull();
    }
    expect(
      container.querySelector('[data-testid="header-action"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="thread-workspace-header-tools"]')
        ?.className,
    ).toContain("overflow-x-auto");
    expect(
      container.querySelector('[data-testid="thread-workspace-header-actions"]')
        ?.className,
    ).not.toContain("overflow-x-auto");
    act(() => root.unmount());
  });

  it("应通过标题栏就地重命名提交给 workspace owner", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRename = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.spyOn(window, "prompt");

    act(() => {
      root.render(
        <AppShell>
          <AppShellHeader />
          <ThreadWorkspaceHeader
            sessionId="thread-1"
            title="旧 Thread 名称"
            onRename={onRename}
            onFork={vi.fn()}
            onArchive={vi.fn()}
          />
        </AppShell>,
      );
    });

    expect(
      container.querySelector(
        '[data-testid="thread-workspace-header-tools"] [data-testid="thread-workspace-header-action-menu"]',
      ),
    ).toBeNull();

    act(() => {
      (
        container.querySelector(
          '[data-testid="thread-workspace-header-action-menu"]',
        ) as HTMLButtonElement
      )?.click();
    });
    expect(container.querySelector('[role="menuitem"]')?.textContent).toContain(
      "重命名",
    );
    expect(
      container
        .querySelector('[data-testid="thread-workspace-header-action-menu"]')
        ?.getAttribute("title"),
    ).toBe("更多操作");
    expect(
      document.body.querySelector(
        '[data-testid="thread-workspace-header-fork"]',
      )?.textContent,
    ).toContain("分叉对话");
    expect(
      document.body.querySelector(
        '[data-testid="thread-workspace-header-archive"]',
      )?.textContent,
    ).toContain("归档");

    await act(async () => {
      (container.querySelector('[role="menuitem"]') as HTMLElement)?.click();
    });

    const input = container.querySelector(
      '[data-testid="thread-workspace-header-title-input"]',
    ) as HTMLInputElement;
    expect(input.value).toBe("旧 Thread 名称");
    expect(input.getAttribute("aria-label")).toBe("重命名对话");
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(input, "  新的 Thread 名称  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(onRename).toHaveBeenCalledWith("新的 Thread 名称");

    act(() => {
      (
        container.querySelector(
          '[data-testid="thread-workspace-header-action-menu"]',
        ) as HTMLButtonElement
      )?.click();
    });
    expect(
      document.body.querySelector(
        '[data-testid="thread-workspace-header-fork"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '[data-testid="thread-workspace-header-archive"]',
      ),
    ).not.toBeNull();

    prompt.mockRestore();
    act(() => root.unmount());
  });

  it("应把 fork 和 archive 操作交给 workspace owner", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFork = vi.fn().mockResolvedValue(undefined);
    const onArchive = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(
        <AppShell>
          <AppShellHeader />
          <ThreadWorkspaceHeader
            sessionId="thread-1"
            title="当前 Thread"
            onFork={onFork}
            onArchive={onArchive}
          />
        </AppShell>,
      );
    });

    act(() => {
      (
        container.querySelector(
          '[data-testid="thread-workspace-header-action-menu"]',
        ) as HTMLButtonElement
      )?.click();
    });
    const menuRoot = document.body;
    const menuItems = menuRoot.querySelectorAll('[role="menuitem"]');
    expect(menuItems).toHaveLength(2);

    await act(async () => {
      (menuItems[0] as HTMLElement)?.click();
    });
    expect(onFork).toHaveBeenCalledTimes(1);

    act(() => {
      (
        container.querySelector(
          '[data-testid="thread-workspace-header-action-menu"]',
        ) as HTMLButtonElement
      )?.click();
    });
    await act(async () => {
      const archiveItems = menuRoot.querySelectorAll('[role="menuitem"]');
      (archiveItems[1] as HTMLElement)?.click();
    });
    expect(onArchive).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("标题栏委托摘要动作，并保持展示与面板状态分离", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onToggleSummary = vi.fn();

    act(() => {
      root.render(
        <AppShell>
          <AppShellHeader />
          <ThreadWorkspaceHeader
            sessionId="thread-1"
            title="当前 Thread"
            summaryToggle={
              <button
                data-testid="thread-workspace-summary-toggle"
                aria-expanded={false}
                onClick={onToggleSummary}
              >
                Summary
              </button>
            }
          />
        </AppShell>,
      );
    });

    const toggle = container.querySelector(
      '[data-testid="thread-workspace-summary-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector('[data-testid="thread-workspace-summary"]'),
    ).toBeNull();

    act(() => {
      toggle.click();
    });

    expect(onToggleSummary).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="thread-workspace-summary"]'),
    ).toBeNull();

    act(() => root.unmount());
  });

  it("编辑中切换会话取消旧草稿，旧输入事件不能重命名新会话", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const renameA = vi.fn().mockResolvedValue(undefined);
    const renameB = vi.fn().mockResolvedValue(undefined);
    const render = (
      sessionId: string,
      title: string,
      onRename: typeof renameA,
    ) => {
      act(() =>
        root.render(
          <AppShell>
            <AppShellHeader />
            <ThreadWorkspaceHeader
              sessionId={sessionId}
              title={title}
              onRename={onRename}
            />
          </AppShell>,
        ),
      );
    };
    const startEditing = () => {
      act(() =>
        (
          container.querySelector(
            '[data-testid="thread-workspace-header-title"] button',
          ) as HTMLButtonElement
        ).click(),
      );
      return container.querySelector<HTMLInputElement>(
        '[data-testid="thread-workspace-header-title-input"]',
      )!;
    };
    const changeText = (input: HTMLInputElement, text: string) => {
      act(() => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    render("thread-A", "A 标题", renameA);
    const oldInput = startEditing();
    changeText(oldInput, "A 未提交草稿");
    render("thread-B", "B 标题", renameB);
    expect(container.querySelector("input")).toBeNull();
    expect(
      container.querySelector('[data-testid="thread-workspace-header-title"]')!
        .textContent,
    ).toBe("B 标题");
    expect(renameA).not.toHaveBeenCalled();
    expect(renameB).not.toHaveBeenCalled();

    const newInput = startEditing();
    expect(newInput.value).toBe("B 标题");
    changeText(newInput, "B 新草稿");
    act(() => {
      oldInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      oldInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(renameA).not.toHaveBeenCalled();
    expect(renameB).not.toHaveBeenCalled();
    expect(newInput.value).toBe("B 新草稿");
    act(() =>
      newInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(renameB).toHaveBeenCalledExactlyOnceWith("B 新草稿");
    expect(renameA).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("取消后 blur 不提交，后续 Enter 与 blur 只提交当前编辑一次", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRename = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        <AppShell>
          <AppShellHeader />
          <ThreadWorkspaceHeader
            sessionId="thread-1"
            title="当前标题"
            onRename={onRename}
          />
        </AppShell>,
      ),
    );
    const startEditing = () => {
      act(() =>
        (
          container.querySelector(
            '[data-testid="thread-workspace-header-title"] button',
          ) as HTMLButtonElement
        ).click(),
      );
      const input = container.querySelector<HTMLInputElement>("input")!;
      act(() => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "新标题");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return input;
    };
    const canceled = startEditing();
    act(() => {
      canceled.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      canceled.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onRename).not.toHaveBeenCalled();

    const current = startEditing();
    act(() => {
      current.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      current.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("新标题");
    act(() => root.unmount());
  });
});
