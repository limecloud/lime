import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { ManagedWorktree } from "@/lib/api/worktrees";
import { SettingsDraftContext } from "../../_layout/useSettingsDraft";
import { WorktreesSettings } from ".";

const api = vi.hoisted(() => ({
  listManagedWorktrees: vi.fn(),
  deleteManagedWorktree: vi.fn(),
  getConfig: vi.fn(),
  createAgentRuntimeSession: vi.fn(),
  getAgentRuntimeSession: vi.fn(),
}));
vi.mock("@/lib/api/worktrees", () => api);
vi.mock("@/lib/api/agentRuntime/sessionClient", () => api);
let configChanged: () => void;
vi.mock("@/lib/api/appConfig", () => ({
  getConfig: api.getConfig,
  updateConfig: vi.fn(),
  subscribeAppConfigChanged: (listener: () => void) => {
    configChanged = listener;
    return () => {};
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const register = vi.fn(() => () => {});
const onNavigate = vi.fn();
let root: Root;
let container: HTMLDivElement;
const entry = (
  name = "first",
  threads: ManagedWorktree["threads"] = [],
): ManagedWorktree => ({
  worktreePath: `/tmp/managed/${name}`,
  repositoryRoot: "/tmp/repository",
  headSha: "a".repeat(40),
  branch: null,
  threads,
});
const conversation = (overrides = {}) => ({
  threadId: "chat-1",
  name: "My task",
  archived: false,
  pinned: false,
  active: false,
  ...overrides,
});
const response = (worktrees: ManagedWorktree[]) => ({
  rootPath: "/tmp/managed",
  worktrees,
});
const button = (name: string, surface: Document | Element = document) =>
  Array.from(surface.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent === name,
  )!;
const removeButton = (path: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-worktree-path="${path}"] button[aria-label]`,
  )!;
async function mount() {
  await act(async () =>
    root.render(
      <SettingsDraftContext.Provider value={register}>
        <WorktreesSettings onNavigate={onNavigate} />
      </SettingsDraftContext.Provider>,
    ),
  );
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  register.mockImplementation(() => () => {});
  api.getConfig.mockResolvedValue({ worktrees: { root: "/tmp/managed" } });
  api.listManagedWorktrees.mockResolvedValue(response([entry()]));
  api.deleteManagedWorktree.mockResolvedValue(undefined);
  api.createAgentRuntimeSession.mockResolvedValue("session-new");
  api.getAgentRuntimeSession.mockResolvedValue({ id: "session-existing" });
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("shows loading, keeps failure explicit and refreshes into an empty list", async () => {
  let reject!: (error: Error) => void;
  api.listManagedWorktrees.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount();
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Fetching",
  );
  expect(button("Refresh").disabled).toBe(true);
  await act(async () => reject(new Error("offline")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Unable to load",
  );
  api.listManagedWorktrees.mockResolvedValue(response([]));
  await click(button("Refresh"));
  expect(container.textContent).toContain("No worktrees yet");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("lists canonical chats and prevents deletion for pinned or active threads", async () => {
  api.listManagedWorktrees.mockResolvedValue(
    response([
      entry("pinned", [conversation({ pinned: true })]),
      entry("active", [conversation({ threadId: "chat-2", active: true })]),
      entry("archived", [
        conversation({ threadId: "chat-3", archived: true, name: "" }),
      ]),
    ]),
  );
  await mount();
  expect(removeButton("/tmp/managed/pinned").disabled).toBe(true);
  expect(removeButton("/tmp/managed/active").disabled).toBe(true);
  expect(container.textContent).toContain("Unpin the chats");
  expect(container.textContent).toContain("Stop the running chats");
  expect(container.textContent).toContain("Untitled conversation");
  expect(container.textContent).toContain("Archived");
  expect(removeButton("/tmp/managed/archived").disabled).toBe(false);
  expect(api.deleteManagedWorktree).not.toHaveBeenCalled();
});

it("requires confirmation and cancellation preserves the worktree", async () => {
  await mount();
  await click(removeButton("/tmp/managed/first"));
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain(
    "A snapshot will try to save tracked changes",
  );
  expect(dialog.textContent).toContain("will be permanently deleted");
  expect(dialog.textContent).toContain("/tmp/managed/first");
  expect(api.deleteManagedWorktree).not.toHaveBeenCalled();
  await click(button("Cancel", dialog));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(removeButton("/tmp/managed/first")).not.toBeNull();
});

it("keeps a failed confirmation open, serializes retry and refreshes only after deletion", async () => {
  api.deleteManagedWorktree.mockRejectedValueOnce(new Error("dirty"));
  await mount();
  await click(removeButton("/tmp/managed/first"));
  await click(
    button("Delete", document.querySelector('[role="alertdialog"]')!),
  );
  expect(
    document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent,
  ).toContain("Could not delete");
  expect(removeButton("/tmp/managed/first")).not.toBeNull();
  let resolve!: () => void;
  api.deleteManagedWorktree.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const dialog = document.querySelector('[role="alertdialog"]')!;
  await click(button("Delete", dialog));
  await click(button("Delete", dialog));
  expect(api.deleteManagedWorktree).toHaveBeenCalledTimes(2);
  expect(api.deleteManagedWorktree).toHaveBeenLastCalledWith(
    "/tmp/managed/first",
  );
  expect(button("Cancel", dialog).disabled).toBe(true);
  expect(register).toHaveBeenLastCalledWith({ dirty: false, saving: true });
  api.listManagedWorktrees.mockResolvedValue(response([]));
  await act(async () => resolve());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(container.textContent).toContain("No worktrees yet");
});

it("clears the old root and ignores a late response after switching the configured directory", async () => {
  let resolve!: (value: unknown) => void;
  api.listManagedWorktrees.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  api.getConfig.mockResolvedValue({ worktrees: { root: "/tmp/new-root" } });
  api.listManagedWorktrees.mockResolvedValue(response([entry("new")]));
  await act(async () => configChanged());
  expect(removeButton("/tmp/managed/new")).not.toBeNull();
  await act(async () => resolve(response([entry("old")])));
  expect(removeButton("/tmp/managed/old")).toBeNull();
  expect(removeButton("/tmp/managed/new")).not.toBeNull();
});

it("opens a linked chat using its canonical session identity", async () => {
  api.listManagedWorktrees.mockResolvedValue(
    response([entry("first", [conversation()])]),
  );
  await mount();
  await click(button("My task"));
  expect(api.getAgentRuntimeSession).toHaveBeenCalledWith("chat-1", {
    historyLimit: 1,
    source: "worktree-settings",
  });
  expect(onNavigate).toHaveBeenCalledWith(
    "agent",
    expect.objectContaining({
      initialSessionId: "session-existing",
      agentEntry: "claw",
    }),
  );
  expect(api.createAgentRuntimeSession).not.toHaveBeenCalled();
});

it("starts a fresh chat in the same worktree and releases its saving guard before navigating", async () => {
  let guarded = false;
  register.mockImplementation(() => {
    guarded = true;
    return () => {
      guarded = false;
    };
  });
  onNavigate.mockImplementation(() => {
    expect(guarded).toBe(false);
  });
  await mount();
  await click(button("New chat in this worktree"));
  expect(api.createAgentRuntimeSession).toHaveBeenCalledWith(
    undefined,
    undefined,
    undefined,
    {
      workingDir: "/tmp/managed/first",
    },
  );
  expect(api.getAgentRuntimeSession).not.toHaveBeenCalled();
  expect(onNavigate).toHaveBeenCalledWith(
    "agent",
    expect.objectContaining({ initialSessionId: "session-new" }),
  );
});

it("keeps failed chat actions retryable and prevents overlapping requests", async () => {
  api.createAgentRuntimeSession.mockRejectedValueOnce(new Error("offline"));
  await mount();
  const create = button("New chat in this worktree");
  await click(create);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Try again",
  );
  expect(onNavigate).not.toHaveBeenCalled();
  let resolve!: (id: string) => void;
  api.createAgentRuntimeSession.mockImplementationOnce(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  await click(create);
  await click(create);
  expect(api.createAgentRuntimeSession).toHaveBeenCalledTimes(2);
  expect(removeButton("/tmp/managed/first").disabled).toBe(true);
  expect(button("Refresh").disabled).toBe(true);
  expect(register).toHaveBeenLastCalledWith({ dirty: false, saving: true });
  await act(async () => resolve("session-retry"));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it("ignores a late canonical chat read after the configured root changes", async () => {
  let resolve!: (value: { id: string }) => void;
  api.getAgentRuntimeSession.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  api.listManagedWorktrees.mockResolvedValue(
    response([entry("first", [conversation()])]),
  );
  await mount();
  await click(button("My task"));
  api.getConfig.mockResolvedValue({ worktrees: { root: "/tmp/other-root" } });
  api.listManagedWorktrees.mockResolvedValue(response([entry("other")]));
  await act(async () => configChanged());
  await act(async () => resolve({ id: "late-session" }));
  expect(onNavigate).not.toHaveBeenCalled();
  expect(removeButton("/tmp/managed/other")).not.toBeNull();
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "translates list and deletion confirmation in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    await mount();
    await click(removeButton("/tmp/managed/first"));
    expect(container.textContent).not.toContain("settings.worktrees.");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).not.toContain("settings.worktrees.");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
  },
);

it("refreshes automatic cleanup quietly and pauses while a deletion dialog is open", async () => {
  vi.useFakeTimers();
  try {
    await mount();
    await click(removeButton("/tmp/managed/first"));
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(api.listManagedWorktrees).toHaveBeenCalledTimes(1);
    await click(
      button("Cancel", document.querySelector('[role="alertdialog"]')!),
    );
    let resolve!: (value: ReturnType<typeof response>) => void;
    api.listManagedWorktrees.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(container.querySelector("[data-worktree-path]")).not.toBeNull();
    expect(
      container.querySelector("#worktrees-managed")?.getAttribute("aria-busy"),
    ).toBe("false");
    await act(async () => resolve(response([])));
    expect(container.querySelector("[data-worktree-path]")).toBeNull();
    expect(container.textContent).toContain("No worktrees yet");
  } finally {
    vi.useRealTimers();
  }
});
