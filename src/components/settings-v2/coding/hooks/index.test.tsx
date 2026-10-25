import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { HookMetadata, HooksListEntry } from "@/lib/api/hooks";
import { HooksSettings } from ".";

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listHooks: vi.fn(),
  updateHookState: vi.fn(),
  openPathWithDefaultApp: vi.fn(),
}));
vi.mock("@/lib/api/project", () => ({ listProjects: api.listProjects }));
vi.mock("@/lib/api/hooks", () => ({
  listHooks: api.listHooks,
  updateHookState: api.updateHookState,
}));
vi.mock("@/lib/api/fileSystem", () => ({
  openPathWithDefaultApp: api.openPathWithDefaultApp,
}));
let root: Root;
let container: HTMLDivElement;
const hook = (key: string, extra = {}): HookMetadata => ({
  key,
  source: "user",
  sourcePath: "/home/config.toml",
  eventName: "preToolUse",
  handlerType: "command",
  command: "echo hook",
  displayOrder: 0,
  enabled: true,
  isManaged: false,
  currentHash: "hash-" + key,
  timeoutSec: 30,
  trustStatus: "trusted",
  statusMessage: key,
  ...extra,
});
const entry = (hooks: HookMetadata[]): HooksListEntry => ({
  cwd: "/work/project",
  hooks,
  warnings: [],
  errors: [],
});
const setHooks = (hooks: HookMetadata[]) =>
  api.listHooks.mockResolvedValue({ data: [entry(hooks)] });
const button = (name: string, exact = true) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) =>
      exact ? item.textContent === name : item.textContent?.includes(name),
  )!;
const click = async (target: HTMLElement) => act(async () => target.click());
const mount = async (strict = false) =>
  act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <HooksSettings />
        </StrictMode>
      ) : (
        <HooksSettings />
      ),
    ),
  );
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  api.listProjects.mockResolvedValue([
    { rootPath: "/work/project" },
    { rootPath: "/work/project" },
    { rootPath: "/archived", isArchived: true },
  ]);
  setHooks([hook("first")]);
  api.updateHookState.mockResolvedValue({ status: "ok" });
  api.openPathWithDefaultApp.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("lists only distinct active project roots and opens event details and the actual source path", async () => {
  await mount();
  expect(api.listHooks).toHaveBeenCalledWith({ cwds: ["/work/project"] });
  const source = button("User config", false);
  await click(source);
  expect(dialog().textContent).toContain("PreToolUse");
  await click(button("1 - first"));
  expect(dialog().querySelector("code")?.textContent).toBe("echo hook");
  expect(dialog().textContent).toContain("30s");
  await click(document.querySelector('button[aria-label="Open config file"]')!);
  expect(api.openPathWithDefaultApp).toHaveBeenCalledWith("/home/config.toml");
  await click(document.querySelector('button[aria-label="Close"]')!);
  expect(dialog()).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(source));
});

it("trusts the exact hash and keeps the switch blocked until metadata confirms trust", async () => {
  setHooks([hook("review", { trustStatus: "modified" })]);
  await mount();
  await click(button("User config", false));
  const control = () =>
    dialog().querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(control().disabled).toBe(true);
  setHooks([hook("review")]);
  await click(button("Trust"));
  expect(api.updateHookState).toHaveBeenCalledWith([
    { key: "review", trustedHash: "hash-review" },
  ]);
  expect(control().disabled).toBe(false);
  expect(control().getAttribute("aria-checked")).toBe("true");
  setHooks([hook("review", { enabled: false })]);
  await click(control());
  expect(api.updateHookState).toHaveBeenLastCalledWith([
    { key: "review", enabled: false },
  ]);
  expect(control().getAttribute("aria-checked")).toBe("false");
});

it("shows a real project override instead of pretending the user edit took effect", async () => {
  await mount();
  await click(button("User config", false));
  await click(dialog().querySelector('[role="switch"]')!);
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
    "Another config layer",
  );
  expect(
    dialog().querySelector('[role="switch"]')?.getAttribute("aria-checked"),
  ).toBe("true");
});

it("keeps failed writes retryable and blocks duplicate mutations while saving", async () => {
  let reject!: (error: Error) => void;
  api.updateHookState.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount();
  await click(button("User config", false));
  const control = dialog().querySelector<HTMLButtonElement>('[role="switch"]')!;
  await click(control);
  await click(control);
  expect(api.updateHookState).toHaveBeenCalledTimes(1);
  expect(control.disabled).toBe(true);
  await act(async () => reject(new Error("write denied")));
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save",
  );
  expect(control.disabled).toBe(false);
  expect(control.getAttribute("aria-checked")).toBe("true");
});

it("separates saved-but-unreadable state and requires a refresh before another mutation", async () => {
  await mount();
  await click(button("User config", false));
  api.listHooks.mockRejectedValueOnce(new Error("offline"));
  await click(dialog().querySelector('[role="switch"]')!);
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
    "Settings were saved",
  );
  expect(
    dialog().querySelector<HTMLButtonElement>('[role="switch"]')?.disabled,
  ).toBe(true);
  await click(button("Reload hooks"));
  expect(
    dialog().querySelector<HTMLButtonElement>('[role="switch"]')?.disabled,
  ).toBe(false);
});

it("trust all only includes reviewable hashes and never offers managed controls", async () => {
  setHooks([
    hook("new", { trustStatus: "untrusted" }),
    hook("changed", { trustStatus: "modified", enabled: false }),
    hook("managed", { isManaged: true, trustStatus: "managed" }),
  ]);
  await mount();
  await click(button("User config", false));
  const managed = dialog().querySelector('[data-hook-key="managed"]')!;
  expect(
    managed.querySelector('[role="switch"]')?.getAttribute("aria-disabled"),
  ).toBe("true");
  expect(
    managed.querySelector('button[aria-label="Open config file"]'),
  ).toBeNull();
  setHooks([
    hook("new"),
    hook("changed", { enabled: false }),
    hook("managed", { isManaged: true, trustStatus: "managed" }),
  ]);
  await click(button("Trust all"));
  expect(api.updateHookState).toHaveBeenCalledWith([
    { key: "new", trustedHash: "hash-new" },
    { key: "changed", trustedHash: "hash-changed" },
  ]);
  expect(dialog().textContent).not.toContain("Hooks run outside");
});

it("exposes load issues even when no hook was discovered and can retry project failures", async () => {
  api.listProjects.mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(container.textContent).toContain("Could not load hooks");
  api.listHooks.mockResolvedValue({
    data: [
      {
        ...entry([]),
        warnings: ["invalid matcher"],
        errors: [{ path: "/bad.toml", message: "bad TOML" }],
      },
    ],
  });
  await click(button("Retry"));
  await click(button("Unknown source", false));
  expect(dialog().textContent).toContain("invalid matcher");
  expect(dialog().textContent).toContain("/bad.toml: bad TOML");
  expect(api.updateHookState).not.toHaveBeenCalled();
});

it("does not substitute the process working directory when no project exists", async () => {
  api.listProjects.mockResolvedValue([]);
  await mount();
  expect(api.listHooks).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Add a project");
});

it("ignores old StrictMode responses and all late work after unmount", async () => {
  let resolve!: (projects: unknown[]) => void;
  api.listProjects.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount(true);
  expect(container.textContent).toContain("User config");
  const calls = api.listHooks.mock.calls.length;
  await act(async () => resolve([{ rootPath: "/stale" }]));
  expect(api.listHooks.mock.calls.length).toBe(calls);
  // A stale project response must not start another hook discovery request.
  expect(container.textContent).toContain("User config");
  await act(async () => root.unmount());
  root = createRoot(container);
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "renders %s copy without exposing translation keys",
  async (locale) => {
    await changeLimeLocale(locale);
    setHooks([hook("review", { trustStatus: "untrusted" })]);
    await mount();
    await click(container.querySelector("section button")!);
    expect(document.body.textContent).not.toContain("settings.hooks.");
    expect(dialog().querySelector('[role="switch"]')).not.toBeNull();
  },
);
