import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isIP } from "node:net";

/** Package the native build; no download service or alternate runtime is involved. */
export async function packageLinuxGuest(payloadRoot, { downloadUrl } = {}) {
  if (downloadUrl !== undefined) {
    if (
      typeof downloadUrl !== "string" ||
      downloadUrl.length > 4096 ||
      /[\s\x7f]/u.test(downloadUrl) ||
      [...downloadUrl].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("A public HTTPS artifact URL is required");
    const url = new URL(downloadUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== "443") ||
      !url.hostname.includes(".") ||
      !/^[a-z0-9.-]+$/iu.test(url.hostname) ||
      isIP(url.hostname.replace(/^\[|\]$/gu, ""))
    )
      throw new Error(
        "A public HTTPS artifact URL without credentials or query is required",
      );
    downloadUrl = url.toString();
    if (downloadUrl.length > 4096)
      throw new Error("A public HTTPS artifact URL is too long");
  }
  if (!path.isAbsolute(payloadRoot) || !lstatSync(payloadRoot).isDirectory())
    throw new Error("An absolute guest payload directory is required");
  const manifest = readFileSync(path.join(payloadRoot, "guest-manifest.json"));
  const archive = payloadRoot + ".tar.gz";
  // Refuse overwrite, including symlinks and interrupted previous packages.
  const descriptor = openSync(archive, "wx", 0o600);
  try {
    const result = spawnSync(
      "tar",
      [
        "--format=ustar",
        "--create",
        "--gzip",
        "--file=-",
        "--directory",
        path.dirname(payloadRoot),
        "--",
        path.basename(payloadRoot),
      ],
      { shell: false, stdio: ["ignore", descriptor, "pipe"] },
    );
    if (result.error || result.status !== 0)
      throw new Error("Linux guest archive packaging failed");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(archive)) digest.update(chunk);
  const receipt = {
    schemaVersion: 1,
    archive: path.basename(archive),
    archiveBytes: lstatSync(archive).size,
    archiveSha256: digest.digest("hex"),
    manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    ...(downloadUrl ? { downloadUrl } : {}),
  };
  writeFileSync(archive + ".json", JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return receipt;
}
