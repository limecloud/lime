import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { invalidateAppConfigCache } from "@/lib/api/appConfig";
import { observeCommandBindings } from "@/lib/commands/preferences";
import {
  getRegisteredCommands,
  registerCommand,
} from "@/lib/commands/registry";
import { KeyboardShortcutsSettings } from "./index";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));
let root: Root,
  container: HTMLDivElement,
  persisted: Record<string, unknown>,
  version: number;
let stop: () => void, releases: (() => void)[];
let rejected: boolean, pendingWrite: Promise<void> | null;
const handler = vi.fn();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await changeLimeLocale("en-US");
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("");
  invalidateAppConfigCache();
  window.localStorage.clear();
  persisted = {
    default_provider: "openai",
    desktop: { "open-link-in-target-preference": "external-browser" },
    tui: { animations: false },
  };
  version = 1;
  rejected = false;
  pendingWrite = null;
  handler.mockReset();
  request.mockReset().mockImplementation(async (method, params) => {
    if (method === "config/read")
      return {
        result: {
          config: structuredClone(persisted),
          layers: [{ version: `v${version}` }],
        },
      };
    if (method !== "config/batchWrite") throw Error(`Unexpected ${method}`);
    if (pendingWrite) await pendingWrite;
    if (rejected) throw Error("fixture rejected");
    expect(params.expectedVersion).toBe(`v${version}`);
    for (const edit of params.edits)
      persisted[edit.keyPath] = structuredClone(edit.value);
    version += 1;
    return {
      result: {
        status: "ok",
        version: `v${version}`,
        filePath: "/fixture/config.yaml",
      },
    };
  });
  releases = [
    registerCommand({
      id: "searchSettings",
      titleKey: "commands.searchSettings.title",
      descriptionKey: "commands.searchSettings.description",
      section: "configure",
      bindings: ["CommandOrControl+F"],
      handler,
      allowInInput: true,
    }),
    registerCommand({
      id: "showKeyboardShortcuts",
      titleKey: "commands.showKeyboardShortcuts.title",
      section: "app",
      bindings: ["CommandOrControl+/"],
      handler: vi.fn(),
      allowInInput: true,
    }),
  ];
  stop = observeCommandBindings();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<KeyboardShortcutsSettings />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  stop();
  releases.forEach((release) => release());
  container.remove();
  invalidateAppConfigCache();
  vi.restoreAllMocks();
  await changeLimeLocale("zh-CN");
});
const row = () =>
  container.querySelector<HTMLElement>('[data-command-id="searchSettings"]')!;
const writes = () =>
  request.mock.calls.filter(([method]) => method === "config/batchWrite");
async function key(target: EventTarget, key: string, extra = {}) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  });
}
async function edit() {
  await act(async () =>
    row().querySelector<HTMLButtonElement>("[data-binding-button]")!.click(),
  );
  return row().querySelector<HTMLInputElement>("input")!;
}
async function menu(label: string) {
  await key(row().querySelector('[aria-haspopup="menu"]')!, "ArrowDown");
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === label)!
      .click();
  });
}

it("改绑后同一handler只接受新键，canonical配置保存且其他偏好不变", async () => {
  const input = await edit();
  await key(input, "j", { ctrlKey: true });
  expect(writes()).toHaveLength(1);
  expect(persisted.desktop).toMatchObject({
    "keyboard-shortcuts": { searchSettings: ["Control+J"] },
    "open-link-in-target-preference": "external-browser",
  });
  expect(persisted.tui).toEqual({ animations: false });
  await key(window, "f", { ctrlKey: true });
  expect(handler).not.toHaveBeenCalled();
  await key(window, "j", { ctrlKey: true });
  expect(handler).toHaveBeenCalledOnce();
  expect(
    getRegisteredCommands().find(({ id }) => id === "searchSettings")?.bindings,
  ).toEqual(["Control+J"]);
});

it("捕获冲突不保存或执行，Escape取消并恢复焦点", async () => {
  const input = await edit();
  await key(input, "/", { ctrlKey: true });
  expect(writes()).toHaveLength(0);
  expect(row().textContent).toContain(
    "Already used by Show keyboard shortcuts",
  );
  expect(handler).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  await key(input, "Escape");
  expect(row().querySelector("input")).toBeNull();
  expect(document.activeElement).toBe(
    row().querySelector("[data-binding-button]"),
  );
});

it("IME、修饰键、重复事件不写配置，Tab退出捕获", async () => {
  const input = await edit();
  await key(input, "Control");
  await key(input, "j", { ctrlKey: true, isComposing: true });
  await key(input, "j", { ctrlKey: true, repeat: true });
  expect(writes()).toHaveLength(0);
  await key(input, "Tab");
  expect(row().querySelector("input")).toBeNull();
});

it("保存失败保留旧有效键与捕获输入，随后可重试", async () => {
  rejected = true;
  const input = await edit();
  await key(input, "j", { ctrlKey: true });
  expect(row().querySelector("[role=alert]")).not.toBeNull();
  expect(getRegisteredCommands()[0].bindings).toEqual(["CommandOrControl+F"]);
  expect(row().querySelector("input")).toBe(input);
  rejected = false;
  await key(input, "j", { ctrlKey: true });
  expect(row().querySelector("input")).toBeNull();
  expect(getRegisteredCommands()[0].bindings).toEqual(["Control+J"]);
});

it("清除解除实际按键但保留可恢复行，单项恢复使用默认键", async () => {
  await menu("Clear shortcut");
  expect(row()).not.toBeNull();
  expect(row().textContent).toContain("Unassigned");
  await key(window, "f", { ctrlKey: true });
  expect(handler).not.toHaveBeenCalled();
  await menu("Restore defaults");
  await key(window, "f", { ctrlKey: true });
  expect(handler).toHaveBeenCalledOnce();
  expect(
    (persisted.desktop as Record<string, unknown>)["keyboard-shortcuts"],
  ).toEqual({});
});

it("按键搜索不执行命令，Escape恢复文字模式和完整列表", async () => {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Search by keystrokes"]')!
      .click(),
  );
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Keystroke search capture"]',
  )!;
  await key(input, "f", { ctrlKey: true });
  expect(handler).not.toHaveBeenCalled();
  expect(container.querySelectorAll("[data-command-id]")).toHaveLength(1);
  expect(input.value).toBe("Ctrl F");
  await key(input, "Escape");
  expect(
    container.querySelector('[aria-label="Search shortcuts"]'),
  ).not.toBeNull();
  expect(container.querySelectorAll("[data-command-id]")).toHaveLength(2);
});

it("菜单追加的第二键位获得焦点并执行同一handler，重复绑定被拒绝", async () => {
  await menu("Add shortcut");
  await vi.waitFor(() => expect(row().querySelector("input")).not.toBeNull());
  const input = row().querySelector<HTMLInputElement>("input")!;
  expect(input).not.toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(input));
  await key(input, "j", { ctrlKey: true });
  expect(getRegisteredCommands()[0].bindings).toEqual([
    "CommandOrControl+F",
    "Control+J",
  ]);
  await key(window, "f", { ctrlKey: true });
  await key(window, "j", { ctrlKey: true });
  expect(handler).toHaveBeenCalledTimes(2);
  await menu("Add shortcut");
  await vi.waitFor(() => expect(row().querySelector("input")).not.toBeNull());
  await key(row().querySelector("input")!, "j", { ctrlKey: true });
  expect(writes()).toHaveLength(1);
  expect(row().querySelector("[role=alert]")).not.toBeNull();
});

it("全量恢复需要确认，保存失败留在弹窗，成功只重置键位偏好", async () => {
  await key(await edit(), "j", { ctrlKey: true });
  const reset = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Reset all to defaults")!;
  await act(async () => reset.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(writes()).toHaveLength(1);
  rejected = true;
  const confirm = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent === "Reset all")!;
  await act(async () => confirm().click());
  expect(
    document.querySelector('[role="dialog"] [role="alert"]'),
  ).not.toBeNull();
  rejected = false;
  await act(async () => confirm().click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(persisted.desktop).toEqual({
    "open-link-in-target-preference": "external-browser",
    "keyboard-shortcuts": {},
    "external-browser-link-shortcut": "primary",
  });
});

it("保存期间互斥并保持捕获输入，重复按键不会重复写入", async () => {
  let resolve!: () => void;
  pendingWrite = new Promise<void>((done) => {
    resolve = done;
  });
  const input = await edit();
  await key(input, "j", { ctrlKey: true });
  await key(input, "l", { ctrlKey: true });
  expect(writes()).toHaveLength(1);
  expect(input.getAttribute("aria-busy")).toBe("true");
  await act(async () => {
    resolve();
    await pendingWrite;
  });
  expect(getRegisteredCommands()[0].bindings).toEqual(["Control+J"]);
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s 呈现完整翻译且无裸键",
  async (locale) => {
    await act(async () => changeLimeLocale(locale));
    expect(container.textContent).not.toContain("settings.keyboardShortcuts.");
    expect(
      container
        .querySelector("[data-binding-button]")
        ?.getAttribute("aria-label"),
    ).toBeTruthy();
  },
);
