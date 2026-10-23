import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";

const {
  mockListAgentRuntimeSessions,
  mockUnarchiveAgentRuntimeSession,
  mockToast,
} = vi.hoisted(() => ({
  mockListAgentRuntimeSessions: vi.fn(),
  mockUnarchiveAgentRuntimeSession: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  listAgentRuntimeSessions: mockListAgentRuntimeSessions,
  unarchiveAgentRuntimeSession: mockUnarchiveAgentRuntimeSession,
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
  mockUnarchiveAgentRuntimeSession.mockResolvedValue(undefined);
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
      limit: 80,
    });
    expect(container.querySelector("h1")?.textContent).toBe("Archived chats");
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
});
