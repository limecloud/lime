import { app } from "./electronRuntime";
import { resolveCurrentDesktopStorageRoots } from "./appDataPaths";
import { BrowserHistoryStore } from "./browserHistoryStore";
import {
  normalizeBrowserHistoryUrl,
  parseBrowserHistoryClear,
  type BrowserHistoryClear,
  type BrowserHistoryQuery,
} from "../src/lib/api/browserHistoryTypes";
import { parseBrowserHistoryVisitTargets } from "../src/lib/api/browserHistoryVisits";

export type BrowserHistoryCommand =
  | "browser_history_list"
  | "browser_history_remove"
  | "browser_history_clear";
export const BROWSER_HISTORY_COMMANDS: readonly BrowserHistoryCommand[] = [
  "browser_history_list",
  "browser_history_remove",
  "browser_history_clear",
];
export function isBrowserHistoryCommand(
  value: string,
): value is BrowserHistoryCommand {
  return BROWSER_HISTORY_COMMANDS.includes(value as BrowserHistoryCommand);
}

/** History is global user data, while only committed native browser routes may add visits. */
export class BrowserHistoryHost {
  readonly #createStore: () => BrowserHistoryStore;
  readonly #changed: (revision: number) => void;
  readonly #beforeRemove: () => Promise<void>;
  #store: BrowserHistoryStore | null = null;
  #tail: Promise<void> = Promise.resolve();
  #lastRevision = -1;
  readonly #committedUrls = new Map<string, string>();

  constructor(
    changed: (revision: number) => void,
    options: {
      createStore?: () => BrowserHistoryStore;
      beforeRemove?: () => Promise<void>;
    } = {},
  ) {
    this.#changed = changed;
    this.#beforeRemove = options.beforeRemove ?? (async () => undefined);
    this.#createStore =
      options.createStore ??
      (() =>
        new BrowserHistoryStore(
          resolveCurrentDesktopStorageRoots(app.getPath("userData"))
            .appDataRoot,
        ));
  }

  invoke(command: BrowserHistoryCommand, args: unknown = {}): Promise<unknown> {
    return this.#run(async (store) => {
      if (command === "browser_history_list") {
        if (
          args &&
          typeof args === "object" &&
          !Array.isArray(args) &&
          "view" in args
        ) {
          const { view, ...query } = args;
          if (view !== "visits")
            throw new Error("Invalid browser history view");
          return store.listVisits(query);
        }
        return store.list((args ?? {}) as BrowserHistoryQuery);
      }
      let result;
      if (command === "browser_history_remove") {
        if (
          !args ||
          typeof args !== "object" ||
          Array.isArray(args) ||
          Object.keys(args).length !== 1 ||
          !("entries" in args)
        )
          throw new Error("Invalid browser history visit removal");
        const entries = parseBrowserHistoryVisitTargets(args.entries);
        await this.#beforeRemove();
        result = await store.removeVisits(entries);
      } else {
        const request = parseBrowserHistoryClear(
          (args ?? {}) as BrowserHistoryClear,
        );
        await this.#beforeRemove();
        result = await store.clear(request);
      }
      this.#publish(result.revision);
      return result;
    });
  }

  committed(
    viewId: string,
    input: { url: string; title?: string; isActorVisit?: boolean },
  ): Promise<void> {
    const url = normalizeBrowserHistoryUrl(input.url);
    if (!url) {
      this.#committedUrls.delete(viewId);
      return Promise.resolve();
    }
    this.#committedUrls.set(viewId, url);
    return this.#run(async (store) => {
      if (
        await store.recordVisit({
          url,
          title: input.title,
          isActorVisit: input.isActorVisit,
        })
      )
        this.#publish(await store.getRevision());
    });
  }

  titleUpdated(viewId: string, url: string, title: string): Promise<void> {
    if (this.#committedUrls.get(viewId) !== normalizeBrowserHistoryUrl(url))
      return Promise.resolve();
    return this.#run(async (store) => {
      if (await store.updateTitle(url, title))
        this.#publish(await store.getRevision());
    });
  }

  forget(viewId: string): void {
    this.#committedUrls.delete(viewId);
  }

  summarizeData(
    since: number,
  ): Promise<{ firstSite: string | null; siteCount: number }> {
    return this.#run((store) => store.summarizeData(since));
  }

  #publish(revision: number): void {
    if (revision === this.#lastRevision) return;
    this.#lastRevision = revision;
    this.#changed(revision);
  }

  #run<T>(operation: (store: BrowserHistoryStore) => Promise<T>): Promise<T> {
    const next = this.#tail.then(() =>
      operation((this.#store ??= this.#createStore())),
    );
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
