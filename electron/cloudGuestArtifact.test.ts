// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  selectCloudGuestSource,
  validateDownloadUrl,
} from "./cloudGuestArtifact";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lime-artifact-test-"));
  roots.push(root);
  const archive = path.join(root, "runtime.tar.gz");
  const receipt = {
    schemaVersion: 1,
    archive: path.basename(archive),
    archiveBytes: 128 * 1024 ** 2,
    archiveSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    downloadUrl:
      "https://assets.example.com/runtime.tar.gz?signature=synthetic-secret",
  };
  const descriptor = archive + ".json";
  await writeFile(descriptor, JSON.stringify(receipt));
  return { root, archive, descriptor, receipt };
}

describe("trusted cloud guest artifact selection", () => {
  it("selects a large download descriptor without requiring a local archive", async () => {
    const f = await fixture();
    const source = await selectCloudGuestSource(f.descriptor);
    expect(source.artifactPath).toBe(f.descriptor);
    expect(source.downloadUrl).toBe(f.receipt.downloadUrl);
    expect(source.artifact).toEqual({
      archiveBytes: f.receipt.archiveBytes,
      archiveSha256: f.receipt.archiveSha256,
      manifestSha256: f.receipt.manifestSha256,
    });
  });

  it("rejects extra fields, mismatched names, missing URL and symlink descriptors", async () => {
    const f = await fixture();
    for (const change of [
      { command: "untrusted-command" },
      { archive: "another.tar.gz" },
      { archiveBytes: true },
      { archiveSha256: "invalid" },
      { downloadUrl: "http://assets.example.com/runtime.tar.gz" },
    ]) {
      await writeFile(
        f.descriptor,
        JSON.stringify({ ...f.receipt, ...change }),
      );
      await expect(selectCloudGuestSource(f.descriptor)).rejects.toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
      );
    }
    await writeFile(
      f.descriptor,
      JSON.stringify({ ...f.receipt, downloadUrl: undefined }),
    );
    await expect(selectCloudGuestSource(f.descriptor)).rejects.toThrow(
      /^CLOUD_INSTALL_DOWNLOAD_REQUIRED$/u,
    );
    const link = path.join(f.root, "linked.tar.gz.json");
    await symlink(f.descriptor, link);
    await expect(selectCloudGuestSource(link)).rejects.toThrow(
      /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
    );
  });

  it("refuses large local uploads while preserving verified small packages", async () => {
    const f = await fixture();
    for (const size of [8 * 1024 ** 2, 8 * 1024 ** 2 + 1]) {
      const bytes = Buffer.alloc(size, 7);
      await writeFile(f.archive, bytes);
      await writeFile(
        f.descriptor,
        JSON.stringify({
          ...f.receipt,
          archiveBytes: bytes.length,
          archiveSha256: createHash("sha256").update(bytes).digest("hex"),
          downloadUrl: undefined,
        }),
      );
      if (size === 8 * 1024 ** 2)
        expect(
          (await selectCloudGuestSource(f.archive)).artifact.archiveBytes,
        ).toBe(size);
      else
        await expect(selectCloudGuestSource(f.archive)).rejects.toThrow(
          /^CLOUD_INSTALL_DOWNLOAD_REQUIRED$/u,
        );
    }
  });

  it("returns fixed errors for unsafe or malformed URLs without echoing their secrets", () => {
    for (const url of [
      "synthetic-secret-not-a-url",
      "https://user:synthetic-secret@assets.example.com/a",
      "https://assets.example.com/a#synthetic-secret",
      "https://assets.example.com:444/a?synthetic-secret",
      "https://127.0.0.1/a?synthetic-secret",
      "https://2130706433/a?synthetic-secret",
      "https://[::1]/a?synthetic-secret",
      "https://localhost/a?synthetic-secret",
      "https://assets.example.com/a\nsynthetic-secret",
      "https://assets.example.com/" + "界".repeat(1000),
    ])
      expect(() => validateDownloadUrl(url)).toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
      );
  });
});
