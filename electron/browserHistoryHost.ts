import { app } from "./electronRuntime";
import { resolveCurrentDesktopStorageRoots } from "./appDataPaths";
import { BrowserHistoryStore } from "./browserHistoryStore";
import { normalizeBrowserHistoryUrl, parseBrowserHistoryIds, type BrowserHistoryClear, type BrowserHistoryQuery } from "../src/lib/api/browserHistoryTypes";

export type BrowserHistoryCommand = "browser_history_list" | "browser_history_remove" | "browser_history_clear";
export const BROWSER_HISTORY_COMMANDS: readonly BrowserHistoryCommand[] = ["browser_history_list", "browser_history_remove", "browser_history_clear"];
export function isBrowserHistoryCommand(value: string): value is BrowserHistoryCommand {
  return BROWSER_HISTORY_COMMANDS.includes(value as BrowserHistoryCommand);
}

/** History is global user data, while only committed native browser routes may add visits. */
export class BrowserHistoryHost {
  readonly #createStore: () => BrowserHistoryStore;
  readonly #changed: (revision: number) => void;
  #store: BrowserHistoryStore | null = null;
  #tail: Promise<void> = Promise.resolve();
  #lastRevision = -1;
  readonly #committedUrls = new Map<string, string>();

  constructor(changed: (revision: number) => void, options: { createStore?: () => BrowserHistoryStore } = {}) {
    this.#changed = changed;
    this.#createStore = options.createStore ?? (() => new BrowserHistoryStore(resolveCurrentDesktopStorageRoots(app.getPath("userData")).appDataRoot));
  }

  invoke(command: BrowserHistoryCommand, args: unknown = {}): Promise<unknown> {
    return this.#run(async store => {
      if (command === "browser_history_list") return store.list((args ?? {}) as BrowserHistoryQuery);
      let result;
      if (command === "browser_history_remove") {
        if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => key !== "ids")) throw new Error("Invalid browser history remove request");
        result = await store.remove(parseBrowserHistoryIds((args as { ids?: unknown }).ids));
      } else result = await store.clear((args ?? {}) as BrowserHistoryClear);
      this.#publish(result.revision);
      return result;
    });
  }

  committed(viewId: string, input: { url: string; title?: string }): Promise<void> {
    const url = normalizeBrowserHistoryUrl(input.url);
    if (!url) { this.#committedUrls.delete(viewId); return Promise.resolve(); }
    this.#committedUrls.set(viewId, url);
    return this.#run(async store => {
      if (await store.recordVisit({ url, title: input.title })) this.#publish(await store.getRevision());
    });
  }

  titleUpdated(viewId: string, url: string, title: string): Promise<void> {
    if (this.#committedUrls.get(viewId) !== normalizeBrowserHistoryUrl(url)) return Promise.resolve();
    return this.#run(async store => {
      if (await store.updateTitle(url, title)) this.#publish(await store.getRevision());
    });
  }

  forget(viewId: string): void { this.#committedUrls.delete(viewId); }

  summarizeData(since: number): Promise<{ firstSite: string | null; siteCount: number }> {
    return this.#run(store => store.summarizeData(since));
  }

  #publish(revision: number): void {
    if (revision === this.#lastRevision) return;
    this.#lastRevision = revision;
    this.#changed(revision);
  }

  #run<T>(operation: (store: BrowserHistoryStore) => Promise<T>): Promise<T> {
    const next = this.#tail.then(() => operation(this.#store ??= this.#createStore()));
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }
}
