import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import {
  BROWSER_HISTORY_MAX_ENTRIES,
  BROWSER_HISTORY_MAX_FILE_BYTES,
  BROWSER_HISTORY_MAX_VISITS,
  assertBrowserHistoryTimestamp,
  normalizeBrowserHistoryTitle,
  normalizeBrowserHistoryUrl,
  parseBrowserHistoryClear,
  parseBrowserHistoryIds,
  parseBrowserHistoryQuery,
  type BrowserHistoryClear,
  type BrowserHistoryEntry,
  type BrowserHistoryMutationResult,
  type BrowserHistoryPage,
  type BrowserHistoryQuery,
  type BrowserHistoryVisit,
} from "../src/lib/api/browserHistoryTypes";
import {
  persistedAtomFileIO,
  type PersistedAtomFileIO,
} from "./persistedAtomFile";

interface StoredEntry {
  id: string;
  url: string;
  title: string;
  visits: number[];
}
interface HistoryEnvelope {
  schemaVersion: 1;
  revision: number;
  entries: StoredEntry[];
}
export interface BrowserHistoryStoreOptions {
  io?: PersistedAtomFileIO;
  platform?: typeof process.platform;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  maxEntries?: number;
  maxVisits?: number;
}

/** One instance owns the user browser history file; all reads and writes share its queue. */
export class BrowserHistoryStore {
  readonly #file: string;
  readonly #io: PersistedAtomFileIO;
  readonly #platform: typeof process.platform;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;
  readonly #maxEntries: number;
  readonly #maxVisits: number;
  #state: HistoryEnvelope | null = null;
  #loadError: Error | null = null;
  #tail: Promise<void> = Promise.resolve();

  constructor(appDataRoot: string, options: BrowserHistoryStoreOptions = {}) {
    if (!appDataRoot.trim() || !path.isAbsolute(appDataRoot))
      throw new Error("Browser history requires the resolved AppDataRoot");
    this.#file = path.join(
      path.resolve(appDataRoot),
      "browser",
      "history.json",
    );
    this.#io = options.io ?? persistedAtomFileIO;
    this.#platform = options.platform ?? process.platform;
    this.#wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#now = options.now ?? Date.now;
    this.#maxEntries = boundedBudget(
      options.maxEntries,
      BROWSER_HISTORY_MAX_ENTRIES,
    );
    this.#maxVisits = boundedBudget(
      options.maxVisits,
      BROWSER_HISTORY_MAX_VISITS,
    );
  }

  recordVisit(input: BrowserHistoryVisit): Promise<BrowserHistoryEntry | null> {
    return this.#run(async () => {
      if (!input || typeof input !== "object" || typeof input.url !== "string")
        throw new Error("Invalid browser history visit");
      const url = normalizeBrowserHistoryUrl(input.url);
      if (!url) return null;
      const title = normalizeBrowserHistoryTitle(input.title);
      const visitedAt =
        input.visitedAt === undefined ? this.#now() : input.visitedAt;
      assertBrowserHistoryTimestamp(visitedAt);
      const state = await this.#load();
      const entries = cloneEntries(state.entries);
      let entry = entries.find((item) => item.url === url);
      if (entry) {
        entry.visits.push(visitedAt);
        entry.visits.sort((left, right) => left - right);
        if (title) entry.title = title;
      } else {
        entry = { id: randomUUID(), url, title, visits: [visitedAt] };
        entries.push(entry);
      }
      const retained = this.#trim(entries);
      await this.#save(retained);
      const saved = retained.find((item) => item.id === entry.id);
      return saved ? publicEntry(saved) : null;
    });
  }

  updateTitle(url: string, title: string): Promise<BrowserHistoryEntry | null> {
    return this.#run(async () => {
      const normalized = normalizeBrowserHistoryUrl(url);
      if (!normalized) return null;
      const nextTitle = normalizeBrowserHistoryTitle(title);
      const state = await this.#load();
      const existing = state.entries.find((item) => item.url === normalized);
      if (!existing) return null;
      if (nextTitle && existing.title !== nextTitle) {
        const entries = cloneEntries(state.entries);
        entries.find((item) => item.id === existing.id)!.title = nextTitle;
        await this.#save(entries);
        return publicEntry(entries.find((item) => item.id === existing.id)!);
      }
      return publicEntry(existing);
    });
  }

  list(input: BrowserHistoryQuery = {}): Promise<BrowserHistoryPage> {
    return this.#run(async () => {
      const { query, cursor, limit } = parseBrowserHistoryQuery(input);
      const state = await this.#load();
      let offset = 0;
      if (cursor !== null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(cursor);
        } catch {
          throw new Error("Invalid browser history cursor");
        }
        const page = decoded as {
          revision?: unknown;
          query?: unknown;
          offset?: unknown;
        } | null;
        if (
          !page ||
          typeof page !== "object" ||
          Array.isArray(page) ||
          Object.keys(page).some(
            (key) => !["revision", "query", "offset"].includes(key),
          ) ||
          page.query !== query ||
          typeof page.offset !== "number" ||
          !Number.isSafeInteger(page.offset) ||
          page.offset < 0 ||
          page.offset > this.#maxEntries
        )
          throw new Error("Invalid browser history cursor");
        if (page.revision !== state.revision)
          throw new Error("Browser history cursor is stale");
        offset = page.offset;
      }
      const terms = query.split(/\s+/u).filter(Boolean);
      const entries = state.entries
        .filter((entry) => {
          const haystack = `${entry.url}\n${entry.title}`
            .normalize("NFKC")
            .toLocaleLowerCase();
          return terms.every((term) => haystack.includes(term));
        })
        .sort(compareEntries);
      return {
        entries: entries.slice(offset, offset + limit).map(publicEntry),
        total: entries.length,
        revision: state.revision,
        nextCursor:
          offset + limit < entries.length
            ? JSON.stringify({
                revision: state.revision,
                query,
                offset: offset + limit,
              })
            : null,
      };
    });
  }

  remove(ids: readonly string[]): Promise<BrowserHistoryMutationResult> {
    return this.#run(async () => {
      const selected = new Set(parseBrowserHistoryIds(ids));
      const state = await this.#load();
      const entries = state.entries.filter((entry) => !selected.has(entry.id));
      const removedEntries = state.entries.length - entries.length;
      const removedVisits = state.entries
        .filter((entry) => selected.has(entry.id))
        .reduce((sum, entry) => sum + entry.visits.length, 0);
      if (removedEntries) await this.#save(entries);
      return { removedEntries, removedVisits, revision: this.#state!.revision };
    });
  }

  clear(
    input: BrowserHistoryClear = {},
  ): Promise<BrowserHistoryMutationResult> {
    return this.#run(async () => {
      const { since = 0 } = parseBrowserHistoryClear(input);
      const state = await this.#load();
      let removed = 0;
      const entries = state.entries
        .map((entry) => {
          const visits = entry.visits.filter((visitedAt) => visitedAt < since);
          removed += entry.visits.length - visits.length;
          return { ...entry, visits };
        })
        .filter((entry) => entry.visits.length);
      if (removed) await this.#save(entries);
      return {
        removedEntries: state.entries.length - entries.length,
        removedVisits: removed,
        revision: this.#state!.revision,
      };
    });
  }

  getRevision(): Promise<number> {
    return this.#run(async () => (await this.#load()).revision);
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation);
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async #load(): Promise<HistoryEnvelope> {
    if (this.#loadError) throw this.#loadError;
    if (this.#state) return this.#state;
    let bytes: Buffer;
    try {
      bytes = await this.#io.readFile(
        this.#file,
        BROWSER_HISTORY_MAX_FILE_BYTES,
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return (this.#state = { schemaVersion: 1, revision: 0, entries: [] });
      this.#loadError = new Error("Browser history file could not be read");
      throw this.#loadError;
    }
    try {
      if (bytes.byteLength > BROWSER_HISTORY_MAX_FILE_BYTES)
        throw new Error("History capacity exceeded");
      const source = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as Partial<HistoryEnvelope>;
      if (
        !source ||
        source.schemaVersion !== 1 ||
        typeof source.revision !== "number" ||
        !Number.isSafeInteger(source.revision) ||
        source.revision < 0 ||
        !Array.isArray(source.entries) ||
        source.entries.length > this.#maxEntries ||
        Object.keys(source).some(
          (key) => !["schemaVersion", "revision", "entries"].includes(key),
        )
      )
        throw new Error("Invalid history envelope");
      const ids = new Set<string>();
      const urls = new Set<string>();
      let visits = 0;
      for (const entry of source.entries) {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.id !== "string" ||
          !entry.id ||
          entry.id.length > 128 ||
          ids.has(entry.id) ||
          typeof entry.url !== "string" ||
          urls.has(entry.url) ||
          normalizeBrowserHistoryUrl(entry.url) !== entry.url ||
          typeof entry.title !== "string" ||
          normalizeBrowserHistoryTitle(entry.title) !== entry.title ||
          !Array.isArray(entry.visits) ||
          !entry.visits.length ||
          Object.keys(entry).some(
            (key) => !["id", "url", "title", "visits"].includes(key),
          )
        )
          throw new Error("Invalid history entry");
        ids.add(entry.id);
        urls.add(entry.url);
        for (let index = 0; index < entry.visits.length; index += 1) {
          assertBrowserHistoryTimestamp(entry.visits[index]);
          if (index && entry.visits[index] < entry.visits[index - 1])
            throw new Error("Unordered history visits");
        }
        visits += entry.visits.length;
        if (visits > this.#maxVisits)
          throw new Error("History capacity exceeded");
      }
      return (this.#state = source as HistoryEnvelope);
    } catch {
      this.#loadError = new Error(
        "Browser history file is corrupt or exceeds its storage budget",
      );
      throw this.#loadError;
    }
  }

  #trim(entries: StoredEntry[]): StoredEntry[] {
    let retained = entries.sort(compareEntries).slice(0, this.#maxEntries);
    const visits = retained.flatMap((entry) =>
      entry.visits.map((at) => ({ id: entry.id, at })),
    );
    const excess = visits.length - this.#maxVisits;
    if (excess > 0) {
      visits.sort(
        (left, right) => left.at - right.at || left.id.localeCompare(right.id),
      );
      const removed = new Map<string, number>();
      for (const visit of visits.slice(0, excess))
        removed.set(visit.id, (removed.get(visit.id) ?? 0) + 1);
      retained = retained
        .map((entry) => ({
          ...entry,
          visits: entry.visits.slice(removed.get(entry.id) ?? 0),
        }))
        .filter((entry) => entry.visits.length);
    }
    return retained;
  }

  async #save(entries: StoredEntry[]): Promise<void> {
    const current = this.#state!;
    if (JSON.stringify(current.entries) === JSON.stringify(entries)) return;
    if (current.revision >= Number.MAX_SAFE_INTEGER)
      throw new Error("Browser history revision capacity exceeded");
    const next: HistoryEnvelope = {
      schemaVersion: 1,
      revision: current.revision + 1,
      entries,
    };
    const data = JSON.stringify(next);
    if (Buffer.byteLength(data, "utf8") > BROWSER_HISTORY_MAX_FILE_BYTES)
      throw new Error("Browser history storage budget exceeded");
    const temporary = `${this.#file}.${process.pid}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      await this.#io.mkdir(path.dirname(this.#file));
      await this.#io.writeFile(temporary, data);
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.#io.rename(temporary, this.#file);
          break;
        } catch (error) {
          if (
            this.#platform !== "win32" ||
            !["EPERM", "EACCES", "EBUSY"].includes(errorCode(error)) ||
            attempt >= 3
          )
            throw error;
          await this.#wait(50 * 2 ** attempt);
        }
      }
      renamed = true;
      this.#state = next;
    } catch {
      throw new Error("Browser history could not be saved");
    } finally {
      if (!renamed)
        await this.#io.removeTemporary(temporary).catch(() => undefined);
    }
  }
}

function boundedBudget(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error("Invalid browser history storage budget");
  return value;
}
function publicEntry(entry: StoredEntry): BrowserHistoryEntry {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    visitCount: entry.visits.length,
    firstVisitedAt: entry.visits[0],
    lastVisitedAt: entry.visits[entry.visits.length - 1],
  };
}
function cloneEntries(entries: StoredEntry[]): StoredEntry[] {
  return entries.map((entry) => ({ ...entry, visits: [...entry.visits] }));
}
function compareEntries(left: StoredEntry, right: StoredEntry): number {
  return (
    right.visits[right.visits.length - 1] -
      left.visits[left.visits.length - 1] || left.id.localeCompare(right.id)
  );
}
function errorCode(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "IO_ERROR";
}
