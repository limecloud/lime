import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { link, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  CloudDesktopParams,
  CloudDesktopResponse,
} from "@limecloud/app-server-client";
import type {
  CloudArchiveDownloadResult,
  CloudArchiveSelection,
} from "../src/lib/desktop-host/cloudDesktopConnection";

const maxArchiveBytes = 4 * 1024 ** 3 + 256 * 1024 ** 2;
const maxChunkBytes = 256 * 1024;
const ageMagic = Buffer.from("age-encryption.org/v1\n");

export function validateArchiveSelection(
  input: CloudArchiveSelection,
): CloudArchiveSelection {
  if (
    typeof input.sourceRoot !== "string" ||
    !input.sourceRoot ||
    input.sourceRoot.length > 4096 ||
    !Array.isArray(input.paths) ||
    !input.paths.length ||
    input.paths.length > 128 ||
    input.paths.some(
      (item) => typeof item !== "string" || !item || item.length > 4096,
    ) ||
    typeof input.recipient !== "string" ||
    !/^age1[a-z0-9]{58}$/.test(input.recipient) ||
    input.workSaved !== true ||
    typeof input.includeCredentials !== "boolean"
  )
    throw new Error("CLOUD_ARCHIVE_INVALID_SELECTION");
  return {
    sourceRoot: input.sourceRoot,
    paths: input.paths,
    recipient: input.recipient,
    workSaved: true,
    includeCredentials: input.includeCredentials,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

export async function saveCloudArchive(
  destination: string,
  selection: CloudArchiveSelection,
  request: (
    params: CloudDesktopParams,
    timeoutMs?: number,
  ) => Promise<CloudDesktopResponse>,
  signal: AbortSignal,
): Promise<CloudArchiveDownloadResult> {
  if (!path.isAbsolute(destination) || path.extname(destination) !== ".age")
    throw new Error("CLOUD_ARCHIVE_INVALID_DESTINATION");
  const staging = await mkdtemp(
    path.join(path.dirname(destination), ".lime-archive-"),
  );
  const pending = path.join(staging, "backup.age");
  let archiveId: string | undefined;
  try {
    const metadata = record(
      (
        await request(
          { action: "prepareArchiveDownload", ...selection },
          10 * 60_000,
        )
      ).data,
    );
    const { archiveId: id, bytes, chunkBytes, sha256 } = metadata;
    if (typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)) archiveId = id;
    if (
      !archiveId ||
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      bytes < ageMagic.length ||
      bytes > maxArchiveBytes ||
      typeof chunkBytes !== "number" ||
      !Number.isSafeInteger(chunkBytes) ||
      chunkBytes < ageMagic.length ||
      chunkBytes > maxChunkBytes ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
    const hash = createHash("sha256");
    const file = await open(pending, "wx", 0o600);
    try {
      for (let offset = 0; offset < bytes; offset += chunkBytes) {
        signal.throwIfAborted();
        const chunk = record(
          (await request({ action: "readArchiveDownload", archiveId, offset }))
            .data,
        );
        const length = Math.min(chunkBytes, bytes - offset);
        if (
          chunk.archiveId !== archiveId ||
          chunk.offset !== offset ||
          typeof chunk.data !== "string" ||
          chunk.data.length !== 4 * Math.ceil(length / 3)
        )
          throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
        const data = Buffer.from(chunk.data, "base64");
        if (
          data.length !== length ||
          data.toString("base64") !== chunk.data ||
          (offset === 0 && !data.subarray(0, ageMagic.length).equals(ageMagic))
        )
          throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
        hash.update(data);
        await file.writeFile(data);
      }
      if (hash.digest("hex") !== sha256)
        throw new Error("CLOUD_ARCHIVE_INVALID_RESPONSE");
      await file.sync();
    } finally {
      await file.close();
    }
    signal.throwIfAborted();
    // Publish without replacing an existing local file, including symlinks.
    await link(pending, destination);
    return {
      kind: "archiveDownload",
      canceled: false,
      localPath: destination,
      bytes,
      sha256,
    };
  } finally {
    await unlink(pending).catch(() => undefined);
    await rmdir(staging).catch(() => undefined);
    if (archiveId && !signal.aborted)
      await request({ action: "closeArchiveDownload", archiveId }, 3_000).catch(
        () => undefined,
      );
  }
}
