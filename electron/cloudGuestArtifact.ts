import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";

export type CloudGuestArtifact = {
  archiveBytes: number;
  archiveSha256: string;
  manifestSha256: string;
};
export type CloudGuestSource = {
  artifactPath?: string;
  artifact: CloudGuestArtifact;
  downloadUrl?: string;
};
export const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** A signed object URL may contain a secret query; keep it in Main's encrypted state. */
export function validateDownloadUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\s\x7f]/u.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !url.hostname.includes(".") ||
    !/^[a-z0-9.-]+$/iu.test(url.hostname) ||
    isIP(url.hostname.replace(/^\[|\]$/gu, ""))
  )
    throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
  const normalized = url.toString();
  if (normalized.length > 4096)
    throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
  return normalized;
}
export function validateArtifact(value: unknown): CloudGuestArtifact {
  const item = value as CloudGuestArtifact | null;
  if (
    !item ||
    !Number.isSafeInteger(item.archiveBytes) ||
    item.archiveBytes < 1 ||
    item.archiveBytes > 1024 ** 3 ||
    !isSha256(item.archiveSha256) ||
    !isSha256(item.manifestSha256)
  )
    throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
  return {
    archiveBytes: item.archiveBytes,
    archiveSha256: item.archiveSha256,
    manifestSha256: item.manifestSha256,
  };
}

async function regularFile(name: string, limit: number): Promise<FileHandle> {
  const file = await open(
    name,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size < 1 ||
      info.size > limit
    )
      throw new Error("invalid file");
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

export function parseCloudGuestReceipt(text: string, archive: string) {
  const value = JSON.parse(text) as Record<string, unknown>;
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.archive !== archive ||
    path.basename(archive) !== archive ||
    !archive.endsWith(".tar.gz") ||
    Object.keys(value).some(
      (key) =>
        ![
          "schemaVersion",
          "archive",
          "archiveBytes",
          "archiveSha256",
          "manifestSha256",
          "downloadUrl",
        ].includes(key),
    )
  )
    throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
  const artifact = validateArtifact(value);
  const downloadUrl =
    value.downloadUrl === undefined
      ? undefined
      : validateDownloadUrl(value.downloadUrl);
  return { artifact, downloadUrl };
}

async function receipt(name: string, archive: string) {
  const file = await regularFile(name, 8192);
  try {
    return parseCloudGuestReceipt(await file.readFile("utf8"), archive);
  } finally {
    await file.close();
  }
}

/** Native selection grants trust in the expected digests, never in a remote response. */
export async function selectCloudGuestSource(name: string): Promise<{
  artifactPath: string;
  artifact: CloudGuestArtifact;
  downloadUrl?: string;
}> {
  try {
    if (!path.isAbsolute(name)) throw new Error("invalid source");
    if (name.endsWith(".tar.gz.json")) {
      const value = await receipt(name, path.basename(name).slice(0, -5));
      if (!value.downloadUrl)
        throw new Error("CLOUD_INSTALL_DOWNLOAD_REQUIRED");
      return { artifactPath: name, ...value };
    }
    const opened = await openCloudGuestArtifact(name);
    await opened.file.close();
    const value = await receipt(name + ".json", path.basename(name));
    // Large artifacts cannot fit the supplier's default rate in the request budget.
    if (!value.downloadUrl && opened.artifact.archiveBytes > 8 * 1024 ** 2)
      throw new Error("CLOUD_INSTALL_DOWNLOAD_REQUIRED");
    return {
      artifactPath: name,
      artifact: opened.artifact,
      downloadUrl: value.downloadUrl,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error &&
        error.message === "CLOUD_INSTALL_DOWNLOAD_REQUIRED"
        ? error.message
        : "CLOUD_INSTALL_PACKAGE_INVALID",
    );
  }
}

/** Open only a native selection or an encrypted recovery path. Caller owns the descriptor. */
export async function openCloudGuestArtifact(
  name: string,
  expected?: CloudGuestArtifact,
): Promise<{ file: FileHandle; artifact: CloudGuestArtifact }> {
  let file: FileHandle | undefined;
  try {
    if (!path.isAbsolute(name) || !name.endsWith(".tar.gz"))
      throw new Error("invalid artifact path");
    const { artifact } = await receipt(name + ".json", path.basename(name));
    if (
      expected &&
      JSON.stringify(artifact) !== JSON.stringify(validateArtifact(expected))
    )
      throw new Error("changed artifact");
    file = await regularFile(name, 1024 ** 3);
    if ((await file.stat()).size !== artifact.archiveBytes)
      throw new Error("changed artifact");
    const digest = createHash("sha256");
    let bytes = 0;
    for await (const block of file.createReadStream({
      start: 0,
      autoClose: false,
    })) {
      bytes += block.length;
      if (bytes > artifact.archiveBytes) throw new Error("changed artifact");
      digest.update(block);
    }
    if (
      bytes !== artifact.archiveBytes ||
      digest.digest("hex") !== artifact.archiveSha256
    )
      throw new Error("changed artifact");
    return { file, artifact };
  } catch {
    await file?.close().catch(() => undefined);
    throw new Error("CLOUD_INSTALL_PACKAGE_INVALID");
  }
}
