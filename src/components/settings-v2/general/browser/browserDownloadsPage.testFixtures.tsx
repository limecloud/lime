import { act } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type {
  BrowserDownloadEntry,
  BrowserDownloadsChange,
  BrowserDownloadsPage as DownloadsPage,
} from "@/lib/api/browserDownloads";
import { createBrowserComponentHarness } from "@/components/agent/chat/workspace/right-surface/browser/browserWorkspace.testFixtures";
import { BrowserDownloadsPage } from "./BrowserDownloadsPage";

const service = vi.hoisted(() => ({
  list: vi.fn(),
  manage: vi.fn(),
  clear: vi.fn(),
  listen: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/api/browserDownloads", () => ({
  listBrowserDownloads: service.list,
  manageBrowserDownload: service.manage,
  clearBrowserDownloads: service.clear,
  listenBrowserDownloadsChanged: service.listen,
}));
vi.mock("sonner", () => ({ toast: { error: service.toastError } }));
const now = new Date(2026, 9, 22, 16).getTime();
let harness: ReturnType<typeof createBrowserComponentHarness>;
let receive: (change?: BrowserDownloadsChange) => void;
const stop = vi.fn();
const onBack = vi.fn();
function entry(
  id = "report",
  overrides: Partial<BrowserDownloadEntry> = {},
): BrowserDownloadEntry {
  return {
    id,
    url: `https://example.test/${id}.pdf`,
    filename: `${id}.pdf`,
    mimeType: "application/pdf",
    state: "completed",
    receivedBytes: 2048,
    totalBytes: 2048,
    startedAt: now,
    updatedAt: now,
    canPause: false,
    canResume: false,
    canCancel: false,
    fileExists: true,
    ...overrides,
  };
}
function page(
  entries = [entry()],
  nextOffset: number | null = null,
  revision = 1,
  historyRevision = revision,
): DownloadsPage {
  return {
    entries,
    total: nextOffset === null ? entries.length : nextOffset + 1,
    nextOffset,
    revision,
    historyRevision,
  };
}
const root = () => harness.query("browser-downloads-page");
const search = () =>
  root().querySelector<HTMLInputElement>("input[type=search]")!;
const row = (id: string) =>
  root().querySelector<HTMLElement>(`[data-download-id="${id}"]`)!;
function button(label: string, scope = root()): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing download action: ${label}`);
  return found;
}
const click = (target: HTMLButtonElement) =>
  act(async () => {
    target.click();
  });
const flush = (milliseconds = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
const render = () => harness.render(<BrowserDownloadsPage onBack={onBack} />);

export function setupBrowserDownloadsPageTests() {
  beforeEach(async () => {
    await changeLimeLocale("en-US");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    service.list.mockReset().mockResolvedValue(page());
    service.manage.mockReset().mockResolvedValue(undefined);
    service.clear.mockReset().mockResolvedValue(undefined);
    service.listen.mockReset().mockImplementation(async (handler) => {
      receive = (change = { kind: "invalidated" }) => handler(change);
      return stop;
    });
    harness = createBrowserComponentHarness();
  });
  afterEach(async () => {
    await harness.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await changeLimeLocale("zh-CN");
  });
}

export {
  service,
  now,
  harness,
  receive,
  stop,
  onBack,
  entry,
  page,
  root,
  search,
  row,
  button,
  click,
  flush,
  render,
};
