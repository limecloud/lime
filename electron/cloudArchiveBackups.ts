import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import type {
  CloudDesktopResource,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";
import {
  sameCloudDesktop,
  type CloudArchiveDownloadResult,
  type CloudDesktopConnectionRequest,
  type CloudReleaseBackup,
  type CloudReleaseWithBackupResult,
} from "../src/lib/desktop-host/cloudDesktopConnection";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";
import {
  ElectronEncryptedStateFile,
  type SafeStorageLike,
} from "./secureCredentialStore";

type Backup = CloudReleaseBackup & { localPath: string; bytes: number };
type SavedDownload = Extract<CloudArchiveDownloadResult, { canceled: false }>;
type ReleaseRequest = Extract<
  CloudDesktopConnectionRequest,
  { action: "releaseWithBackup" }
>;

const maxBytes = 4 * 1024 ** 3 + 256 * 1024 ** 2;
const sha256Pattern = /^[a-f0-9]{64}$/;

/** Keeps local archive evidence; the App Server still owns cloud release and its receipt. */
export class CloudArchiveBackups {
  readonly #pending = new Map<string, Promise<unknown>>();

  constructor(readonly safeStorage: SafeStorageLike) {}

  async #withState<T>(
    root: string,
    operation: (file: ElectronEncryptedStateFile) => Promise<T>,
  ): Promise<T> {
    const previous = this.#pending.get(root);
    const run = Promise.resolve(previous)
      .catch(() => undefined)
      .then(() =>
        operation(
          new ElectronEncryptedStateFile(
            root,
            "archive-backup.v1",
            this.safeStorage,
          ),
        ),
      );
    this.#pending.set(root, run);
    try {
      return await run;
    } finally {
      if (this.#pending.get(root) === run) this.#pending.delete(root);
    }
  }

  remember(root: string, saved: SavedDownload): Promise<void> {
    return this.#withState(root, (file) =>
      file.write({
        sha256: saved.sha256,
        savedAt: new Date().toISOString(),
        localPath: saved.localPath,
        bytes: saved.bytes,
      } satisfies Backup),
    );
  }

  read(root: string): Promise<CloudReleaseBackup | null> {
    return this.#withState(root, async (file) => {
      const backup = await readBackup(file);
      if (!backup) return null;
      const { sha256, savedAt, restoredTo } = backup;
      return { sha256, savedAt, restoredTo };
    });
  }

  markRestored(
    root: string,
    source: CloudDesktopResource,
    target: CloudDesktopResource,
    sha256: string,
  ): Promise<boolean> {
    if (sameCloudDesktop(source, target)) return Promise.resolve(false);
    return this.#withState(root, async (file) => {
      const backup = await readBackup(file);
      if (!backup || backup.sha256 !== sha256.toLowerCase()) return false;
      await file.write({ ...backup, restoredTo: target } satisfies Backup);
      return true;
    });
  }

  release(
    root: string,
    input: ReleaseRequest,
    request: CloudDesktopRequest,
    signal: AbortSignal,
  ): Promise<CloudReleaseWithBackupResult> {
    return this.#withState(root, async (file) => {
      const { resource, confirmation, operationId } = input;
      const response = (
        data: CloudDesktopResponse["data"],
      ): CloudReleaseWithBackupResult => ({
        kind: "releaseWithBackup",
        data,
      });
      const denied = () =>
        response({ outcome: "notSubmitted", submitted: false });
      if (
        input.applicationsValidated !== true ||
        input.workSaved !== true ||
        input.discardData !== true ||
        confirmation !==
          `release:${resource.regionId}:${resource.resourceId}:discard-data` ||
        typeof operationId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)
      )
        return denied();
      try {
        const backup = await readBackup(file);
        if (
          !backup?.restoredTo ||
          backup.sha256 !== input.archiveSha256 ||
          !input.restoredTo ||
          !sameCloudDesktop(input.restoredTo, backup.restoredTo) ||
          input.restoredTo.profile !== backup.restoredTo.profile ||
          sameCloudDesktop(resource, backup.restoredTo) ||
          !(await archiveMatches(backup, signal))
        )
          return denied();
        const { data } = await request({
          action: "inspect",
          resource: backup.restoredTo,
        });
        const status = (data as { status?: unknown } | null)?.status;
        if (status !== "Running" && status !== "Stopped") return denied();
        signal.throwIfAborted();
      } catch {
        return denied();
      }
      // Once submitted, errors are ambiguous; the caller must read this operation ID.
      return response(
        (
          await request({
            action: "release",
            resource,
            operationId,
            confirmation,
            workSaved: true,
            discardData: true,
          })
        ).data,
      );
    });
  }
}

async function readBackup(
  file: ElectronEncryptedStateFile,
): Promise<Backup | null> {
  const value = (await file.read()) as Partial<Backup> | null;
  if (value === null) return null;
  if (
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256) ||
    typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    typeof value.localPath !== "string" ||
    !path.isAbsolute(value.localPath) ||
    path.extname(value.localPath) !== ".age" ||
    typeof value.bytes !== "number" ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > maxBytes ||
    (value.restoredTo !== undefined && !validTarget(value.restoredTo))
  ) {
    throw new Error("invalid cloud archive backup record");
  }
  return value as Backup;
}

function validTarget(value: CloudDesktopResource): boolean {
  return (
    !!value &&
    ["ecs", "wuying"].includes(value.provider) &&
    [value.profile, value.regionId, value.resourceId].every(
      (field) =>
        typeof field === "string" &&
        field.length > 0 &&
        field.length <= 256 &&
        ![...field].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    )
  );
}

async function archiveMatches(
  backup: Backup,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const file = await open(
    backup.localPath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== backup.bytes) return false;
    const hash = createHash("sha256");
    let seen = 0;
    for await (const chunk of file.createReadStream({
      autoClose: false,
      end: backup.bytes - 1,
      signal,
    })) {
      seen += chunk.length;
      hash.update(chunk);
    }
    const after = await lstat(backup.localPath);
    return (
      after.isFile() &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs &&
      after.size === before.size &&
      seen === backup.bytes &&
      hash.digest("hex") === backup.sha256
    );
  } finally {
    await file.close();
  }
}
