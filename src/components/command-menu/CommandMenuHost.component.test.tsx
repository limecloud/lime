import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, AppShellContent } from "@/components/app-shell/AppShell";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  getRegisteredCommands,
  registerCommand,
} from "@/lib/commands/registry";

vi.mock("@/lib/commands/preferences", () => ({
  observeCommandBindings: () => () => {},
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let unregister: Array<() => void>;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  unregister = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const cleanup of unregister) cleanup();
  unregister = [];
  document.body.innerHTML = "";
});

function isMac() {
  return /Mac/i.test(navigator.platform);
}

async function pressShortcut(key: string, shiftKey = false) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        metaKey: isMac(),
        ctrlKey: !isMac(),
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

function input() {
  return document.querySelector<HTMLInputElement>("[data-command-menu-input]")!;
}

async function type(value: string) {
  const element = input();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function pressMenuKey(key: string) {
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
  });
}

function renderShell() {
  act(() =>
    root.render(
      <AppShell>
        <AppShellContent pageSurface>Thread</AppShellContent>
      </AppShell>,
    ),
  );
}

describe("AppShell CommandMenuHost", () => {
  it("只在 AppShell 注册一个命令，⌘K 与 ⇧⌘P 打开并再次 ⌘K 或 Escape 关闭", async () => {
    renderShell();

    const menuCommands = getRegisteredCommands().filter(
      (command) => command.id === "app.openCommandMenu",
    );
    expect(menuCommands).toHaveLength(1);
    expect(menuCommands[0].bindings).toEqual([
      "CommandOrControl+K",
      "CommandOrControl+Shift+P",
    ]);
    expect(document.querySelector("[data-command-menu]")).toBeNull();

    await pressShortcut("k");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).not.toBeNull(),
    );
    expect(document.querySelectorAll("[data-command-menu]")).toHaveLength(1);
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));

    await pressShortcut("k");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).toBeNull(),
    );

    await pressShortcut("P", true);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).not.toBeNull(),
    );

    await pressMenuKey("Escape");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).toBeNull(),
    );
  });

  it("搜索命令后 Enter 执行 handler 并关闭，未绑定命令也可执行", async () => {
    const handler = vi.fn();
    unregister.push(
      registerCommand({
        id: "navigation.newChat",
        titleKey: "commands.newChat.title",
        descriptionKey: "commands.newChat.description",
        section: "navigation",
        bindings: [],
        handler,
      }),
    );
    renderShell();

    await pressShortcut("k");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).not.toBeNull(),
    );

    await type("new chat");
    expect(
      document.querySelector('[data-command-id="navigation.newChat"]'),
    ).not.toBeNull();
    await pressMenuKey("Enter");

    expect(handler).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).toBeNull(),
    );
  });

  it("在输入框聚焦时仍可打开，关闭后恢复原焦点", async () => {
    renderShell();
    const composer = document.createElement("input");
    document.body.append(composer);
    act(() => composer.focus());

    await pressShortcut("k");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).not.toBeNull(),
    );

    await pressMenuKey("Escape");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-command-menu]")).toBeNull(),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(composer));
  });

  it("卸载 AppShell 后撤销命令与快捷键", async () => {
    renderShell();
    expect(
      getRegisteredCommands().some(
        (command) => command.id === "app.openCommandMenu",
      ),
    ).toBe(true);

    await act(async () => root.render(null));
    expect(getRegisteredCommands()).toEqual([]);

    await pressShortcut("k");
    expect(document.querySelector("[data-command-menu]")).toBeNull();
  });
});
