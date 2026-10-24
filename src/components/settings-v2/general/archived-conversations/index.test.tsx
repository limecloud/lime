import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";

const {
  mockListAgentRuntimeSessions,
  mockListProjectDirectory,
  mockUnarchiveAgentRuntimeSession,
  mockDeleteAgentRuntimeSession,
  mockToast,
} = vi.hoisted(() => ({
  mockListAgentRuntimeSessions: vi.fn(),
  mockListProjectDirectory: vi.fn(),
  mockUnarchiveAgentRuntimeSession: vi.fn(),
  mockDeleteAgentRuntimeSession: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  listAgentRuntimeSessions: mockListAgentRuntimeSessions,
  unarchiveAgentRuntimeSession: mockUnarchiveAgentRuntimeSession,
  deleteAgentRuntimeSession: mockDeleteAgentRuntimeSession,
}));

vi.mock("@/lib/api/projectDirectory", () => ({
  listProjectDirectory: mockListProjectDirectory,
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

import { ArchivedConversationsSettings } from "./index";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ArchivedConversationsSettings />);
  });

  mounted.push({ container, root });
  return container;
}

async function flushEffects(times = 4) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  await changeLimeLocale("zh-CN");
  mockListAgentRuntimeSessions.mockResolvedValue([
    {
      id: "session-archived",
      name: "归档会话",
      created_at: 1713000000,
      updated_at: 1713000600,
      archived_at: 1713003600,
      workspace_id: "project-1",
      working_dir: "/repo/project-1",
    },
    {
      id: "session-active",
      name: "普通会话",
      created_at: 1714000000,
      updated_at: 1714000600,
      archived_at: null,
      workspace_id: null,
    },
  ]);
  mockListProjectDirectory.mockResolvedValue([
    {
      id: "project-1",
      name: "project-1",
      roots: [{ path: "/repo/project-1" }],
    },
  ]);
  mockUnarchiveAgentRuntimeSession.mockResolvedValue(undefined);
  mockDeleteAgentRuntimeSession.mockResolvedValue(undefined);
});

afterEach(async () => {
  while (mounted.length > 0) {
    const current = mounted.pop();
    if (!current) {
      break;
    }

    act(() => {
      current.root.unmount();
    });
    current.container.remove();
  }

  vi.clearAllMocks();
  vi.restoreAllMocks();
  await changeLimeLocale("zh-CN");
});

describe("ArchivedConversationsSettings", () => {
  it("加载归档列表时应暴露稳定的 busy 状态", () => {
    mockListAgentRuntimeSessions.mockReturnValue(new Promise(() => {}));

    const container = renderPage();
    const loading = container.querySelector(
      '[data-testid="settings-archived-conversations-loading"]',
    );

    expect(loading).toBeInstanceOf(HTMLElement);
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.getAttribute("aria-busy")).toBe("true");
  });

  it("没有归档会话时应展示稳定空态", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([]);

    const container = renderPage();
    await flushEffects();

    const empty = container.querySelector(
      '[data-testid="settings-archived-conversations-empty"]',
    );
    expect(empty).toBeInstanceOf(HTMLElement);
    expect(empty?.getAttribute("role")).toBe("status");
    expect(empty?.textContent).toContain("暂无已归档对话");
  });

  it("归档列表读取失败时应展示可重试错误态", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockListAgentRuntimeSessions.mockRejectedValue(
      new Error("fixture archived list unavailable"),
    );

    const container = renderPage();
    await flushEffects();

    const error = container.querySelector(
      '[data-testid="settings-archived-conversations-error"]',
    );
    expect(error).toBeInstanceOf(HTMLElement);
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent).toContain("加载已归档对话失败");
    expect(
      container.querySelector(
        '[data-testid="settings-archived-conversations-retry"]',
      ),
    ).toBeInstanceOf(HTMLButtonElement);
    expect(consoleError).toHaveBeenCalled();
  });

  it("应从 App Server current 会话列表读取归档对话", async () => {
    const container = renderPage();
    await flushEffects();

    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      archivedOnly: true,
    });
    expect(container.querySelector("h1")?.textContent).toBe("已归档的聊天");
    expect(container.textContent).toContain("归档会话");
    expect(container.textContent).toContain("project-1");
    expect(container.textContent).not.toContain("普通会话");
  });

  it("恢复归档对话后应从设置列表移除", async () => {
    const container = renderPage();
    await flushEffects();

    const restoreButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("恢复"),
    );
    expect(restoreButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      restoreButton?.click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockUnarchiveAgentRuntimeSession).toHaveBeenCalledWith(
      "session-archived",
    );
    expect(mockToast.success).toHaveBeenCalledWith("已恢复对话");
    expect(container.textContent).not.toContain("归档会话");
  });

  async function openDelete(container: HTMLElement) {
    await flushEffects();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-conversation-delete"]',
        )!
        .click();
    });
    await flushEffects();
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
  }

  it("打开确认和取消不删除，取消后焦点返回原行", async () => {
    const container = renderPage();
    const dialog = await openDelete(container);
    expect(dialog.textContent).toContain("永久删除");
    expect(mockDeleteAgentRuntimeSession).not.toHaveBeenCalled();
    await act(async () => {
      Array.from(dialog.querySelectorAll("button"))
        .find((x) => x.textContent === "取消")!
        .click();
    });
    await flushEffects();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mockDeleteAgentRuntimeSession).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        container.querySelector(
          '[data-testid="settings-archived-conversation-delete"]',
        ),
      ),
    );
    expect(container.textContent).toContain("归档会话");
  });

  it("确认删除只提交一次，成功后移除同一聊天并恢复页面焦点", async () => {
    let finish!: () => void;
    mockDeleteAgentRuntimeSession.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const container = renderPage();
    const dialog = await openDelete(container);
    const form = dialog.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(mockDeleteAgentRuntimeSession).toHaveBeenCalledTimes(1);
    expect(mockDeleteAgentRuntimeSession).toHaveBeenCalledWith(
      "session-archived",
    );
    expect(container.textContent).toContain("归档会话");
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(
      Array.from(dialog.querySelectorAll("button")).every((x) => x.disabled),
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="settings-archived-conversation-restore"]',
      )!.disabled,
    ).toBe(true);
    await act(async () => {
      finish();
    });
    await flushEffects();
    expect(container.textContent).not.toContain("归档会话");
    expect(mockToast.success).toHaveBeenCalledWith("已删除聊天");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(container.firstElementChild),
    );
  });

  it("删除失败保留聊天和确认框，再次确认可以重试", async () => {
    mockDeleteAgentRuntimeSession.mockRejectedValueOnce(
      new Error("delete denied"),
    );
    const container = renderPage();
    await openDelete(container);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-confirm-delete"]',
        )!
        .click();
    });
    await flushEffects();
    expect(container.textContent).toContain("归档会话");
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
    ).toContain("删除失败");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-confirm-delete"]',
        )!
        .click();
    });
    await flushEffects();
    expect(mockDeleteAgentRuntimeSession).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("归档会话");
  });

  it("恢复请求期间锁定其余操作并拒绝同一 tick 重复恢复", async () => {
    let finish!: () => void;
    mockUnarchiveAgentRuntimeSession.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const container = renderPage();
    await flushEffects();
    const restore = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-archived-conversation-restore"]',
    )!;
    await act(async () => {
      restore.click();
      restore.click();
    });
    expect(mockUnarchiveAgentRuntimeSession).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="settings-archived-conversation-delete"]',
      )!.disabled,
    ).toBe(true);
    await act(async () => {
      finish();
    });
  });

  it("语言变更产生的新读取拒绝旧请求晚结果", async () => {
    let finish!: (value: unknown[]) => void;
    mockListAgentRuntimeSessions
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValueOnce([]);
    const container = renderPage();
    await act(async () => {
      await changeLimeLocale("en-US");
    });
    await flushEffects();
    await act(async () => {
      finish([
        {
          id: "late",
          name: "stale conversation",
          archived_at: 1713003600,
          updated_at: 1713003600,
          created_at: 1713000000,
        },
      ]);
    });
    await flushEffects();
    expect(container.textContent).not.toContain("stale conversation");
    expect(
      container.querySelector(
        '[data-testid="settings-archived-conversations-empty"]',
      ),
    ).not.toBeNull();
  });

  function archived(id: string, workspace?: string) {
    return {
      id,
      name: id,
      created_at: 10,
      updated_at: 20,
      archived_at: 30,
      workspace_id: workspace,
    };
  }

  async function search(container: HTMLElement, value: string) {
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-archived-search"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushEffects();
  }

  it("完整列表能搜索第80条之后的聊天，空匹配与清除可恢复", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue(
      Array.from({ length: 105 }, (_, index) => archived(`聊天编号${index}`)),
    );
    const container = renderPage();
    await flushEffects();
    expect(
      container.querySelectorAll(
        '[data-testid="settings-archived-conversation"]',
      ),
    ).toHaveLength(105);
    expect(mockListAgentRuntimeSessions).toHaveBeenCalledWith({
      archivedOnly: true,
    });
    await search(container, "聊天编号104");
    expect(container.textContent).toContain("聊天编号104");
    await search(container, "zzzzzzzzzzzz");
    expect(
      container.querySelector('[data-testid="settings-archived-no-results"]'),
    ).not.toBeNull();
    await search(container, "");
    expect(
      container.querySelectorAll(
        '[data-testid="settings-archived-conversation"]',
      ),
    ).toHaveLength(105);
  });

  it("删除全部确认覆盖完整归档而非搜索结果，部分失败仅重试失败身份", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      archived("Alpha"),
      archived("Beta"),
    ]);
    mockDeleteAgentRuntimeSession.mockImplementation(async (id) => {
      if (id === "Beta") throw new Error("denied");
    });
    const container = renderPage();
    await flushEffects();
    await search(container, "Alpha");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-delete-all"]',
        )!
        .click(),
    );
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "2",
    );
    expect(mockDeleteAgentRuntimeSession).not.toHaveBeenCalled();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-confirm-delete"]',
        )!
        .click(),
    );
    await flushEffects();
    expect(mockDeleteAgentRuntimeSession.mock.calls.map(([id]) => id)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
    ).toContain("1");
    mockDeleteAgentRuntimeSession.mockResolvedValue(undefined);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-confirm-delete"]',
        )!
        .click(),
    );
    await flushEffects();
    expect(mockDeleteAgentRuntimeSession.mock.calls.map(([id]) => id)).toEqual([
      "Alpha",
      "Beta",
      "Beta",
    ]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="settings-archived-conversations-empty"]',
      ),
    ).not.toBeNull();
  });

  it("项目菜单只删除该组中的聊天，取消保持零写入", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      archived("Project chat", "project-1"),
      archived("Standalone"),
    ]);
    const container = renderPage();
    await flushEffects();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="menu"][aria-label="项目操作"]',
    )!;
    await act(async () =>
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    await flushEffects();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-delete-project"]',
        )!
        .click(),
    );
    await flushEffects();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "project-1",
    );
    expect(mockDeleteAgentRuntimeSession).not.toHaveBeenCalled();
    const projectDialog =
      document.querySelector<HTMLElement>('[role="dialog"]')!;
    await vi.waitFor(() =>
      expect(projectDialog.contains(document.activeElement)).toBe(true),
    );
    await act(async () =>
      Array.from(projectDialog.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "取消")!
        .click(),
    );
    await flushEffects();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mockDeleteAgentRuntimeSession).not.toHaveBeenCalled();
    await act(async () =>
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    await flushEffects();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-delete-project"]',
        )!
        .click(),
    );
    await flushEffects();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="settings-archived-confirm-delete"]',
        )!
        .click(),
    );
    await flushEffects();
    expect(mockDeleteAgentRuntimeSession.mock.calls.map(([id]) => id)).toEqual([
      "Project chat",
    ]);
    expect(container.textContent).toContain("Standalone");
  });

  it("排序和项目菜单改变真实行投影，Escape清空搜索并保留输入焦点", async () => {
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        ...archived("Old project", "project-1"),
        created_at: 100,
        updated_at: 200,
        working_dir: "/repo/project-1",
      },
      {
        ...archived("New chat"),
        created_at: 300,
        updated_at: 150,
        working_dir: "C:\\standalone-repository",
      },
    ]);
    const container = renderPage();
    await flushEffects();
    const choose = async (id: string, label: string) => {
      const trigger = container.querySelector<HTMLButtonElement>(
        `button[aria-labelledby="${id}-label ${id}-value"]`,
      )!;
      await act(async () =>
        trigger.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
        ),
      );
      await flushEffects();
      await act(async () =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
        )
          .find((item) => item.textContent === label)!
          .click(),
      );
      await flushEffects();
    };
    const rows = () =>
      Array.from(
        container.querySelectorAll(
          '[data-testid="settings-archived-conversation"]',
        ),
      ).map((item) => item.getAttribute("data-session-id"));
    expect(rows()).toEqual(["Old project", "New chat"]);
    const descriptions = () =>
      Array.from(container.querySelectorAll(".settings-row-description")).map(
        (node) => node.textContent,
      );
    expect(descriptions().join(" ")).not.toContain("project-1");
    expect(descriptions().join(" ")).not.toContain("standalone-repository");
    await choose("archived-sort", "创建时间");
    expect(rows()).toEqual(["New chat", "Old project"]);
    await choose("archived-project", "project-1");
    expect(rows()).toEqual(["Old project"]);
    expect(descriptions()[0]).toMatch(/ • project-1$/);
    expect(container.querySelector("section > header")).toBeNull();
    await search(container, "zzzzzzzz");
    const input = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    input.focus();
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await flushEffects();
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(rows()).toEqual(["Old project"]);
    await choose("archived-project", "聊天");
    expect(rows()).toEqual(["New chat"]);
    expect(descriptions().join(" ")).not.toContain("standalone-repository");
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 批量确认、数量和搜索控件文案完整",
    async (locale) => {
      await changeLimeLocale(locale);
      const container = renderPage();
      await flushEffects();
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="settings-archived-delete-all"]',
          )!
          .click(),
      );
      await flushEffects();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).not.toContain(
        "settings.archivedConversations.",
      );
      expect(dialog.querySelector("p")?.textContent).toContain("1");
      expect(
        container
          .querySelector('input[type="search"]')
          ?.getAttribute("placeholder"),
      ).not.toContain("settings.");
      expect(mockDeleteAgentRuntimeSession).not.toHaveBeenCalled();
    },
  );

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 删除确认和操作文案完整",
    async (locale) => {
      await changeLimeLocale(locale);
      const container = renderPage();
      const dialog = await openDelete(container);
      expect(dialog.textContent).not.toContain(
        "settings.archivedConversations.",
      );
      expect(dialog.querySelector("h2")?.textContent?.length).toBeGreaterThan(
        0,
      );
      expect(
        dialog.querySelector('[data-testid="settings-archived-confirm-delete"]')
          ?.textContent?.length,
      ).toBeGreaterThan(0);
      expect(
        container
          .querySelector(
            '[data-testid="settings-archived-conversation-delete"]',
          )
          ?.getAttribute("aria-label"),
      ).toContain("归档会话");
    },
  );
});
