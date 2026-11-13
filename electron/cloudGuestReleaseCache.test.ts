// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import packageMetadata from "../package.json";
import { CloudGuestReleaseCache } from "./cloudGuestReleaseCache";

const roots: string[] = [];
const caches: CloudGuestReleaseCache[] = [];
afterEach(async () => {
  await Promise.all(caches.splice(0).map((cache) => cache.stop()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const bytes = Buffer.from("official release fixture; not a user archive");
const version = packageMetadata.version;
const archive = `lime-guest-linux-x64-${version}.tar.gz`;
const downloadUrl = `https://github.com/limecloud/lime/releases/download/v${version}/${archive}`;
const descriptor = {
  schemaVersion: 1,
  archive,
  archiveBytes: bytes.length,
  archiveSha256: createHash("sha256").update(bytes).digest("hex"),
  manifestSha256: "b".repeat(64),
  downloadUrl,
};
async function fixture(body?: () => Response) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lime-release-cache-"));
  roots.push(root);
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith(".json")
      ? new Response(JSON.stringify(descriptor))
      : (body?.() ?? new Response(bytes)),
  );
  const cache = new CloudGuestReleaseCache(root, version, fetcher);
  caches.push(cache);
  return {
    root,
    fetcher,
    cache,
    target: path.join(root, "cloud-runtime-releases", version, archive),
  };
}
async function finished(cache: CloudGuestReleaseCache) {
  for (let i = 0; i < 500 && cache.status().busy; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  expect(cache.status().busy).toBe(false);
  return cache.status();
}

describe("official release preparation before billing", () => {
  it("returns immediately, shares the job and counts written bytes before validation", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const f = await fixture(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
            },
          }),
        ),
    );
    expect(f.cache.prepare()).toMatchObject({ phase: "checking", busy: true });
    f.cache.prepare();
    for (let i = 0; i < 500 && !stream; i++)
      await new Promise((resolve) => setTimeout(resolve, 2));
    stream.enqueue(bytes.subarray(0, 8));
    for (let i = 0; i < 500 && f.cache.status().receivedBytes !== 8; i++)
      await new Promise((resolve) => setTimeout(resolve, 2));
    expect(f.cache.status()).toMatchObject({
      phase: "downloading",
      receivedBytes: 8,
      totalBytes: bytes.length,
      busy: true,
    });
    stream.enqueue(bytes.subarray(8));
    stream.close();
    expect(await finished(f.cache)).toMatchObject({
      phase: "ready",
      receivedBytes: bytes.length,
    });
    expect(await readFile(f.target)).toEqual(bytes);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(String(f.fetcher.mock.calls[1][0])).toBe(downloadUrl);
    expect(f.fetcher.mock.calls[1][1]).toMatchObject({
      credentials: "omit",
      redirect: "manual",
      headers: { Accept: "application/octet-stream" },
    });
    expect(JSON.stringify(f.cache.status())).not.toMatch(
      /https:|artifactPath|sha256|token/i,
    );
  });

  it("reuses verified bytes after restart, re-fetches official metadata and repairs a changed cache", async () => {
    const f = await fixture();
    const source = await f.cache.source();
    expect(source.artifactPath).toBe(f.target);
    const restarted = new CloudGuestReleaseCache(f.root, version, f.fetcher);
    caches.push(restarted);
    expect(restarted.status().phase).toBe("idle");
    await restarted.source();
    expect(
      f.fetcher.mock.calls.filter(([url]) => !String(url).endsWith(".json")),
    ).toHaveLength(1);
    await writeFile(f.target, "corruption");
    await restarted.source();
    expect(await readFile(f.target)).toEqual(bytes);
    expect(
      f.fetcher.mock.calls.filter(([url]) => !String(url).endsWith(".json")),
    ).toHaveLength(2);
  });

  it.each([
    bytes.subarray(1),
    Buffer.concat([bytes, Buffer.from("extra")]),
    Buffer.alloc(bytes.length),
  ])(
    "never publishes a truncated, oversized or mismatched package %#",
    async (payload) => {
      const f = await fixture(() => new Response(payload));
      f.cache.prepare();
      expect(await finished(f.cache)).toMatchObject({
        phase: "failed",
        diagnostic: "CLOUD_INSTALL_PACKAGE_INVALID",
      });
      expect(await readdir(path.dirname(f.target))).toEqual([]);
      await expect(f.cache.source()).rejects.toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/,
      );
    },
  );

  it("bounds declared sizes and rejects non-official redirects before following them", async () => {
    for (const response of [
      () =>
        new Response(bytes, {
          headers: { "content-length": String(bytes.length + 1) },
        }),
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "https://untrusted.invalid/package?secret=fixture",
          },
        }),
    ]) {
      const f = await fixture(response);
      await expect(f.cache.source()).rejects.toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/,
      );
      expect(f.fetcher).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(f.cache.status())).not.toContain("secret");
    }
  });

  it("ignores mutable local metadata and requires the official descriptor on every reuse", async () => {
    const f = await fixture();
    await f.cache.source();
    await writeFile(
      f.target + ".json",
      JSON.stringify({ ...descriptor, archiveSha256: "a".repeat(64) }),
    );
    await f.cache.source();
    expect(JSON.parse(await readFile(f.target + ".json", "utf8"))).toEqual(
      descriptor,
    );
    f.fetcher.mockRejectedValueOnce(Error("private signed url diagnostic"));
    await expect(f.cache.source()).rejects.toThrow(
      /^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/,
    );
    expect(JSON.stringify(f.cache.status())).not.toContain("private");
  });

  it("does not write through a cache-directory symlink", async () => {
    const f = await fixture();
    const elsewhere = await mkdtemp(
      path.join(os.tmpdir(), "lime-cache-outside-"),
    );
    roots.push(elsewhere);
    await symlink(elsewhere, path.join(f.root, "cloud-runtime-releases"));
    await expect(f.cache.source()).rejects.toThrow(
      /^CLOUD_INSTALL_PACKAGE_INVALID$/,
    );
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it("shutdown aborts an in-flight fetch, removes partial bytes and prevents restart", async () => {
    const f = await fixture();
    let entered = false;
    f.fetcher.mockImplementation(async (url, options) => {
      if (String(url).endsWith(".json"))
        return new Response(JSON.stringify(descriptor));
      entered = true;
      return new Promise<Response>((_, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(Error("private cancelled transfer")),
          { once: true },
        );
      });
    });
    f.cache.prepare();
    for (let i = 0; i < 500 && !entered; i++)
      await new Promise((resolve) => setTimeout(resolve, 2));
    expect(entered).toBe(true);
    await f.cache.stop();
    expect(f.cache.status()).toMatchObject({
      phase: "failed",
      busy: false,
      diagnostic: "CLOUD_INSTALL_RELEASE_UNAVAILABLE",
    });
    expect(await readdir(path.dirname(f.target))).toEqual([]);
    expect(() => f.cache.prepare()).toThrow(
      /^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/,
    );
  });
});
