import { constants } from "node:fs";
import { copyFile, lstat, mkdir, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { StoredBrowserDownload } from "./browserDownloadsStore";
import {
  partialDownloadSize,
  type BrowserDownloadRecoveryRequest,
} from "./browserDownloadResume";

/** Owns private checkpoints; the original file is restored only with exclusive creation. */
export class BrowserDownloadFiles {
  readonly #directory: string;
  constructor(directory: string) {
    if (!path.isAbsolute(directory))
      throw new Error("Download checkpoints require a resolved directory");
    this.#directory = path.join(directory, "partials");
  }
  async available(entry: StoredBrowserDownload): Promise<boolean> {
    return (await this.#source(entry)) !== null;
  }
  async prepare(
    entry: StoredBrowserDownload,
  ): Promise<BrowserDownloadRecoveryRequest> {
    const source = await this.#source(entry);
    if (!source || !entry.resume || !entry.savePath || !entry.totalBytes)
      throw new Error("Browser download recovery file is unavailable");
    if (source.checkpoint) {
      await copyFile(
        this.#checkpoint(entry.id),
        entry.savePath,
        constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
      );
    }
    const actual = await regularFileSize(entry.savePath);
    if (actual !== source.size)
      throw new Error("Browser download recovery file changed");
    return {
      ...entry.resume,
      id: entry.id,
      path: entry.savePath,
      offset: actual,
      length: entry.totalBytes,
      mimeType: entry.mimeType,
    };
  }
  async preserve(entry: StoredBrowserDownload): Promise<void> {
    if (!entry.resume || !entry.savePath || entry.finished) return;
    const size = await regularFileSize(entry.savePath);
    if (size === null || !partialDownloadSize(size, entry.totalBytes)) return;
    await mkdir(this.#directory, { recursive: true });
    const checkpoint = this.#checkpoint(entry.id);
    const temporary = checkpoint + "." + randomUUID() + ".tmp";
    let moved = false;
    try {
      await copyFile(
        entry.savePath,
        temporary,
        constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
      );
      if (
        (await regularFileSize(temporary)) !== size ||
        (await regularFileSize(entry.savePath)) !== size
      )
        throw new Error("Browser download changed during checkpoint");
      await rename(temporary, checkpoint);
      moved = true;
    } finally {
      if (!moved) await unlink(temporary).catch(() => undefined);
    }
  }
  async remove(id: string): Promise<void> {
    await unlink(this.#checkpoint(id)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  async #source(
    entry: StoredBrowserDownload,
  ): Promise<{ size: number; checkpoint: boolean } | null> {
    if (
      !entry.resume ||
      !entry.savePath ||
      ["completed", "cancelled"].includes(entry.state)
    )
      return null;
    const actual = await regularFileSize(entry.savePath);
    if (actual !== null)
      return partialDownloadSize(actual, entry.totalBytes)
        ? { size: actual, checkpoint: false }
        : null;
    // Existing invalid files, including symbolic links, must never be replaced.
    if (
      await lstat(entry.savePath).then(
        () => true,
        (error) => error?.code !== "ENOENT",
      )
    )
      return null;
    const stored = await regularFileSize(this.#checkpoint(entry.id));
    return stored !== null && partialDownloadSize(stored, entry.totalBytes)
      ? { size: stored, checkpoint: true }
      : null;
  }
  #checkpoint(id: string): string {
    return path.join(
      this.#directory,
      createHash("sha256").update(id).digest("hex") + ".part",
    );
  }
}

async function regularFileSize(file: string): Promise<number | null> {
  return lstat(file).then(
    (info) =>
      info.isFile() && !info.isSymbolicLink() && Number.isSafeInteger(info.size)
        ? info.size
        : null,
    () => null,
  );
}
