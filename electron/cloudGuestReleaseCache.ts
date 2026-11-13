import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { CloudGuestPreparationStatus } from "../src/lib/desktop-host/cloudDesktopConnection";
import {
  openCloudGuestArtifact,
  type CloudGuestSource,
} from "./cloudGuestArtifact";
import {
  openCloudGuestReleaseArchive,
  selectCloudGuestRelease,
} from "./cloudGuestRelease";

const unavailable = () => new Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE");
const invalid = () => new Error("CLOUD_INSTALL_PACKAGE_INVALID");

/** Public release bytes only. No cloud identity, signed URLs or user backups. */
export class CloudGuestReleaseCache {
  #job?: Promise<void>;
  #controller?: AbortController;
  #source?: CloudGuestSource;
  #stopping = false;
  #status: CloudGuestPreparationStatus;

  constructor(
    readonly root: string,
    readonly version: string,
    readonly fetchDocument: typeof fetch = fetch,
  ) {
    if (
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version) ||
      version.length > 64
    )
      throw unavailable();
    this.#status = {
      kind: "guestPreparation",
      version,
      phase: "idle",
      busy: false,
    };
  }

  status(): CloudGuestPreparationStatus {
    return { ...this.#status };
  }

  /** Starting preparation does not wait for the download or create a paid VM. */
  prepare(): CloudGuestPreparationStatus {
    if (this.#stopping) throw unavailable();
    if (this.#job) return this.status();
    this.#source = undefined;
    this.#status = {
      kind: "guestPreparation",
      version: this.version,
      phase: "checking",
      busy: true,
    };
    const controller = new AbortController();
    this.#controller = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(15 * 60_000),
    ]);
    this.#job = this.#prepare(signal)
      .catch((error: unknown) => {
        this.#source = undefined;
        this.#status = {
          ...this.#status,
          phase: "failed",
          diagnostic:
            error instanceof Error &&
            error.message === "CLOUD_INSTALL_PACKAGE_INVALID"
              ? error.message
              : "CLOUD_INSTALL_RELEASE_UNAVAILABLE",
        };
      })
      .finally(() => {
        this.#status.busy = false;
        this.#job = undefined;
        this.#controller = undefined;
      });
    return this.status();
  }

  /** Re-check cached bytes before handing them to an installation or transport. */
  async source(): Promise<CloudGuestSource> {
    if (this.#stopping) throw unavailable();
    this.prepare();
    await this.#job;
    if (!this.#source || this.#status.phase !== "ready")
      throw new Error(
        this.#status.diagnostic ?? "CLOUD_INSTALL_RELEASE_UNAVAILABLE",
      );
    return { ...this.#source, artifact: { ...this.#source.artifact } };
  }

  async #directory(): Promise<string> {
    let directory = this.root;
    for (const segment of ["cloud-runtime-releases", this.version]) {
      directory = path.join(directory, segment);
      await mkdir(directory, { mode: 0o700 }).catch(async (error: unknown) => {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
      });
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (process.platform !== "win32" &&
          (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))
      )
        throw invalid();
    }
    return directory;
  }

  async #prepare(signal: AbortSignal): Promise<void> {
    const source = await selectCloudGuestRelease(
      this.version,
      this.fetchDocument,
      signal,
    );
    signal.throwIfAborted();
    const directory = await this.#directory();
    const archive = `lime-guest-linux-x64-${this.version}.tar.gz`;
    const target = path.join(directory, archive);
    const receipt = JSON.stringify({
      schemaVersion: 1,
      archive,
      ...source.artifact,
      downloadUrl: source.downloadUrl,
    });
    this.#status.totalBytes = source.artifact.archiveBytes;
    // A descriptor fetched from the official release, never a mutable local
    // digest receipt, supplies the expected hashes on every reuse.
    try {
      this.#status.phase = "verifying";
      const cached = await openCloudGuestArtifact(target, source.artifact);
      await cached.file.close();
      signal.throwIfAborted();
      this.#source = { ...source, artifactPath: target };
      this.#status = {
        ...this.#status,
        phase: "ready",
        receivedBytes: source.artifact.archiveBytes,
      };
      return;
    } catch {
      signal.throwIfAborted();
    }

    const partial = path.join(directory, `${randomUUID()}.partial`);
    const partialReceipt = partial + ".json";
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(
        partial,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      this.#status.phase = "downloading";
      this.#status.receivedBytes = 0;
      const response = await openCloudGuestReleaseArchive(
        source,
        signal,
        this.fetchDocument,
      );
      const length = response.headers.get("content-length");
      if (
        (length !== null &&
          (!/^\d+$/u.test(length) ||
            Number(length) !== source.artifact.archiveBytes)) ||
        !response.body
      ) {
        await response.body?.cancel();
        throw invalid();
      }
      const hash = createHash("sha256");
      const reader = response.body.getReader();
      let received = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          received += part.value.byteLength;
          if (received > source.artifact.archiveBytes) throw invalid();
          // FileHandle.write may be partial; writeFile consumes the entire block.
          await file.writeFile(part.value);
          hash.update(part.value);
          this.#status.receivedBytes = received;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      this.#status.phase = "verifying";
      if (
        received !== source.artifact.archiveBytes ||
        hash.digest("hex") !== source.artifact.archiveSha256
      )
        throw invalid();
      signal.throwIfAborted();
      await file.sync();
      await file.close();
      file = undefined;
      const descriptor = await open(partialReceipt, "wx", 0o600);
      try {
        await descriptor.writeFile(receipt);
        await descriptor.sync();
      } finally {
        await descriptor.close();
      }
      // Failed replacement leaves at least one invalid/missing pair. A future
      // prepare verifies both again and cannot bless a partially published cache.
      await rename(partial, target);
      await rename(partialReceipt, target + ".json");
      this.#source = { ...source, artifactPath: target };
      this.#status.phase = "ready";
    } finally {
      await file?.close().catch(() => undefined);
      await rm(partial, { force: true }).catch(() => undefined);
      await rm(partialReceipt, { force: true }).catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#controller?.abort();
    await this.#job;
  }
}
