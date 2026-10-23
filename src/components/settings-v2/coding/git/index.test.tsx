import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { GitSettings } from ".";
import { DEFAULT_GIT_PREFERENCES } from "@/lib/api/gitPreferences";

const api = vi.hoisted(() => ({ getConfig: vi.fn(), updateConfig: vi.fn() }));
vi.mock("@/lib/api/appConfig", () => ({
  ...api,
  subscribeAppConfigChanged: () => () => {},
}));
let root: Root;
let container: HTMLDivElement;
let config: Record<string, unknown>;
const input = (id: string) =>
  container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#${id}-input`,
  )!;
async function edit(id: string, value: string) {
  await act(async () => {
    const node = input(id);
    const prototype =
      node.tagName === "INPUT"
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount() {
  await act(async () => root.render(<GitSettings />));
}
async function tick(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.useFakeTimers();
  config = { language: "ja-JP", git: {} };
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
  vi.useRealTimers();
});

it("shows the reference defaults and seven searchable real preferences", async () => {
  await mount();
  expect(input("git-branch-prefix").value).toBe("codex/");
  const switches = container.querySelectorAll('[role="switch"]');
  expect(
    [...switches].map((node) => node.getAttribute("aria-checked")),
  ).toEqual(["false", "true"]);
  expect(
    container.querySelectorAll("[data-settings-search-target]"),
  ).toHaveLength(7);
  expect(container.querySelectorAll("textarea")).toHaveLength(2);
});

it("saves toggles immediately and preserves other configuration", async () => {
  await mount();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
  );
  expect(config).toEqual({
    language: "ja-JP",
    git: { "always-force-push": true },
  });
});

it("saves branch prefix on blur and Cmd-S without trimming or double writes", async () => {
  await mount();
  await edit("git-branch-prefix", "team/");
  expect(api.updateConfig).not.toHaveBeenCalled();
  await act(async () =>
    input("git-branch-prefix").dispatchEvent(
      new FocusEvent("focusout", { bubbles: true }),
    ),
  );
  expect(config.git).toEqual({ "branch-prefix": "team/" });
  await edit("git-branch-prefix", "");
  await act(async () =>
    input("git-branch-prefix").dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
    ),
  );
  expect(config.git).toEqual({ "branch-prefix": "" });
  expect(api.updateConfig).toHaveBeenCalledTimes(2);
});

it("debounces instruction changes for three seconds and exposes saved status", async () => {
  await mount();
  await edit("git-commit-instructions", "Use conventional commits");
  await tick(2999);
  expect(api.updateConfig).not.toHaveBeenCalled();
  await tick(1);
  expect(config.git).toEqual({
    "commit-instructions": "Use conventional commits",
  });
  expect(container.textContent).toContain("Saved");
  await tick(3000);
  expect(container.textContent).not.toContain("Saved");
});

it("retains failed drafts for an explicit retry", async () => {
  api.updateConfig.mockRejectedValueOnce(new Error("offline"));
  await mount();
  await edit("git-pr-instructions", "  Keep this draft\n");
  await tick(3000);
  expect(input("git-pr-instructions").value).toBe("  Keep this draft\n");
  expect(config.git).toEqual({});
  const section = container.querySelector("#git-pr-instructions")!;
  expect(section.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () =>
    section.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(config.git).toEqual({
    "pull-request-instructions": "  Keep this draft\n",
  });
});

it("flushes pending instructions when leaving the page", async () => {
  await mount();
  await edit("git-commit-instructions", "Flush before debounce");
  await act(async () => root.render(<div />));
  expect(config.git).toEqual({
    "commit-instructions": "Flush before debounce",
  });
});

it("does not retry a failed draft after the user discards it by leaving", async () => {
  api.updateConfig.mockRejectedValue(new Error("offline"));
  await mount();
  await edit("git-commit-instructions", "discarded failed draft");
  await tick(3000);
  expect(api.updateConfig).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<div />));
  expect(api.updateConfig).toHaveBeenCalledTimes(1);
  expect(config.git).toEqual({});
});

it("keeps newer edits made while an earlier save is in flight", async () => {
  let resolve: (() => void) | undefined;
  api.updateConfig.mockImplementationOnce(async (updater) => {
    await new Promise<void>((done) => {
      resolve = done;
    });
    config = updater(config);
    return config;
  });
  await mount();
  await edit("git-commit-instructions", "first");
  await tick(3000);
  await edit("git-commit-instructions", "second");
  await act(async () => resolve!());
  expect(input("git-commit-instructions").value).toBe("second");
  await tick(3000);
  expect(config.git).toEqual({ "commit-instructions": "second" });
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "renders all fields in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    config.git = DEFAULT_GIT_PREFERENCES;
    await mount();
    expect(container.textContent).not.toContain("settings.git.");
    expect(
      container.querySelectorAll("[data-settings-search-target]"),
    ).toHaveLength(7);
  },
);
