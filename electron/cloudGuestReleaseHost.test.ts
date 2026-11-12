// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import packageMetadata from "../package.json";

const { getVersion } = vi.hoisted(() => ({ getVersion: vi.fn() }));
vi.mock("electron", () => ({ app: { getVersion } }));
vi.mock("./electronRuntime", () => ({ app: { getVersion } }));
import { CloudDesktopWindows } from "./cloudDesktopWindows";

afterEach(() => vi.unstubAllGlobals());

it("checks only the installed application's release without resource, credential or cloud access", async () => {
  getVersion.mockReturnValue(packageMetadata.version);
  const repository = packageMetadata.repository.url
    .replace(/^git\+/u, "")
    .replace(/\.git$/u, "");
  const archive = `lime-guest-linux-x64-${packageMetadata.version}.tar.gz`;
  const downloadUrl = `${repository}/releases/download/v${packageMetadata.version}/${archive}`;
  const receipt = {
    schemaVersion: 1,
    archive,
    archiveBytes: 100_000_000,
    archiveSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    downloadUrl,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(receipt)))
    .mockResolvedValueOnce(
      new Response(null, {
        headers: { "content-length": String(receipt.archiveBytes) },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const root = await mkdtemp(path.join(os.tmpdir(), "lime-release-probe-"));
  const cloud = vi.fn();
  const window = vi.fn();
  const vault = vi.fn(() => {
    throw new Error("Credential storage must not be accessed");
  });
  const manager = new CloudDesktopWindows(
    root,
    {
      isEncryptionAvailable: vault,
      encryptString: vault,
      decryptString: vault,
    },
    window,
    cloud,
  );
  try {
    const result = await manager.invoke({ action: "checkRuntimeRelease" });
    expect(result).toEqual({
      kind: "guestRelease",
      available: true,
      version: packageMetadata.version,
    });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      downloadUrl + ".json",
      downloadUrl,
    ]);
    expect(cloud).not.toHaveBeenCalled();
    expect(window).not.toHaveBeenCalled();
    expect(vault).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    fetcher.mockRejectedValueOnce(new Error("synthetic-secret-signed-url"));
    await expect(
      manager.invoke({ action: "checkRuntimeRelease" }),
    ).rejects.toThrow(/^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/u);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await manager.stop();
    await rm(root, { recursive: true, force: true });
  }
});
