import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { DeviceStorageSettings } from ".";
import { SettingsTabs } from "@/types/settings";

const api = vi.hoisted(() => ({
  readStorage: vi.fn(),
  reviewStorage: vi.fn(),
  deleteStorage: vi.fn(),
}));
vi.mock("@/lib/api/storage", () => api);
let root: Root;
let container: HTMLDivElement;
const navigate = vi.fn();
const state = (
  status = "ready",
  completedCategories = [
    "threads",
    "subagents",
    "archived",
    "unclassified",
    "worktrees",
    "other",
  ],
) => ({
  status,
  completedCategories,
  measuredAt: 123,
  usage: {
    dataRoot: "/agent",
    worktreeRoot: "/trees",
    scannedRoots: ["/machine", "/agent"],
    totalBytes: 2048,
    categories: [
      { category: "threads", bytes: 1024 },
      { category: "unclassified", bytes: 512 },
      { category: "other", bytes: 512 },
    ],
    threadBytes: { old: 1024 },
  },
});
const candidate = (id: string) => ({
  root: { threadId: id, updatedAtMs: 1000, archived: true },
  name: id,
  descendants: [],
  bytes: 1024,
});
const button = (text: string, scope: Document | Element = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  )!;
async function click(text: string, scope: Document | Element = document) {
  await act(async () => button(text, scope).click());
}
async function mount() {
  await act(async () =>
    root.render(<DeviceStorageSettings onNavigate={navigate} />),
  );
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  await changeLimeLocale("en-US");
  api.readStorage.mockResolvedValue(state());
  api.reviewStorage.mockResolvedValue({
    cutoffMs: 10000,
    archivedOnly: true,
    candidates: [candidate("one"), candidate("two")],
  });
  api.deleteStorage.mockResolvedValue({ deleted: 1, skipped: 1, failed: 0 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("gates review on completed chat categories and keeps the current management navigation", async () => {
  api.readStorage.mockResolvedValue(state("error", ["threads"]));
  await mount();
  expect(button("Review").disabled).toBe(true);
  const manage = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].filter((item) => item.textContent === "Manage");
  await act(async () => manage[0].click());
  expect(navigate).toHaveBeenLastCalledWith("settings", {
    tab: SettingsTabs.Worktrees,
  });
  await act(async () => manage[1].click());
  expect(navigate).toHaveBeenLastCalledWith("settings", {
    tab: SettingsTabs.ArchivedConversations,
  });
  api.readStorage.mockResolvedValue(state());
  await click("Refresh");
  expect(button("Review").disabled).toBe(false);
});

it("keeps cached usage and provides retry after a measurement failure", async () => {
  await mount();
  api.readStorage.mockRejectedValueOnce(new Error("unavailable"));
  await click("Refresh");
  expect(container.textContent).toContain("Chats 1 KB");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(button("Review").disabled).toBe(true);
  await click("Refresh");
  expect(button("Review").disabled).toBe(false);
});

it("distinguishes completed category sizes from partial and failed measurements", async () => {
  api.readStorage.mockResolvedValue(state("scanning", ["threads"]));
  await mount();
  const labels = [...container.querySelectorAll("#storage-usage li")];
  expect(
    labels.find((entry) => entry.textContent?.startsWith("Chats"))?.textContent,
  ).toBe("Chats 1 KB");
  expect(
    labels.find((entry) => entry.textContent?.startsWith("Other"))?.textContent,
  ).toContain("1 KB · Updating…");
  await act(async () => root.unmount());
  root = createRoot(container);
  api.readStorage.mockResolvedValue(state("error", ["threads"]));
  await mount();
  expect(container.textContent).toContain("1 KB · Incomplete");
  expect(container.textContent).toContain("Chats 1 KB");
});

it("defaults to archived chats older than 90 days, permits selection, and requires independent confirmation", async () => {
  await mount();
  await click("Review");
  expect(api.reviewStorage).toHaveBeenCalledWith({
    days: 90,
    archivedOnly: true,
  });
  const checks = document.querySelectorAll<HTMLInputElement>(
    '[role="dialog"] input[type="checkbox"]',
  );
  await act(async () => checks[1].click());
  await click("Continue");
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(api.deleteStorage).not.toHaveBeenCalled();
  await click("Cancel", document.querySelector('[role="alertdialog"]')!);
  expect(api.deleteStorage).not.toHaveBeenCalled();
  await click("Continue");
  await click("Delete permanently");
  expect(api.deleteStorage).toHaveBeenCalledWith({
    cutoffMs: 10000,
    archivedOnly: true,
    candidates: [candidate("two")],
  });
  expect(document.body.textContent).toContain(
    "Deleted 1, skipped 1, failed 0.",
  );
});

it("rejects late review responses after a filter change", async () => {
  let finish: ((value: unknown) => void) | undefined;
  api.reviewStorage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await click("Review");
  const age = document.querySelector<HTMLSelectElement>(
    '[role="dialog"] select',
  )!;
  await act(async () => {
    age.value = "30";
    age.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(api.reviewStorage).toHaveBeenLastCalledWith({
    days: 30,
    archivedOnly: true,
  });
  await act(async () =>
    finish?.({
      cutoffMs: 2,
      archivedOnly: true,
      candidates: [candidate("late")],
    }),
  );
  expect(document.body.textContent).not.toContain("late");
  expect(document.body.textContent).toContain("one");
});

it("restores keyboard focus after cancelling each dialog", async () => {
  await mount();
  await click("Review");
  await click("Continue");
  await click("Cancel", document.querySelector('[role="alertdialog"]')!);
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button("Continue")),
  );
  await click("Cancel", document.querySelector('[role="dialog"]')!);
  await vi.waitFor(() => expect(document.activeElement).toBe(button("Review")));
});

it("shows the first 50 candidates and incrementally reveals the remainder", async () => {
  api.reviewStorage.mockResolvedValue({
    cutoffMs: 1000,
    archivedOnly: true,
    candidates: Array.from({ length: 51 }, (_, i) => candidate(`chat-${i}`)),
  });
  await mount();
  await click("Review");
  expect(
    document.querySelectorAll('[role="dialog"] input[type="checkbox"]'),
  ).toHaveLength(51);
  await click("Show more");
  expect(
    document.querySelectorAll('[role="dialog"] input[type="checkbox"]'),
  ).toHaveLength(52);
});

it("prevents repeated deletion while pending and allows retry after failure", async () => {
  let reject: ((error: Error) => void) | undefined;
  api.deleteStorage.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await mount();
  await click("Review");
  await click("Continue");
  await click("Delete permanently");
  expect(button("Deleting…").disabled).toBe(true);
  expect(api.deleteStorage).toHaveBeenCalledOnce();
  await act(async () => reject?.(new Error("unavailable")));
  expect(
    document.querySelector('[role="alertdialog"] [role="alert"]'),
  ).not.toBeNull();
  await click("Delete permanently");
  expect(api.deleteStorage).toHaveBeenCalledTimes(2);
});

it.each([
  ["zh-CN", "存储空间"],
  ["zh-TW", "儲存空間"],
  ["en-US", "Storage"],
  ["ja-JP", "ストレージ"],
  ["ko-KR", "저장 공간"],
])("renders the Storage page in %s", async (locale, title) => {
  await changeLimeLocale(locale);
  await mount();
  expect(container.querySelector("h1")?.textContent).toBe(title);
  expect(container.textContent).not.toMatch(/settings\.storage\./);
});
