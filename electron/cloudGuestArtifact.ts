import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";

export type CloudGuestArtifact = {
  archiveBytes: number;
  archiveSha256: string;
  manifestSha256: string;
};
export const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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

/** Open only a native selection or an encrypted recovery path. Caller owns the descriptor. */
export async function openCloudGuestArtifact(
  name: string,
  expected?: CloudGuestArtifact,
): Promise<{ file: FileHandle; artifact: CloudGuestArtifact }> {
  let file: FileHandle | undefined;
  try {
    if (!path.isAbsolute(name) || !name.endsWith(".tar.gz"))
      throw new Error("invalid artifact path");
    const receiptFile = await regularFile(name + ".json", 8192);
    let value;
    try {
      value = JSON.parse(await receiptFile.readFile("utf8")) as Record<
        string,
        unknown
      >;
    } finally {
      await receiptFile.close();
    }
    if (
      !value ||
      Object.keys(value).length !== 5 ||
      value.schemaVersion !== 1 ||
      value.archive !== path.basename(name)
    )
      throw new Error("invalid artifact receipt");
    const artifact = validateArtifact(value);
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
