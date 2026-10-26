import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import {
  persistedAtomFileIO,
  type PersistedAtomFileIO,
} from "./persistedAtomFile";

export interface BrowserNavigation {
  entries: { url: string; title: string }[];
  index: number;
}
type RecordEntry = BrowserNavigation & { threadId: string };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_THREADS = 100;
const MAX_ENTRIES = 50;

function url(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Keep only the contiguous HTTP(S) history around the active native document. */
export function browserNavigationSnapshot(
  entries: readonly { url: string; title: string }[],
  index: number,
): BrowserNavigation | null {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= entries.length ||
    !url(entries[index]?.url)
  )
    return null;
  let start = index,
    end = index + 1;
  while (start > 0 && url(entries[start - 1]?.url)) start--;
  while (end < entries.length && url(entries[end]?.url)) end++;
  start = Math.max(start, index - Math.floor(MAX_ENTRIES / 2));
  end = Math.min(end, start + MAX_ENTRIES);
  return {
    index: index - start,
    entries: entries.slice(start, end).map((entry) => ({
      url: url(entry.url)!,
      title: entry.title.slice(0, 512),
    })),
  };
}

/** Navigation hints only: no Chromium pageState, form values or control receipts. */
export class BrowserNavigationStore {
  readonly #file: string;
  readonly #io: PersistedAtomFileIO;
  readonly #platform: typeof process.platform;
  readonly #wait: (ms: number) => Promise<void>;
  #records: RecordEntry[] | null = null;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    appDataRoot: string,
    options: {
      io?: PersistedAtomFileIO;
      platform?: typeof process.platform;
      wait?: (ms: number) => Promise<void>;
    } = {},
  ) {
    if (!path.isAbsolute(appDataRoot))
      throw new Error("Navigation requires AppDataRoot");
    this.#file = path.join(appDataRoot, "browser", "navigation.json");
    this.#io = options.io ?? persistedAtomFileIO;
    this.#platform = options.platform ?? process.platform;
    this.#wait =
      options.wait ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  read(
    threadId: string,
    expectedUrl: string,
  ): Promise<BrowserNavigation | null> {
    return this.#run(async () => {
      const saved = (await this.#load()).find(
        (entry) => entry.threadId === threadId,
      );
      if (!saved || saved.entries[saved.index].url !== url(expectedUrl))
        return null;
      return {
        index: saved.index,
        entries: saved.entries.map((entry) => ({ ...entry })),
      };
    });
  }

  save(threadId: string, value: BrowserNavigation): Promise<void> {
    if (!threadId.trim() || threadId.length > 512)
      throw new Error("Invalid navigation thread");
    const snapshot = browserNavigationSnapshot(value.entries, value.index);
    if (!snapshot) throw new Error("Invalid navigation snapshot");
    return this.#run(async () => {
      const records = await this.#load();
      const next = { threadId, ...snapshot };
      if (
        JSON.stringify(records.find((entry) => entry.threadId === threadId)) ===
        JSON.stringify(next)
      )
        return;
      await this.#write(
        [next, ...records.filter((entry) => entry.threadId !== threadId)].slice(
          0,
          MAX_THREADS,
        ),
      );
    });
  }

  clear(): Promise<void> {
    return this.#run(() => this.#write([]));
  }
  async flush(): Promise<void> {
    await this.#tail;
  }

  #run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#tail.catch(() => undefined).then(action);
    this.#tail = next;
    return next;
  }

  async #load(): Promise<RecordEntry[]> {
    if (this.#records) return this.#records;
    let bytes: Buffer;
    try {
      bytes = await this.#io.readFile(this.#file, MAX_BYTES);
    } catch (error) {
      if (code(error) === "ENOENT") return (this.#records = []);
      throw new Error("Browser navigation could not be read");
    }
    try {
      if (bytes.length > MAX_BYTES) throw new Error("capacity");
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (
        !exact(parsed, ["schemaVersion", "records"]) ||
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.records) ||
        parsed.records.length > MAX_THREADS
      )
        throw new Error("envelope");
      const threads = new Set<string>();
      for (const record of parsed.records) {
        if (
          !exact(record, ["threadId", "entries", "index"]) ||
          typeof record.threadId !== "string" ||
          !record.threadId.trim() ||
          record.threadId.length > 512 ||
          threads.has(record.threadId) ||
          !Array.isArray(record.entries) ||
          !record.entries.length ||
          record.entries.length > MAX_ENTRIES ||
          typeof record.index !== "number" ||
          !Number.isSafeInteger(record.index) ||
          record.index < 0 ||
          record.index >= record.entries.length
        )
          throw new Error("record");
        threads.add(record.threadId);
        for (const entry of record.entries) {
          if (
            !exact(entry, ["url", "title"]) ||
            url(entry.url) !== entry.url ||
            typeof entry.title !== "string" ||
            entry.title.length > 512
          )
            throw new Error("entry");
        }
      }
      return (this.#records = parsed.records);
    } catch {
      throw new Error("Browser navigation file is corrupt");
    }
  }

  async #write(records: RecordEntry[]): Promise<void> {
    const data = JSON.stringify({ schemaVersion: 1, records });
    if (Buffer.byteLength(data) > MAX_BYTES)
      throw new Error("Browser navigation capacity exceeded");
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      await this.#io.mkdir(path.dirname(this.#file));
      await this.#io.writeFile(temporary, data);
      for (let attempt = 0; ; attempt++) {
        try {
          await this.#io.rename(temporary, this.#file);
          break;
        } catch (error) {
          if (
            this.#platform !== "win32" ||
            !["EPERM", "EBUSY", "EACCES"].includes(code(error) ?? "") ||
            attempt >= 3
          )
            throw error;
          await this.#wait(50 * 2 ** attempt);
        }
      }
      renamed = true;
      this.#records = records;
    } finally {
      if (!renamed)
        await this.#io.removeTemporary(temporary).catch(() => undefined);
    }
  }
}

function exact(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)),
  );
}
function code(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
