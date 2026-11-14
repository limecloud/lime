import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindingIdentity } from "@/lib/commands/bindings";
import { getRegisteredCommands, runCommand } from "@/lib/commands/registry";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import {
  subscribeWorkspaceReviewTabRequest,
  type WorkspaceReviewTabAction,
} from "@/lib/workspaceReviewTabEvents";
import { NavigationShortcutCommands } from "./NavigationShortcutCommands";

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
});
