import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SettingsDraftContext } from "../../_layout/useSettingsDraft";
import { WorktreesSettings } from ".";

const api = vi.hoisted(() => ({ getConfig: vi.fn(), updateConfig: vi.fn() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api/worktrees", () => ({
  listManagedWorktrees: async () => ({
    rootPath: "/tmp/fixture",
    worktrees: [],
  }),
}));
vi.mock("sonner", () => ({ toast: notifications }));
let onConfigChange: (() => void) | undefined;
vi.mock("@/lib/api/appConfig", () => ({
  ...api,
  subscribeAppConfigChanged: (listener: () => void) => {
    onConfigChange = listener;
    return () => {
      onConfigChange = undefined;
    };
  },
}));
let root: Root;
let container: HTMLDivElement;
let config: Record<string, unknown>;
const register = vi.fn(() => () => {});
const input = () =>
  container.querySelector<HTMLInputElement>("#worktrees-root-input")!;
const toggle = () =>
  container.querySelector<HTMLButtonElement>('[role="switch"]')!;
async function mount() {
  await act(async () =>
    root.render(
      <SettingsDraftContext.Provider value={register}>
        <WorktreesSettings />
      </SettingsDraftContext.Provider>,
    ),
  );
}
async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function blur() {
  await act(async () =>
    input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
}
async function shortcut() {
  await act(async () =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
    ),
  );
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  register.mockImplementation(() => () => {});
  config = {
    language: "ja-JP",
    git: { "branch-prefix": "team/" },
    worktrees: {},
  };
  api.getConfig.mockImplementation(async () => config);
  api.updateConfig.mockImplementation(
    async (updater) => (config = updater(config)),
  );
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("loads passive defaults without creating a directory or invoking Git", async () => {
  await mount();
  expect(input().value).toBe("");
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(
    container.querySelectorAll("[data-settings-search-target]"),
  ).toHaveLength(5);
  expect(api.getConfig).toHaveBeenCalledWith({ forceRefresh: true });
  expect(api.updateConfig).not.toHaveBeenCalled();
});

it("trims on blur, saves an explicit empty root with Cmd-S and preserves other settings", async () => {
  await mount();
  await edit("  /tmp/Managed Worktrees  ");
  expect(api.updateConfig).not.toHaveBeenCalled();
  expect(register).toHaveBeenLastCalledWith({ dirty: true, saving: false });
  await blur();
  expect(input().value).toBe("/tmp/Managed Worktrees");
  expect(config).toEqual({
    language: "ja-JP",
    git: { "branch-prefix": "team/" },
    worktrees: { root: "/tmp/Managed Worktrees" },
  });
  await edit("");
  await shortcut();
  await blur();
  expect(config.worktrees).toEqual({ root: "" });
  expect(api.updateConfig).toHaveBeenCalledTimes(2);
  expect(notifications.success).toHaveBeenCalledTimes(2);
});

it("normalizes whitespace-only edits without an unnecessary write", async () => {
  await mount();
  await edit("  ");
  await blur();
  expect(input().value).toBe("");
  expect(api.updateConfig).not.toHaveBeenCalled();
});

it("keeps failed root drafts dirty and supports explicit retry", async () => {
  api.updateConfig.mockRejectedValueOnce(new Error("offline"));
  await mount();
  await edit("/tmp/Retain Draft");
  await shortcut();
  expect(input().value).toBe("/tmp/Retain Draft");
  expect(input().getAttribute("aria-invalid")).toBe("true");
  expect(config.worktrees).toEqual({});
  expect(notifications.error).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenLastCalledWith({ dirty: true, saving: false });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#worktrees-root button")!
      .click(),
  );
  expect(config.worktrees).toEqual({ root: "/tmp/Retain Draft" });
  expect(input().getAttribute("aria-invalid")).toBe("false");
});

it("serializes rapid shortcut and blur and locks both controls until saving completes", async () => {
  let resolve!: () => void;
  api.updateConfig.mockImplementationOnce(async (updater) => {
    await new Promise<void>((done) => {
      resolve = done;
    });
    return (config = updater(config));
  });
  await mount();
  await edit("/tmp/Once");
  await shortcut();
  await blur();
  expect(input().disabled).toBe(true);
  expect(toggle().disabled).toBe(true);
  expect(api.updateConfig).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(input().value).toBe("/tmp/Once");
  expect(input().getAttribute("aria-invalid")).toBe("false");
  expect(toggle().disabled).toBe(false);
});

it("saves upstream immediately, retains the confirmed value on failure, then retries", async () => {
  api.updateConfig.mockRejectedValueOnce(new Error("offline"));
  await mount();
  await act(async () => toggle().click());
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle().click());
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(config.worktrees).toEqual({ "upstream-refresh-mode": "best-effort" });
  await act(async () => toggle().click());
  expect(config.worktrees).toEqual({ "upstream-refresh-mode": "never" });
});

it("retries a failed initial read and does not render writable controls before loading", async () => {
  api.getConfig.mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(input()).toBeNull();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(input().value).toBe("");
});

it("updates clean roots from config events while preserving a local dirty draft", async () => {
  await mount();
  config.worktrees = { root: "/tmp/External" };
  await act(async () => onConfigChange!());
  expect(input().value).toBe("/tmp/External");
  await edit("/tmp/Local Draft");
  config.worktrees = { root: "/tmp/New External" };
  await act(async () => onConfigChange!());
  expect(input().value).toBe("/tmp/Local Draft");
  await blur();
  expect(config.worktrees).toEqual({ root: "/tmp/Local Draft" });
});

it("ignores an older refresh that completes after a successful write", async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  api.getConfig.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => onConfigChange!());
  await edit("/tmp/Latest");
  await blur();
  await act(async () => resolve({ worktrees: { root: "/tmp/Stale" } }));
  expect(input().value).toBe("/tmp/Latest");
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "renders translated worktree controls in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    await mount();
    expect(container.textContent).not.toContain("settings.worktrees.");
    expect(input().getAttribute("aria-labelledby")).toBe(
      "worktrees-root-label",
    );
    expect(toggle().getAttribute("aria-describedby")).toBe(
      "worktrees-upstream-refresh-description",
    );
  },
);

const cleanupToggle = () =>
  container.querySelector<HTMLButtonElement>("#worktrees-auto-cleanup button")!;
const countInput = () =>
  container.querySelector<HTMLInputElement>("#worktrees-keep-count-input")!;
async function editCount(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(countInput(), value);
    countInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const dialogButton = (text: string) =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
  ).find((button) => button.textContent === text)!;

it("requires confirmation to disable cleanup and preserves the saved limit when reenabled", async () => {
  await mount();
  expect(cleanupToggle().getAttribute("aria-checked")).toBe("true");
  expect(countInput().value).toBe("15");
  await act(async () => cleanupToggle().click());
  expect(api.updateConfig).not.toHaveBeenCalled();
  await act(async () => dialogButton("Keep automatic deletion").click());
  expect(cleanupToggle().getAttribute("aria-checked")).toBe("true");
  await act(async () => cleanupToggle().click());
  await act(async () => dialogButton("Disable automatic deletion").click());
  expect(countInput().disabled).toBe(true);
  expect(config.worktrees).toEqual({ "auto-cleanup-enabled": false });
  expect(container.textContent).toContain("Turning it on again");
  await act(async () => cleanupToggle().click());
  expect(countInput().disabled).toBe(false);
  expect(countInput().value).toBe("15");
});

it("normalizes limits on Enter or blur, rejects empty input and preserves unrelated config", async () => {
  await mount();
  await editCount("3.9");
  await act(async () =>
    countInput().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(countInput().value).toBe("3");
  expect(config.worktrees).toEqual({ "keep-count": 3 });
  expect(config.git).toEqual({ "branch-prefix": "team/" });
  await editCount("-2");
  await act(async () =>
    countInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
  expect(countInput().value).toBe("1");
  await editCount("");
  await act(async () =>
    countInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
  expect(countInput().value).toBe("1");
  expect(api.updateConfig).toHaveBeenCalledTimes(2);
});

it("retains failed limit drafts for retry and leaves cleanup enabled on failed confirmation", async () => {
  await mount();
  api.updateConfig.mockRejectedValueOnce(new Error("disk"));
  await editCount("4");
  await act(async () =>
    countInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
  expect(countInput().getAttribute("aria-invalid")).toBe("true");
  expect(countInput().value).toBe("4");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("#worktrees-keep-count button")!
      .click(),
  );
  expect(config.worktrees).toEqual({ "keep-count": 4 });
  expect(countInput().getAttribute("aria-invalid")).toBe("false");
  await act(async () => cleanupToggle().click());
  api.updateConfig.mockRejectedValueOnce(new Error("disk"));
  await act(async () => dialogButton("Disable automatic deletion").click());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(cleanupToggle().getAttribute("aria-checked")).toBe("true");
  await act(async () => dialogButton("Keep automatic deletion").click());
});
