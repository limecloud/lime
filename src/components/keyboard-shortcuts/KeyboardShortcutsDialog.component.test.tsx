import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { registerCommand } from "@/lib/commands/registry";
import { useCommand } from "@/lib/commands/useCommand";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const releases: (() => void)[] = [];
beforeEach(async () => {
  await changeLimeLocale("zh-CN");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  for (const release of releases.splice(0)) release();
  document.body.innerHTML = "";
});

function Harness({
  enabled,
  handler,
}: {
  enabled: boolean;
  handler: () => void;
}) {
  useCommand({
    id: "searchSettings",
    titleKey: "commands.searchSettings.title",
    descriptionKey: "commands.searchSettings.description",
    section: "configure",
    bindings: ["CommandOrControl+F"],
    enabled,
    allowInInput: true,
    handler,
  });
  return <KeyboardShortcutsDialog open onOpenChange={() => {}} />;
}

describe("KeyboardShortcutsDialog", () => {
  it("序列按stroke分组，修饰键不会跨stroke合并", () => {
    releases.push(
      registerCommand({
        id: "sequence",
        titleKey: "commands.searchSettings.title",
        section: "thread",
        bindings: ["Control+K Control+S"],
        handler: vi.fn(),
      }),
    );
    act(() =>
      root.render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />),
    );
    const strokes = document.querySelectorAll(
      '[data-command-id="sequence"] [data-shortcut-stroke]',
    );
    expect(strokes).toHaveLength(2);
    expect(
      [...strokes[0].querySelectorAll("kbd")].map((node) => node.textContent),
    ).toEqual(["Ctrl", "K"]);
    expect(
      [...strokes[1].querySelectorAll("kbd")].map((node) => node.textContent),
    ).toEqual(["Ctrl", "S"]);
  });

  it("帮助弹窗保留注册快照的置顶顺序，不再单独按字母重排", () => {
    for (const id of ["openSideChat", "archiveThread", "newTask"])
      releases.push(
        registerCommand({
          id,
          titleKey: "commands.searchSettings.title",
          section: "thread",
          bindings: ["CommandOrControl+J"],
          handler: vi.fn(),
        }),
      );
    act(() =>
      root.render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />),
    );
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-command-id]")].map(
        (node) => node.dataset.commandId,
      ),
    ).toEqual(["newTask", "archiveThread", "openSideChat"]);
  });

  it("列表与真实 enabled handler 同步，无消费者命令不凭空出现", async () => {
    const handler = vi.fn();
    act(() => root.render(<Harness enabled handler={handler} />));
    expect(
      document.querySelector('[data-command-id="searchSettings"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Cmd+B");
    act(() => root.render(<Harness enabled={false} handler={handler} />));
    expect(
      document.querySelector('[data-command-id="searchSettings"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain("当前没有可用的快捷键");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("聚焦搜索，按说明筛选，清空后恢复当前分组", async () => {
    await changeLimeLocale("en-US");
    releases.push(
      registerCommand({
        id: "searchSettings",
        titleKey: "commands.searchSettings.title",
        descriptionKey: "commands.searchSettings.description",
        section: "configure",
        bindings: ["CommandOrControl+F"],
        handler: vi.fn(),
      }),
    );
    act(() =>
      root.render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />),
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search shortcuts"]',
    )!;
    expect(document.activeElement).toBe(input);
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const search = (value: string) =>
      act(() => {
        setValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    search("find an option");
    expect(
      document.querySelector('[data-command-id="searchSettings"]'),
    ).not.toBeNull();
    search("nonexistent");
    expect(document.body.textContent).toContain("No matching shortcuts");
    expect(
      document.querySelector('section[aria-label="Configure"]'),
    ).toBeNull();
    search("");
    expect(
      document.querySelector('section[aria-label="Configure"]'),
    ).not.toBeNull();
  });

  it("Escape 关闭后恢复传入的原焦点", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    function FocusHarness() {
      const [open, setOpen] = useState(true);
      return (
        <KeyboardShortcutsDialog
          open={open}
          onOpenChange={setOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            button.focus();
          }}
        />
      );
    }
    act(() => root.render(<FocusHarness />));
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 提供真实条目、分组及可访问名称",
    async (locale) => {
      await changeLimeLocale(locale);
      releases.push(
        registerCommand({
          id: "saveDocument",
          titleKey: "commands.saveDocument.title",
          section: "workspace",
          bindings: ["CommandOrControl+S"],
          handler: vi.fn(),
        }),
      );
      const t = getLimeI18n().getFixedT(locale, "navigation");
      act(() =>
        root.render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />),
      );
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain(t("help.keyboardShortcuts"));
      expect(dialog.textContent).toContain(t("commands.saveDocument.title"));
      expect(
        document.querySelector(`[aria-label="${t("help.searchShortcuts")}"]`),
      ).not.toBeNull();
      expect(dialog.textContent).not.toMatch(/help\.|commands\./);
    },
  );
});
