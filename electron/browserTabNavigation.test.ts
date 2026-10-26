// @vitest-environment node
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { BrowserTabNavigation } from "./browserTabNavigation";
import { BrowserNavigationStore } from "./browserNavigationStore";

const snapshot = {
  index: 0,
  entries: [{ url: "https://example.com/", title: "Page" }],
};
function fixture() {
  const store = {
    read: vi.fn(async () => structuredClone(snapshot)),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
  };
  const page = {
    isDestroyed: () => false,
    navigationHistory: {
      getAllEntries: () => snapshot.entries,
      getActiveIndex: () => snapshot.index,
      restore: vi.fn(async (): Promise<void> => undefined),
    },
  };
  return {
    store,
    page,
    native: page as unknown as WebContents,
    navigation: new BrowserTabNavigation(
      () => store as unknown as BrowserNavigationStore,
    ),
  };
}
describe("BrowserTabNavigation", () => {
  it("persists the selected tab again after switching away and back without navigation", async () => {
    const f = fixture();
    const other = {
      ...f.page,
      navigationHistory: {
        ...f.page.navigationHistory,
        getAllEntries: () => [
          { url: "https://other.example/", title: "Other" },
        ],
      },
    } as unknown as WebContents;
    f.navigation.capture("thread", true, f.native);
    f.navigation.capture("thread", true, other);
    f.navigation.capture("thread", true, f.native);
    expect(f.store.save).toHaveBeenCalledTimes(3);
    expect(f.store.save).toHaveBeenLastCalledWith("thread", snapshot);
  });
  it("captures the selected native page and does not recapture rendering-only state", async () => {
    const f = fixture();
    f.navigation.capture("thread", false, f.native);
    expect(f.store.save).not.toHaveBeenCalled();
    f.navigation.capture("thread", true, f.native);
    f.navigation.capture("thread", true, f.native);
    await f.navigation.flush();
    expect(f.store.save).toHaveBeenCalledExactlyOnceWith("thread", snapshot);
  });
  it("does not overwrite the saved stack during restore and resumes capture after it", async () => {
    const f = fixture();
    let finish!: () => void;
    f.page.navigationHistory.restore.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const saved = (await f.navigation.read("thread", snapshot.entries[0].url))!;
    const restoring = f.navigation.restore(f.native, saved);
    f.navigation.capture("thread", true, f.native);
    expect(f.store.save).not.toHaveBeenCalled();
    finish();
    expect(await restoring).toBe(true);
    f.navigation.capture("thread", true, f.native);
    expect(f.store.save).toHaveBeenCalledOnce();
  });
  it("never saves deleted visits again from a still-open controller", async () => {
    const f = fixture();
    f.navigation.capture("thread", true, f.native);
    await f.navigation.clear();
    f.store.save.mockClear();
    f.navigation.capture("thread", true, f.native);
    expect(f.store.save).not.toHaveBeenCalled();
    f.navigation.capture("thread", true, {
      ...f.page,
    } as unknown as WebContents);
    expect(f.store.save).toHaveBeenCalledOnce();
  });
  it("rejects a snapshot invalidated by history clearing before restoration", async () => {
    const f = fixture();
    const saved = (await f.navigation.read("thread", snapshot.entries[0].url))!;
    await f.navigation.clear();
    expect(await f.navigation.restore(f.native, saved)).toBe(false);
    expect(f.page.navigationHistory.restore).not.toHaveBeenCalled();
  });
  it("drops a delayed read that crosses history clearing", async () => {
    const f = fixture();
    let finish!: (value: typeof snapshot) => void;
    f.store.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const reading = f.navigation.read("thread", snapshot.entries[0].url);
    await f.navigation.clear();
    finish(snapshot);
    expect(await reading).toBeNull();
  });
});
