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
          layers: [
            {
              name: { type: "user", file: "/fixture/config.yaml" },
              version: `v${version}`,
              config: structuredClone(persisted),
            },
          ],
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

it("设置列表沿用当前命令的参考顺序，重新挂载后保持稳定", async () => {
  await act(async () => {
    for (const id of ["openSideChat", "archiveThread", "newTask"])
      releases.push(
        registerCommand({
          id,
          titleKey: "commands.searchSettings.title",
          section: "thread",
          bindings: ["Control+J"],
          handler: vi.fn(),
        }),
      );
  });
  const order = () =>
    [...container.querySelectorAll<HTMLElement>("[data-command-id]")].map(
      (node) => node.dataset.commandId,
    );
  const expected = [
    "newTask",
    "archiveThread",
    "openSideChat",
    "searchSettings",
    "showKeyboardShortcuts",
  ];
  expect(order()).toEqual(expected);
  await act(async () => {
    releases.pop()!();
    releases.push(
      registerCommand({
        id: "newTask",
        titleKey: "commands.searchSettings.title",
        section: "thread",
        bindings: ["Control+J"],
        handler: vi.fn(),
      }),
    );
  });
  expect(order()).toEqual(expected);
});
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
async function action(label: string) {
  await act(async () => {
    if (label === "Add shortcut") {
      row()
        .querySelector("[data-binding-button]")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, shiftKey: true }),
        );
    } else {
      [...row().querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.getAttribute("aria-label") === label)!
        .click();
    }
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
  expect(row().querySelector("[role=alert]")).toBeNull();
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
  await action("Clear shortcut");
  expect(row()).not.toBeNull();
  expect(row().textContent).toContain("Unassigned");
  await key(window, "f", { ctrlKey: true });
  expect(handler).not.toHaveBeenCalled();
  await action("Restore defaults");
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

it("裸首键显示待续且不保存，第二键持久化序列并派发同一handler", async () => {
  const input = await edit();
  await key(input, "g");
  expect(input.value).toBe("G …");
  expect(writes()).toHaveLength(0);
  expect(handler).not.toHaveBeenCalled();
  await key(input, "s");
  expect(writes()).toHaveLength(1);
  expect(
    (persisted.desktop as Record<string, unknown>)["keyboard-shortcuts"],
  ).toEqual({ searchSettings: ["G S"] });
  expect(row().querySelectorAll("[data-shortcut-stroke]")).toHaveLength(2);
  expect(document.activeElement).toBe(
    row().querySelector("[data-binding-button]"),
  );
  await key(window, "g");
  expect(handler).not.toHaveBeenCalled();
  await key(window, "s");
  expect(handler).toHaveBeenCalledOnce();
});

it.each(["composer.submit", "browser.toggleAnnotationMode"])(
  "%s的捕获不等待续键",
  async (id) => {
    await act(async () => {
      releases.push(
        registerCommand({
          id,
          titleKey: "commands.showKeyboardShortcuts.title",
          section: "thread",
          bindings: ["Control+Enter"],
          handler: vi.fn(),
        }),
      );
    });
    const target = container.querySelector<HTMLElement>(
      `[data-command-id="${id}"]`,
    )!;
    await act(async () =>
      target.querySelector<HTMLButtonElement>("[data-binding-button]")!.click(),
    );
    await key(target.querySelector("input")!, "g");
    expect(writes()).toHaveLength(1);
    expect(
      getRegisteredCommands().find((command) => command.id === id)!.bindings,
    ).toEqual(["G"]);
  },
);

it("裸首键一秒后提交单键；超时前不写配置", async () => {
  vi.useFakeTimers();
  try {
    const input = await edit();
    await key(input, "g");
    await act(async () => vi.advanceTimersByTime(999));
    expect(writes()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(1));
    expect(writes()).toHaveLength(1);
    expect(
      getRegisteredCommands().find(
        (command) => command.id === "searchSettings",
      )!.bindings,
    ).toEqual(["G"]);
  } finally {
    vi.useRealTimers();
  }
});

it.each(["Escape", "Tab", "blur", "unmount"])(
  "%s取消待续，迟到timer不保存",
  async (reason) => {
    vi.useFakeTimers();
    try {
      const input = await edit();
      await key(input, "g");
      if (reason === "blur") await act(async () => input.blur());
      else if (reason === "unmount")
        await act(async () => root.render(<div />));
      else await key(input, reason);
      await act(async () => vi.advanceTimersByTime(1500));
      expect(writes()).toHaveLength(0);
      expect(
        container.querySelector('[data-command-id="searchSettings"] input'),
      ).toBeNull();
      if (reason === "Escape")
        expect(document.activeElement).toBe(
          row().querySelector("[data-binding-button]"),
        );
    } finally {
      vi.useRealTimers();
    }
  },
);

it("IME清除待续，重复按键不成为第二键", async () => {
  const input = await edit();
  await key(input, "g");
  await key(input, "g", { repeat: true });
  expect(input.value).toBe("G …");
  await key(input, "Process", { isComposing: true });
  expect(input.value).toBe("");
  await key(input, "j", { ctrlKey: true });
  expect(
    getRegisteredCommands().find((command) => command.id === "searchSettings")!
      .bindings,
  ).toEqual(["Control+J"]);
  expect(writes()).toHaveLength(1);
});

it("其他命令的长短前缀冲突都拒绝保存，公共首键不同续键允许", async () => {
  await act(async () => {
    releases.push(
      registerCommand({
        id: "otherSequence",
        titleKey: "commands.showKeyboardShortcuts.title",
        section: "thread",
        bindings: ["G G"],
        handler: vi.fn(),
      }),
    );
  });
  const input = await edit();
  vi.useFakeTimers();
  try {
    await key(input, "g");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(writes()).toHaveLength(0);
    expect(row().querySelector("[role=alert]")).not.toBeNull();
    await key(input, "g");
    await key(input, "s");
    expect(writes()).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
  await act(async () => {
    releases.push(
      registerCommand({
        id: "single",
        titleKey: "commands.showKeyboardShortcuts.title",
        section: "thread",
        bindings: ["X"],
        handler: vi.fn(),
      }),
    );
  });
  const replacement = await edit();
  await key(replacement, "x");
  await key(replacement, "s");
  expect(writes()).toHaveLength(1);
  expect(row().querySelector("[role=alert]")).not.toBeNull();
});

it("同一命令的替代绑定也拒绝前缀冲突", async () => {
  await key(await edit(), "g");
  const input = row().querySelector<HTMLInputElement>("input")!;
  await key(input, "s");
  await action("Add shortcut");
  vi.useFakeTimers();
  try {
    await key(row().querySelector("input")!, "g");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(writes()).toHaveLength(1);
    expect(row().querySelector("[role=alert]")).not.toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("按键搜索先匹配首键，再缩小到续键，失配键替换query且不执行", async () => {
  await key(await edit(), "g");
  await key(row().querySelector("input")!, "s");
  await act(async () => {
    releases.push(
      registerCommand({
        id: "otherSequence",
        titleKey: "commands.showKeyboardShortcuts.title",
        section: "thread",
        bindings: ["G G"],
        handler: vi.fn(),
      }),
    );
    container
      .querySelector<HTMLButtonElement>('[aria-label="Search by keystrokes"]')!
      .click();
  });
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="Keystroke search capture"]',
  )!;
  await key(input, "g");
  expect(container.querySelectorAll("[data-command-id]")).toHaveLength(2);
  await key(input, "s");
  expect(input.value).toBe("G S");
  expect(container.querySelectorAll("[data-command-id]")).toHaveLength(1);
  await key(input, "/", { ctrlKey: true });
  expect(input.value).toBe("Ctrl /");
  expect(container.querySelectorAll("[data-command-id]")).toHaveLength(1);
  expect(row()).toBeNull();
  expect(handler).not.toHaveBeenCalled();
  expect(writes()).toHaveLength(1);
});

it("Shift追加的第二键位获得焦点并执行同一handler，重复绑定被拒绝", async () => {
  await action("Add shortcut");
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
  await action("Add shortcut");
  await vi.waitFor(() => expect(row().querySelector("input")).not.toBeNull());
  await key(row().querySelector("input")!, "j", { ctrlKey: true });
  expect(writes()).toHaveLength(1);
  expect(row().querySelector("[role=alert]")).not.toBeNull();
});

it("每个绑定直接清除，保留其它绑定；恢复按钮只出现在首个差异行", async () => {
  await action("Add shortcut");
  await key(row().querySelector("input")!, "j", { ctrlKey: true });
  expect(row().querySelector('[aria-haspopup="menu"]')).toBeNull();
  expect(row().querySelectorAll('[aria-label="Clear shortcut"]')).toHaveLength(
    2,
  );
  const reset = row().querySelector('[aria-label="Restore defaults"]')!;
  expect(reset.parentElement!.parentElement!.textContent).toContain("CtrlJ");
  await act(async () =>
    [
      ...row().querySelectorAll<HTMLButtonElement>(
        '[aria-label="Clear shortcut"]',
      ),
    ][1].click(),
  );
  expect(
    getRegisteredCommands().find((command) => command.id === "searchSettings")!
      .bindings,
  ).toEqual(["CommandOrControl+F"]);
  await key(window, "j", { ctrlKey: true });
  expect(handler).not.toHaveBeenCalled();
  await key(window, "f", { ctrlKey: true });
  expect(handler).toHaveBeenCalledOnce();
  expect(
    row().querySelectorAll('[aria-label="Restore defaults"]'),
  ).toHaveLength(1);
  await action("Restore defaults");
  expect(row().querySelector('[aria-label="Restore defaults"]')).toBeNull();
  expect(document.activeElement).toBe(
    row().querySelector("[data-binding-button]"),
  );
});

it("Shift悬停提示追加，点击后新行获得焦点，取消回到原绑定", async () => {
  const button = row().querySelector<HTMLButtonElement>(
    "[data-binding-button]",
  )!;
  await act(async () =>
    button.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, shiftKey: true }),
    ),
  );
  expect(button.getAttribute("aria-label")).toBe("Add shortcut");
  await action("Add shortcut");
  expect(row().querySelectorAll("[data-binding-button]")).toHaveLength(1);
  const input = row().querySelector<HTMLInputElement>("input")!;
  expect(document.activeElement).toBe(input);
  await key(input, "Escape");
  expect(document.activeElement).toBe(button);
  expect(writes()).toHaveLength(0);
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
