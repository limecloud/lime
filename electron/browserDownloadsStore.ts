import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import {
  assertBrowserDownloadEntry,
  assertDownloadKeys,
  downloadRecord,
  nonNegative,
  MAX_DOWNLOAD_RECORDS,
  type BrowserDownloadEntry,
} from "../src/lib/api/browserDownloadsTypes";
import {
  persistedAtomFileIO,
  type PersistedAtomFileIO,
} from "./persistedAtomFile";
import {
  parseBrowserDownloadResume,
  type BrowserDownloadResumeData,
} from "./browserDownloadResume";

export type StoredBrowserDownload = Omit<
  BrowserDownloadEntry,
  "canPause" | "canResume" | "canCancel" | "fileExists"
> & {
  savePath: string | null;
  finished: boolean;
  resume: BrowserDownloadResumeData | null;
};
const MAX_BYTES = 8 * 1024 * 1024;

/** This file contains native DownloadItem facts, never renderer-supplied paths. */
export class BrowserDownloadsStore {
  readonly directory: string;
  readonly #file: string;
  readonly #io: PersistedAtomFileIO;
  #revision = 0;
  constructor(root: string, io = persistedAtomFileIO) {
    if (!path.isAbsolute(root))
      throw new Error("Browser downloads require resolved AppDataRoot");
    this.directory = path.join(root, "browser");
    this.#file = path.join(this.directory, "downloads.json");
    this.#io = io;
  }
  async load(): Promise<{
    entries: StoredBrowserDownload[];
    revision: number;
  }> {
    let bytes: Buffer;
    try {
      bytes = await this.#io.readFile(this.#file, MAX_BYTES);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { entries: [], revision: 0 };
      throw new Error("Browser downloads could not be read");
    }
    try {
      const record = downloadRecord(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      assertDownloadKeys(record, ["schemaVersion", "revision", "entries"]);
      if (
        bytes.byteLength > MAX_BYTES ||
        ![1, 2].includes(record.schemaVersion as number) ||
        !nonNegative(record.revision) ||
        !Array.isArray(record.entries) ||
        record.entries.length > MAX_DOWNLOAD_RECORDS
      )
        throw new Error("Invalid download file");
      const ids = new Set<string>();
      const entries = record.entries.map((value) => {
        const entry = downloadRecord(value);
        const { savePath, finished, resume: recovery, ...metadata } = entry;
        const resume =
          record.schemaVersion === 1
            ? null
            : parseBrowserDownloadResume(recovery);
        assertBrowserDownloadEntry({
          ...metadata,
          canPause: false,
          canResume: false,
          canCancel: false,
          fileExists: false,
        });
        if (
          typeof finished !== "boolean" ||
          (savePath !== null &&
            (typeof savePath !== "string" || !path.isAbsolute(savePath))) ||
          ids.has(metadata.id as string)
        )
          throw new Error("Invalid stored download");
        ids.add(metadata.id as string);
        // A cold process has no live item; native recovery is offered only after file checks.
        return {
          ...metadata,
          savePath,
          resume,
          finished: true,
          state: finished ? metadata.state : "interrupted",
        } as StoredBrowserDownload;
      });
      this.#revision = record.revision;
      return { entries, revision: record.revision };
    } catch {
      throw new Error(
        "Browser downloads file is corrupt or exceeds its storage budget",
      );
    }
  }
  async save(
    entries: StoredBrowserDownload[],
    revision: number,
  ): Promise<void> {
    if (
      !nonNegative(revision) ||
      revision <= this.#revision ||
      entries.length > MAX_DOWNLOAD_RECORDS
    )
      throw new Error("Invalid Browser downloads revision or capacity");
    const data = JSON.stringify({ schemaVersion: 2, revision, entries });
    if (Buffer.byteLength(data) > MAX_BYTES)
      throw new Error("Browser downloads storage budget exceeded");
    const temporary = `${this.#file}.${process.pid}.${randomUUID()}.tmp`;
    let saved = false;
    try {
      await this.#io.mkdir(path.dirname(this.#file));
      await this.#io.writeFile(temporary, data);
      for (let attempt = 0; ; attempt++) {
        try {
          await this.#io.rename(temporary, this.#file);
          break;
        } catch (error) {
          if (
            process.platform !== "win32" ||
            !["EPERM", "EACCES", "EBUSY"].includes(errorCode(error)) ||
            attempt >= 3
          )
            throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 50 * 2 ** attempt),
          );
        }
      }
      saved = true;
      this.#revision = revision;
    } finally {
      if (!saved)
        await this.#io.removeTemporary(temporary).catch(() => undefined);
    }
  }
}
function errorCode(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "IO_ERROR";
}
