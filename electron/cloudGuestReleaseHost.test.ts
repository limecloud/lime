// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import packageMetadata from "../package.json";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

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

it("exposes only safe preparation progress while the native Host distributes the verified package", async () => {
  getVersion.mockReturnValue(packageMetadata.version);
  const bytes = new TextEncoder().encode("public official runtime fixture");
  const archive = `lime-guest-linux-x64-${packageMetadata.version}.tar.gz`;
  const downloadUrl = `https://github.com/limecloud/lime/releases/download/v${packageMetadata.version}/${archive}`;
  const descriptor = {
    schemaVersion: 1,
    archive,
    archiveBytes: bytes.length,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    manifestSha256: "b".repeat(64),
    downloadUrl,
  };
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith(".json")
      ? new Response(JSON.stringify(descriptor))
      : new Response(bytes),
  );
  vi.stubGlobal("fetch", fetcher);
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lime-release-prepare-host-"),
  );
  const context = { profile: "fixture", regionId: "cn-hangzhou" };
  const cloud = vi.fn(async (params) => ({
    data: {
      operationId: params.operationId,
      phase:
        params.action === "cleanupRuntimeDistribution" ? "cleaned" : "ready",
      archiveBytes: descriptor.archiveBytes,
      archiveSha256: descriptor.archiveSha256,
    },
  }));
  const window = vi.fn();
  const manager = new CloudDesktopWindows(
    root,
    {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "local_key",
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    window,
    cloud,
  );
  try {
    expect(
      await manager.invoke({ action: "runtimeReleaseStatus", ...context }),
    ).toMatchObject({ kind: "guestPreparation", phase: "idle", busy: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await manager.invoke({ action: "prepareRuntimeRelease", ...context }),
    ).toMatchObject({ busy: true });
    let status;
    for (let i = 0; i < 500; i++) {
      status = await manager.invoke({
        action: "runtimeReleaseStatus",
        ...context,
      });
      if (!("busy" in status) || !status.busy) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(status).toMatchObject({
      phase: "ready",
      busy: false,
    });
    expect(JSON.stringify(status)).not.toMatch(/https:|artifactPath|Sha256/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cloud).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: "prepareRuntimeDistribution",
        ...context,
        archiveBytes: bytes.length,
      }),
    );
    expect(window).not.toHaveBeenCalled();
  } finally {
    await manager.stop();
    await rm(root, { recursive: true, force: true });
  }
});
