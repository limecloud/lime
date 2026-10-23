import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { DictationHistory } from "./DictationHistory";
import { selectDictationHistory } from "@/lib/dictationHistoryRecovery";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
  credentials: vi.fn(),
  recover: vi.fn(),
  download: vi.fn(),
  toast: vi.fn(),
  clipboard: vi.fn(),
}));
vi.mock("@/lib/api/dictationHistory", () => ({
  listDictationHistory: api.list,
  readDictationHistoryAudio: api.read,
  deleteDictationHistory: api.remove,
}));
vi.mock("@/lib/api/asrProvider", () => ({
  getAsrCredentials: api.credentials,
}));
vi.mock("@/lib/dictationHistoryRecovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dictationHistoryRecovery")>()),
  recoverDictationHistory: api.recover,
}));
vi.mock("@/lib/artifact/downloadBlob", () => ({ downloadBlob: api.download }));
vi.mock("sonner", () => ({ toast: { error: api.toast } }));

const entries = [
  {
    id: "saved",
    createdAtMs: 1700000000000,
    text: "已完成的听写",
    sizeBytes: 12,
    status: "saved",
    mimeType: "audio/webm",
  },
  {
    id: "failed",
    createdAtMs: 1700000001000,
    text: null,
    sizeBytes: 8,
    status: "interrupted",
    mimeType: "audio/webm",
  },
  {
    id: "active",
    createdAtMs: 1700000002000,
    text: null,
    sizeBytes: 4,
    status: "recording",
    mimeType: "audio/webm",
  },
  {
    id: "empty",
    createdAtMs: 1700000003000,
    text: null,
    sizeBytes: 0,
    status: "cancelled",
    mimeType: "audio/webm",
  },
];
let root: Root;
let container: HTMLDivElement;
let clipboardDescriptor: PropertyDescriptor | undefined;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  )!;
const key = (name: string) =>
  getLimeI18n().t(`settings.voice.history.${name}`, { ns: "settings" });
async function render() {
  act(() => root.render(<DictationHistory />));
  await flush();
}

beforeEach(async () => {
  vi.resetAllMocks();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
  selectDictationHistory(null);
  api.list.mockResolvedValue(entries);
  api.credentials.mockResolvedValue([{ is_default: true, disabled: false }]);
  api.read.mockResolvedValue(new Blob(["audio"], { type: "audio/webm" }));
  api.recover.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
  api.clipboard.mockResolvedValue(undefined);
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: api.clipboard },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  selectDictationHistory(null);
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("recent dictation recordings", () => {
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s presents localized statuses, dates and accessible actions",
    async (locale) => {
      await changeLimeLocale(locale);
      await render();
      expect(container.textContent).toContain(key("label"));
      expect(container.textContent).toContain(key("status.interrupted"));
      expect(container.textContent).toContain(key("status.recording"));
      expect(container.textContent).toContain(key("status.cancelled"));
      expect(container.textContent).not.toContain("settings.voice.history.");
      expect(container.querySelectorAll("time")).toHaveLength(4);
      expect(
        container.querySelector(
          '[data-settings-search-target="voice-history"]',
        ),
      ).not.toBeNull();
      expect(button(key("copy"))).toBeDefined();
      expect(
        container.querySelectorAll(`[aria-label="${key("retryAria")}"]`),
      ).toHaveLength(1);
    },
  );

  it("copies the saved transcript, locks actions during retry and refreshes the same history", async () => {
    await render();
    act(() => button(key("copy")).click());
    await flush();
    expect(api.clipboard).toHaveBeenCalledWith("已完成的听写");
    let resolve!: () => void;
    api.recover.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    act(() => button(key("retryAria")).click());
    await flush();
    expect(api.recover).toHaveBeenCalledWith("failed");
    expect(
      [...container.querySelectorAll("button")].every((b) => b.disabled),
    ).toBe(true);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    resolve();
    await flush();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(button(key("copy")).disabled).toBe(false);
  });

  it("shows a selected recovery expanded, downloads original bytes and returns to all recordings", async () => {
    selectDictationHistory("saved");
    await render();
    expect(container.querySelectorAll("time")).toHaveLength(1);
    expect(container.querySelector(".whitespace-pre-wrap")).not.toBeNull();
    act(() => button(key("downloadAudio")).click());
    await flush();
    expect(api.read).toHaveBeenCalledWith("saved");
    expect(api.download).toHaveBeenCalledWith(
      expect.any(Blob),
      "dictation-saved.webm",
    );
    act(() => button(key("showAll")).click());
    await flush();
    expect(container.querySelectorAll("time")).toHaveLength(4);
    expect(new URLSearchParams(window.location.search).has("recording")).toBe(
      false,
    );
  });

  it("supports keyboard menu deletion and protects in-progress recordings", async () => {
    await render();
    const menus = [
      ...container.querySelectorAll<HTMLButtonElement>(
        `[aria-label="${key("actions")}"]`,
      ),
    ];
    act(() =>
      menus[2].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    await flush();
    const activeItems = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    expect(
      activeItems
        .find((item) => item.textContent === key("delete"))
        ?.hasAttribute("data-disabled"),
    ).toBe(true);
    expect(
      activeItems
        .find((item) => item.textContent === key("download"))
        ?.hasAttribute("data-disabled"),
    ).toBe(false);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await flush();
    act(() =>
      menus[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    await flush();
    const remove = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === key("delete"))!;
    expect(remove).toBeDefined();
    act(() => remove.click());
    await flush();
    expect(api.remove).toHaveBeenCalledWith("saved");
  });

  it("allows load and action failure retries without discarding the list", async () => {
    api.list.mockRejectedValueOnce(new Error("unavailable"));
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    act(() =>
      button(
        getLimeI18n().t("settings.voice.page.retry", { ns: "settings" }),
      ).click(),
    );
    await flush();
    expect(container.querySelectorAll("time")).toHaveLength(4);
    api.recover.mockRejectedValueOnce(new Error("offline"));
    act(() => button(key("retryAria")).click());
    await flush();
    expect(api.toast).toHaveBeenCalledWith(key("actionError"));
    expect(container.querySelectorAll("time")).toHaveLength(4);
    act(() => button(key("retryAria")).click());
    await flush();
    expect(api.recover).toHaveBeenCalledTimes(2);
  });
});
