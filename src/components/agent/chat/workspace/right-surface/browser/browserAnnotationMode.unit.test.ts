import { describe, expect, it } from "vitest";
import type { BrowserTabState } from "@/lib/api/browserTab";
import {
  browserAnnotationModeKey,
  BrowserAnnotationModeStore,
} from "./browserAnnotationMode";

const tab = {
  threadId: "thread",
  browserSessionId: "browser",
  tabId: "tab",
  viewId: "view",
  webContentsId: 2,
  ownerWebContentsId: 1,
  windowId: 3,
  pageRevision: 4,
} as BrowserTabState;
describe("browser annotation UI mode", () => {
  it("keeps intent across page revisions but isolates runtime and native tab ownership", () => {
    const key = browserAnnotationModeKey("session", "thread", tab);
    expect(
      browserAnnotationModeKey("session", "thread", {
        ...tab,
        pageRevision: 99,
      }),
    ).toBe(key);
    for (const change of [
      { tabId: "other" },
      { viewId: "other" },
      { webContentsId: 9 },
      { ownerWebContentsId: 8 },
      { windowId: 7 },
      { browserSessionId: "other" },
    ])
      expect(
        browserAnnotationModeKey("session", "thread", { ...tab, ...change }),
      ).not.toBe(key);
    expect(browserAnnotationModeKey("other", "thread", tab)).not.toBe(key);
    expect(browserAnnotationModeKey("session", "other", tab)).toBeNull();
  });
  it("publishes immutable mode snapshots, removes disabled entries and stays scoped to its store", () => {
    const store = new BrowserAnnotationModeStore(),
      other = new BrowserAnnotationModeStore();
    const before = store.getSnapshot();
    let updates = 0;
    const stop = store.subscribe(() => {
      updates += 1;
    });
    store.set("tab", true);
    store.set("tab", true);
    expect(updates).toBe(1);
    expect(before.has("tab")).toBe(false);
    expect(other.getSnapshot().size).toBe(0);
    store.set("tab", false);
    expect(store.getSnapshot().size).toBe(0);
    stop();
    store.set("tab", true);
    expect(updates).toBe(2);
  });
});
