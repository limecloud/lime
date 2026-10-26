import type { WebContents } from "electron";
import { app } from "./electronRuntime";
import { resolveCurrentDesktopStorageRoots } from "./appDataPaths";
import {
  BrowserNavigationStore,
  browserNavigationSnapshot,
  type BrowserNavigation,
} from "./browserNavigationStore";

/** Same native BrowserContext; the caller obtains fresh canonical tab/control identity. */
export class BrowserTabNavigation {
  #store: BrowserNavigationStore | null = null;
  readonly #suspended = new WeakSet<WebContents>();
  #observed = new Set<WebContents>();
  #last: string | null = null;
  #cleared = new WeakSet<WebContents>();
  #epoch = 0;
  readonly #snapshots = new WeakMap<BrowserNavigation, number>();

  constructor(
    private readonly createStore = () =>
      new BrowserNavigationStore(
        resolveCurrentDesktopStorageRoots(app.getPath("userData")).appDataRoot,
      ),
  ) {}

  async read(threadId: string, url: string): Promise<BrowserNavigation | null> {
    const epoch = this.#epoch;
    try {
      const snapshot = await this.#storage().read(threadId, url);
      if (epoch !== this.#epoch) return null;
      if (snapshot) this.#snapshots.set(snapshot, epoch);
      return snapshot;
    } catch {
      console.warn("[browser-tab-host] navigation recovery unavailable");
      return null;
    }
  }

  async restore(
    page: WebContents,
    snapshot: BrowserNavigation,
  ): Promise<boolean> {
    if (this.#snapshots.get(snapshot) !== this.#epoch) return false;
    this.#observed.add(page);
    this.#suspended.add(page);
    try {
      await page.navigationHistory.restore(snapshot);
    } finally {
      this.#suspended.delete(page);
    }
    return true;
  }

  capture(threadId: string, selected: boolean, page: WebContents): void {
    if (
      !selected ||
      this.#suspended.has(page) ||
      this.#cleared.has(page) ||
      page.isDestroyed()
    )
      return;
    this.#observed.add(page);
    for (const previous of this.#observed)
      if (previous.isDestroyed()) this.#observed.delete(previous);
    const snapshot = browserNavigationSnapshot(
      page.navigationHistory.getAllEntries(),
      page.navigationHistory.getActiveIndex(),
    );
    if (!snapshot) return;
    const key = JSON.stringify([threadId, snapshot]);
    if (this.#last === key) return;
    this.#last = key;
    void this.#storage()
      .save(threadId, snapshot)
      .catch(() => {
        if (this.#last === key) this.#last = null;
        console.warn("[browser-tab-host] navigation persistence failed");
      });
  }

  async clear(): Promise<void> {
    this.#epoch++;
    this.#last = null;
    // An open native controller can retain deleted visits. Do not save those again.
    for (const page of this.#observed) this.#cleared.add(page);
    this.#observed.clear();
    await this.#storage().clear();
  }

  async flush(): Promise<void> {
    await this.#store?.flush();
  }
  #storage(): BrowserNavigationStore {
    return (this.#store ??= this.createStore());
  }
}
