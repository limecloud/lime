import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  registerCommand,
  type CommandRegistration,
} from "@/lib/commands/registry";
import { CommandMenu } from "./CommandMenu";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let unregister: Array<() => void>;
let onOpenChange: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  unregister = [];
  onOpenChange = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const cleanup of unregister) cleanup();
  unregister = [];
  document.body.innerHTML = "";
});

function register(registration: CommandRegistration) {
  unregister.push(registerCommand(registration));
}

async function renderMenu() {
  await act(async () => {
    root.render(<CommandMenu open onOpenChange={onOpenChange} />);
    await Promise.resolve();
  });
}

function rows() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-command-id]"),
  );
}

function rowIds() {
  return rows().map((row) => row.dataset.commandId);
}

function selectedId() {
  return document
    .querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    ?.getAttribute("data-command-id");
}

function input() {
  return document.querySelector<HTMLInputElement>("[data-command-menu-input]")!;
}

function type(value: string) {
  const element = input();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(key: string) {
  input().dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("CommandMenu", () => {
  it("按 section 分组显示全部命令，无绑定命令仍然出现", async () => {
    register({
      id: "thread.forkChat",
      titleKey: "commands.forkChat.title",
      descriptionKey: "commands.forkChat.description",
      section: "thread",
      bindings: [],
      handler: vi.fn(),
    });
    register({
      id: "navigation.newChat",
      titleKey: "commands.newChat.title",
      descriptionKey: "commands.newChat.description",
      section: "navigation",
      bindings: ["CommandOrControl+N"],
      handler: vi.fn(),
    });
    register({
      id: "app.openCommandMenu",
      titleKey: "commands.openCommandMenu.title",
      descriptionKey: "commands.openCommandMenu.description",
      section: "app",
      bindings: ["CommandOrControl+K", "CommandOrControl+Shift+P"],
      handler: vi.fn(),
    });

    await renderMenu();

    expect(
      Array.from(document.querySelectorAll('[role="group"]')).map(
        (group) => group.firstElementChild?.textContent,
      ),
    ).toEqual(["Chat", "Navigation", "App"]);
    expect(rowIds()).toEqual([
      "thread.forkChat",
      "navigation.newChat",
      "app.openCommandMenu",
    ]);

    const forkRow = document.querySelector<HTMLElement>(
      '[data-command-id="thread.forkChat"]',
    )!;
    expect(forkRow.querySelectorAll("kbd")).toHaveLength(0);
    expect(
      document
        .querySelector<HTMLElement>('[data-command-id="navigation.newChat"]')!
        .querySelectorAll("kbd").length,
    ).toBeGreaterThan(0);
  });

  it("按标题和描述过滤，空查询恢复，无结果显示空状态", async () => {
    register({
      id: "thread.archiveChat",
      titleKey: "commands.archiveChat.title",
      descriptionKey: "commands.archiveChat.description",
      section: "thread",
      bindings: [],
      handler: vi.fn(),
    });
    register({
      id: "thread.forkChat",
      titleKey: "commands.forkChat.title",
      descriptionKey: "commands.forkChat.description",
      section: "thread",
      bindings: [],
      handler: vi.fn(),
    });

    await renderMenu();
    expect(rowIds()).toEqual(["thread.archiveChat", "thread.forkChat"]);

    await act(async () => {
      type("branch");
      await Promise.resolve();
    });
    expect(rowIds()).toEqual(["thread.forkChat"]);

    await act(async () => {
      type("archive");
      await Promise.resolve();
    });
    expect(rowIds()).toEqual(["thread.archiveChat"]);

    await act(async () => {
      type("no-such-command");
      await Promise.resolve();
    });
    expect(rowIds()).toEqual([]);
    expect(document.body.textContent).toContain("No matching commands");

    await act(async () => {
      type("");
      await Promise.resolve();
    });
    expect(rowIds()).toEqual(["thread.archiveChat", "thread.forkChat"]);
  });

  it("上下键循环选择，Enter 只执行当前命令并关闭", async () => {
    const archive = vi.fn();
    const fork = vi.fn();
    const newChat = vi.fn();
    register({
      id: "thread.archiveChat",
      titleKey: "commands.archiveChat.title",
      descriptionKey: "commands.archiveChat.description",
      section: "thread",
      bindings: [],
      handler: archive,
    });
    register({
      id: "thread.forkChat",
      titleKey: "commands.forkChat.title",
      descriptionKey: "commands.forkChat.description",
      section: "thread",
      bindings: [],
      handler: fork,
    });
    register({
      id: "navigation.newChat",
      titleKey: "commands.newChat.title",
      descriptionKey: "commands.newChat.description",
      section: "navigation",
      bindings: [],
      handler: newChat,
    });

    await renderMenu();
    expect(selectedId()).toBe("thread.archiveChat");

    await act(async () => press("ArrowDown"));
    expect(selectedId()).toBe("thread.forkChat");
    await act(async () => press("ArrowUp"));
    expect(selectedId()).toBe("thread.archiveChat");
    await act(async () => press("ArrowUp"));
    expect(selectedId()).toBe("navigation.newChat");
    await act(async () => press("ArrowDown"));
    expect(selectedId()).toBe("thread.archiveChat");

    await act(async () => press("Enter"));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(fork).not.toHaveBeenCalled();
    expect(newChat).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("点击命令执行 handler 并关闭，Escape 关闭", async () => {
    const fork = vi.fn();
    register({
      id: "thread.forkChat",
      titleKey: "commands.forkChat.title",
      descriptionKey: "commands.forkChat.description",
      section: "thread",
      bindings: [],
      handler: fork,
    });

    await renderMenu();
    await act(async () => {
      document
        .querySelector<HTMLElement>('[data-command-id="thread.forkChat"]')!
        .click();
    });
    expect(fork).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    await act(async () => press("Escape"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
