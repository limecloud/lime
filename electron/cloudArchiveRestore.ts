import { Buffer } from "node:buffer";
import { mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  CloudDesktopParams,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";
import type {
  CloudArchiveRestoreResult,
  CloudArchiveRestoreSelection,
} from "../src/lib/desktop-host/cloudDesktopConnection";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";

type RemoteRequest = (
  params: CloudDesktopParams,
  timeoutMs?: number,
) => Promise<CloudDesktopResponse>;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const maxBytes = 4 * 1024 ** 3 + 256 * 1024 ** 2;

export function validateRestoreSelection(
  input: CloudArchiveRestoreSelection,
): CloudArchiveRestoreSelection {
  if (
    typeof input.archivePath !== "string" ||
    !path.isAbsolute(input.archivePath) ||
    path.extname(input.archivePath) !== ".age" ||
    input.archivePath.length > 4096 ||
    typeof input.identityFile !== "string" ||
    !path.isAbsolute(input.identityFile) ||
    input.identityFile.length > 4096 ||
    typeof input.expectedSha256 !== "string" ||
    !sha256Pattern.test(input.expectedSha256) ||
    typeof input.folderName !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(input.folderName) ||
    input.confirmed !== true
  )
    throw new Error("CLOUD_ARCHIVE_INVALID_RESTORE_SELECTION");
  return {
    archivePath: input.archivePath,
    identityFile: input.identityFile,
    expectedSha256: input.expectedSha256,
    folderName: input.folderName,
    confirmed: true,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

export async function restoreCloudArchive(
  selection: CloudArchiveRestoreSelection,
  local: CloudDesktopRequest,
  remote: RemoteRequest,
  signal: AbortSignal,
): Promise<CloudArchiveRestoreResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "lime-restore-"));
  const staged = path.join(dir, "upload.age");
  let archiveId: string | undefined;
  let finishSubmitted = false;
  try {
    signal.throwIfAborted();
    const start = record(
      (
        await remote({
          action: "beginArchiveRestore",
          folderName: selection.folderName,
        })
      ).data,
    );
    if (
      typeof start.archiveId === "string" &&
      /^[a-f0-9-]{36}$/.test(start.archiveId)
    )
      archiveId = start.archiveId;
    const { recipient, chunkBytes } = start;
    if (
      !archiveId ||
      typeof recipient !== "string" ||
      !/^age1[a-z0-9]{58}$/.test(recipient) ||
      typeof chunkBytes !== "number" ||
      !Number.isSafeInteger(chunkBytes) ||
      chunkBytes < 16 * 1024 ||
      chunkBytes > 256 * 1024
    )
      throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
    // Only this local request sees the original archive or identity paths.
    const prepared = record(
      (
        await local({
          action: "rewrapArchiveForRestore",
          archivePath: selection.archivePath,
          identityFile: selection.identityFile,
          expectedSha256: selection.expectedSha256,
          outputPath: staged,
          recipient,
        })
      ).data,
    );
    const { bytes, sha256 } = prepared;
    if (
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > maxBytes ||
      typeof sha256 !== "string" ||
      !sha256Pattern.test(sha256)
    )
      throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
    const file = await open(staged, "r");
    try {
      if ((await file.stat()).size !== bytes)
        throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
      const chunk = Buffer.alloc(chunkBytes);
      for (let offset = 0; offset < bytes; offset += chunkBytes) {
        signal.throwIfAborted();
        const expected = Math.min(chunkBytes, bytes - offset);
        let total = 0;
        while (total < expected) {
          const { bytesRead } = await file.read(
            chunk,
            total,
            expected - total,
            offset + total,
          );
          if (!bytesRead) throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
          total += bytesRead;
        }
        const written = record(
          (
            await remote({
              action: "writeArchiveRestore",
              archiveId,
              offset,
              data: chunk.subarray(0, expected).toString("base64"),
            })
          ).data,
        );
        if (written.receivedBytes !== offset + expected)
          throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
      }
    } finally {
      await file.close();
    }
    signal.throwIfAborted();
    finishSubmitted = true;
    const result = record(
      (
        await remote(
          {
            action: "finishArchiveRestore",
            archiveId,
            sha256,
            bytes,
          },
          10 * 60_000,
        )
      ).data,
    );
    if (
      typeof result.destination !== "string" ||
      !result.destination.endsWith("/lime-restored-" + selection.folderName) ||
      typeof result.files !== "number" ||
      !Number.isSafeInteger(result.files) ||
      result.files < 1 ||
      result.requiresApplicationValidation !== true
    )
      throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
    return {
      kind: "archiveRestore",
      destination: result.destination,
      files: result.files,
      requiresApplicationValidation: true,
    };
  } catch {
    throw new Error(
      finishSubmitted
        ? "CLOUD_ARCHIVE_RESTORE_INSPECT_FOLDER"
        : "CLOUD_ARCHIVE_RESTORE_FAILED",
    );
  } finally {
    await unlink(staged).catch(() => undefined);
    await rmdir(dir).catch(() => undefined);
    if (archiveId && !signal.aborted && !finishSubmitted)
      await remote({ action: "cancelArchiveRestore", archiveId }, 3_000).catch(
        () => undefined,
      );
  }
}
