import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindingIdentity } from "@/lib/commands/bindings";
import { getRegisteredCommands, runCommand } from "@/lib/commands/registry";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import {
  ensureConversationTab,
} from "@/lib/conversationTabs";
import {
  subscribeWorkspaceReviewTabRequest,
  type WorkspaceReviewTabAction,
} from "@/lib/workspaceReviewTabEvents";
import { NavigationShortcutCommands } from "./NavigationShortcutCommands";

const sessionMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));
vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  createAgentRuntimeSession: sessionMocks.create,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let reviewActions: WorkspaceReviewTabAction[];
let unsubscribeReview: () => void;
const navigate = vi.fn();

function command(id: string) {
  const found = getRegisteredCommands().find((item) => item.id === id);
  expect(found, `command ${id}`).toBeDefined();
  return found!;
}

function key(options: ConstructorParameters<typeof KeyboardEvent>[1]) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

beforeEach(() => {
  navigate.mockReset();
  sessionMocks.create.mockReset();
  reviewActions = [];
  unsubscribeReview = subscribeWorkspaceReviewTabRequest((action) => {
    reviewActions.push(action);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<NavigationShortcutCommands onNavigate={navigate} />));
});
afterEach(() => {
  act(() => root.unmount());
  unsubscribeReview();
  container.remove();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("NavigationShortcutCommands Codex 对齐命令", () => {
  it("注册新增命令，保留既有键位且没有重复 ID 或同一命令内重复键位", () => {
    const commands = getRegisteredCommands();
    const ids = commands.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const platform = resolveHotkeyPlatform(navigator);
    for (const item of commands) {
      const identities = item.bindings.map((binding) =>
        bindingIdentity(binding, platform),
      );
      expect(new Set(identities).size).toBe(identities.length);
    }

    expect(command("navigation.newChat").bindings).toEqual([
      "CommandOrControl+N",
      "CommandOrControl+Shift+O",
    ]);
    expect(command("panels.reviewTab").bindings).toEqual([
      "CommandOrControl+Shift+G",
    ]);
    expect(command("panels.toggleChangesPanel")).toMatchObject({
      section: "panels",
      bindings: ["CommandOrControl+Alt+B"],
    });
    expect(command("panels.closeChangesPanel")).toMatchObject({
      section: "panels",
      bindings: [],
    });
    expect(command("navigation.focusSidebar")).toMatchObject({
      section: "navigation",
      bindings: [],
    });
    expect(command("app.copyWorkingDirectory").bindings).toEqual([
      "CommandOrControl+Shift+C",
    ]);
    expect(command("app.copyConversationLink").bindings).toEqual([
      "CommandOrControl+Alt+L",
    ]);
    expect(command("app.openSkills")).toMatchObject({
      section: "skills",
      bindings: [],
    });
    expect(command("navigation.focusComposer").bindings).toEqual(["Alt+L"]);
    expect(command("navigation.toggleSidebar").bindings).toEqual([
      "CommandOrControl+Shift+S",
      "CommandOrControl+B",
    ]);
    expect(command("app.openFolder").bindings).toEqual(["CommandOrControl+O"]);
    expect(command("thread.find").bindings).toEqual(["CommandOrControl+F"]);
    expect(command("app.toggleSideChat").bindings).toEqual([]);
    expect(command("app.focusSideChat").bindings).toEqual([
      "CommandOrControl+Alt+S",
    ]);
  });

  it("复制会话 Deep Link 使用 lime://session", async () => {
    ensureConversationTab("session-deeplink", "Deep");
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    expect(runCommand("app.copyConversationDeepLink")).toBe(true);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(
      "lime://session?sessionId=session-deeplink",
    );
  });

  it("临时聊天使用 ephemeral 创建并导航到新会话", async () => {
    sessionMocks.create.mockResolvedValue("temp-session-1");
    await act(async () => {
      expect(runCommand("navigation.temporaryChat")).toBe(true);
      await Promise.resolve();
    });
    expect(sessionMocks.create).toHaveBeenCalledWith(
      undefined,
      expect.any(String),
      undefined,
      { ephemeral: true },
    );
    expect(navigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        initialSessionId: "temp-session-1",
        initialSessionName: expect.any(String),
      }),
    );
  });

  it("Changes 打开、切换、关闭三个命令派发同一真实事件源", () => {
    expect(runCommand("panels.reviewTab")).toBe(true);
    expect(runCommand("panels.toggleChangesPanel")).toBe(true);
    expect(runCommand("panels.closeChangesPanel")).toBe(true);
    expect(reviewActions).toEqual(["open", "toggle", "close"]);
  });

  it("CommandOrControl+Alt+B 派发 Changes 切换而不是只调用空 handler", () => {
    key({ key: "b", ctrlKey: true, altKey: true });
    expect(reviewActions).toEqual(["toggle"]);
  });

  it("复制工作目录保留现有事件，复制会话链接写入当前 URL", () => {
    const copied: string[] = [];
    const copyWorkingDirectory = () => copied.push("cwd");
    window.addEventListener(
      "lime:copy-working-directory",
      copyWorkingDirectory,
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      key({ key: "c", ctrlKey: true, shiftKey: true });
      expect(copied).toEqual(["cwd"]);
      key({ key: "l", ctrlKey: true, altKey: true });
      expect(writeText).toHaveBeenCalledWith(window.location.href);
    } finally {
      window.removeEventListener(
        "lime:copy-working-directory",
        copyWorkingDirectory,
      );
      delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
    }
  });

  it("聚焦侧栏命令把键盘焦点移到真实侧栏搜索按钮", () => {
    const target = document.createElement("button");
    target.dataset.testid = "app-sidebar-search-button";
    document.body.append(target);
    expect(runCommand("navigation.focusSidebar")).toBe(true);
    expect(document.activeElement).toBe(target);
  });

  it("技能命令进入现有 Skills 页面", () => {
    expect(runCommand("app.openSkills")).toBe(true);
    expect(navigate).toHaveBeenCalledWith("skills");
  });

  it("打开文件夹快捷键派发 lime:open-folder", () => {
    const listener = vi.fn();
    window.addEventListener("lime:open-folder", listener);
    try {
      expect(runCommand("app.openFolder")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("lime:open-folder", listener);
    }
  });

  it("新建项目命令派发 lime:new-project", () => {
    const listener = vi.fn();
    window.addEventListener("lime:new-project", listener);
    try {
      expect(runCommand("app.newProject")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("lime:new-project", listener);
    }
  });

  it("侧栏快捷键派发 lime:toggle-sidebar", () => {
    const listener = vi.fn();
    window.addEventListener("lime:toggle-sidebar", listener);
    try {
      expect(runCommand("navigation.toggleSidebar")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("lime:toggle-sidebar", listener);
    }
  });

  it("Alt+L 聚焦主 Composer", () => {
    const container = document.createElement("div");
    container.dataset.testid = "inputbar-core-container";
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.dataset.testid = "composer-editor";
    container.append(editor);
    document.body.append(container);
    try {
      expect(runCommand("navigation.focusComposer")).toBe(true);
      expect(document.activeElement).toBe(editor);
    } finally {
      container.remove();
    }
  });

  it("Cmd+F 打开会话内查找", () => {
    const listener = vi.fn();
    window.addEventListener("lime:open-thread-find", listener);
    try {
      expect(runCommand("thread.find")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("lime:open-thread-find", listener);
    }
  });
});
