// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import {
  probeCloudGuestRelease,
  selectCloudGuestRelease,
} from "./cloudGuestRelease";

const version = packageMetadata.version;
const repository = packageMetadata.repository.url
  .replace(/^git\+/u, "")
  .replace(/\.git$/u, "");
const archive = `lime-guest-linux-x64-${version}.tar.gz`;
const downloadUrl = `${repository}/releases/download/v${version}/${archive}`;
const receipt = {
  schemaVersion: 1,
  archive,
  archiveBytes: 128 * 1024 ** 2,
  archiveSha256: "a".repeat(64),
  manifestSha256: "b".repeat(64),
  downloadUrl,
};
const json = (value: unknown) => new Response(JSON.stringify(value));

describe("version-matched cloud guest release", () => {
  it("reads only the exact official descriptor without credentials or a renderer URL", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(receipt));
    expect(await selectCloudGuestRelease(version, fetcher)).toEqual({
      artifact: {
        archiveBytes: receipt.archiveBytes,
        archiveSha256: receipt.archiveSha256,
        manifestSha256: receipt.manifestSha256,
      },
      downloadUrl,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe(downloadUrl + ".json");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it("follows the official asset redirect while keeping the package URL bound to the release", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/test?signature=synthetic",
          },
        }),
      )
      .mockResolvedValueOnce(json(receipt));
    expect((await selectCloudGuestRelease(version, fetcher)).downloadUrl).toBe(
      downloadUrl,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    "http://release-assets.githubusercontent.com/a",
    "https://127.0.0.1/a",
    "https://release-assets.githubusercontent.com.evil.example/a",
    "https://github.com/unrelated/release",
    "https://user:synthetic@release-assets.githubusercontent.com/a",
    "https://release-assets.githubusercontent.com:444/a",
  ])(
    "rejects an untrusted redirect before requesting it: %s",
    async (location) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 302, headers: { location } }),
      );
      await expect(selectCloudGuestRelease(version, fetcher)).rejects.toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("bounds redirects and decoded response size, including missing content-length", async () => {
    const loop = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "https://release-assets.githubusercontent.com/loop",
          },
        }),
    );
    await expect(selectCloudGuestRelease(version, loop)).rejects.toThrow(
      /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
    );
    expect(loop).toHaveBeenCalledTimes(4);
    for (const headers of [
      new Headers(),
      new Headers({ "content-length": "999999" }),
    ]) {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response("x".repeat(8193), { headers }),
      );
      await expect(selectCloudGuestRelease(version, fetcher)).rejects.toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
      );
    }
  });
  it.each([
    { archive: "wrong.tar.gz" },
    { archiveBytes: 0 },
    { manifestSha256: "invalid" },
    { downloadUrl: "https://unrelated.example/runtime.tar.gz" },
    { downloadUrl: downloadUrl + "?signature=synthetic" },
    { command: "untrusted" },
  ])(
    "rejects changed release identity and malformed metadata: %j",
    async (change) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        json({ ...receipt, ...change }),
      );
      await expect(selectCloudGuestRelease(version, fetcher)).rejects.toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
      );
    },
  );
  it("returns a fixed unavailable error for missing assets, network and parse failures", async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })),
      vi.fn<typeof fetch>(async () => {
        throw Error("synthetic-secret-redirect");
      }),
      vi.fn<typeof fetch>(async () => new Response("{synthetic-secret")),
    ])
      await expect(selectCloudGuestRelease(version, fetcher)).rejects.toThrow(
        /^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/u,
      );
  });
  it.each(["latest", "../v1.0.0", "1.2.3?secret", "1.2.3-dev", "01.2.3"])(
    "rejects unsupported versions without network access: %s",
    async (candidate) => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(selectCloudGuestRelease(candidate, fetcher)).rejects.toThrow(
        /^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/u,
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe("purchase runtime preflight", () => {
  it("shares one timeout across descriptor and HEAD, checks size without downloading the archive", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(receipt))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/archive?signature=synthetic",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { "content-length": String(receipt.archiveBytes) },
        }),
      );
    await probeCloudGuestRelease(version, fetcher);
    expect(
      fetcher.mock.calls.map(([url, options]) => [
        String(url),
        options?.method,
      ]),
    ).toEqual([
      [downloadUrl + ".json", "GET"],
      [downloadUrl, "HEAD"],
      [
        "https://release-assets.githubusercontent.com/archive?signature=synthetic",
        "HEAD",
      ],
    ]);
    const signal = fetcher.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(
      fetcher.mock.calls.every(
        ([, options]) =>
          options?.signal === signal && options?.credentials === "omit",
      ),
    ).toBe(true);
  });

  it.each([null, "0", "128.5", "NaN", String(receipt.archiveBytes + 1)])(
    "rejects missing or mismatched artifact length: %s",
    async (length) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(receipt))
        .mockResolvedValueOnce(
          new Response(null, {
            headers: length === null ? {} : { "content-length": length },
          }),
        );
      await expect(probeCloudGuestRelease(version, fetcher)).rejects.toThrow(
        /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("does not probe an archive after a missing descriptor, and filters HEAD network errors", async () => {
    const missing = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 404 }),
    );
    await expect(probeCloudGuestRelease(version, missing)).rejects.toThrow(
      /^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/u,
    );
    expect(missing).toHaveBeenCalledOnce();
    const failed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(receipt))
      .mockRejectedValueOnce(
        new Error("https://assets.example.com/?secret=synthetic"),
      );
    await expect(probeCloudGuestRelease(version, failed)).rejects.toThrow(
      /^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/u,
    );
  });

  it("rejects archive 404 and untrusted or excessive redirects without a package GET", async () => {
    for (const response of [
      new Response(null, { status: 404 }),
      new Response(null, {
        status: 302,
        headers: { location: "https://untrusted.example.com/archive" },
      }),
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(receipt))
        .mockResolvedValue(response);
      await expect(probeCloudGuestRelease(version, fetcher)).rejects.toThrow(
        /^CLOUD_INSTALL_(?:PACKAGE_INVALID|RELEASE_UNAVAILABLE)$/u,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
    const loop = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(receipt))
      .mockImplementation(
        async () =>
          new Response(null, {
            status: 302,
            headers: {
              location: "https://release-assets.githubusercontent.com/loop",
            },
          }),
      );
    await expect(probeCloudGuestRelease(version, loop)).rejects.toThrow(
      /^CLOUD_INSTALL_PACKAGE_INVALID$/u,
    );
    expect(loop).toHaveBeenCalledTimes(5);
  });
});
