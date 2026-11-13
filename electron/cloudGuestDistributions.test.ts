// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { CloudGuestDistributions } from "./cloudGuestDistributions";
import { CloudGuestReleaseCache } from "./cloudGuestReleaseCache";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";

const context = { profile: "fixture", regionId: "cn-hangzhou" };
const resource: CloudDesktopResource = {
  ...context,
  provider: "ecs",
  resourceId: "i-fixture",
};
const artifact = {
  archiveBytes: 100,
  archiveSha256: "a".repeat(64),
  manifestSha256: "b".repeat(64),
};
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "local_key",
  encryptString: (text: string) => Buffer.from(text),
  decryptString: (value: Buffer) => value.toString(),
};
let root: string;
let cache: CloudGuestReleaseCache;
let managers: CloudGuestDistributions[];

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lime-distribution-"));
  managers = [];
  cache = new CloudGuestReleaseCache(root, "1.175.0");
  vi.spyOn(cache, "source").mockResolvedValue({ artifact });
});
afterEach(async () => {
  await Promise.all(managers.map((manager) => manager.stop()));
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const rpc = () =>
  vi.fn<CloudDesktopRequest>(async (params) => {
    if (!("operationId" in params)) throw Error("unexpected request");
    return {
      data: {
        operationId: params.operationId,
        phase:
          params.action === "cleanupRuntimeDistribution" ? "cleaned" : "ready",
        archiveBytes: artifact.archiveBytes,
        archiveSha256: artifact.archiveSha256,
        ...(params.action === "signRuntimeDistribution"
          ? {
              downloadUrl: `https://lime-runtime-${params.operationId.replaceAll("-", "")}.oss-${context.regionId}.aliyuncs.com/runtime/${artifact.archiveSha256}.tar.gz?x-oss-signature=synthetic-capability`,
              expiresAt: Date.now() + 60 * 60_000,
            }
          : {}),
      },
    };
  });
function manager(request: CloudDesktopRequest) {
  const value = new CloudGuestDistributions(root, safeStorage, request, cache);
  managers.push(value);
  return value;
}
async function ready(value: CloudGuestDistributions) {
  for (let i = 0; i < 500; i++) {
    if (!value.status(context).busy) return value.status(context);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw Error("fixture did not settle");
}

it("status never authorizes, prepares or reveals a URL; duplicate preparation shares one operation", async () => {
  const request = rpc();
  const value = manager(request);
  expect(value.status(context)).toMatchObject({ phase: "idle", busy: false });
  expect(request).not.toHaveBeenCalled();
  value.prepare(context);
  value.prepare(context);
  expect(await ready(value)).toMatchObject({ phase: "ready", busy: false });
  expect(request.mock.calls.map(([params]) => params.action)).toEqual([
    "prepareRuntimeDistribution",
  ]);
  expect(JSON.stringify(value.status(context))).not.toMatch(
    /profile|fixture|https|bucket|sha256|operationId/i,
  );
  expect(value.status({ ...context, regionId: "cn-shanghai" }).phase).toBe(
    "idle",
  );
});

it("holds a shared source until all exact installation leases complete", async () => {
  const request = rpc();
  const value = manager(request);
  const first = await value.source(resource);
  const other = { ...resource, resourceId: "i-other" };
  const second = await value.source(other);
  expect(first.distributionId).toBe(second.distributionId);
  await value.release(resource, first.distributionId!);
  expect(
    request.mock.calls.filter(
      ([params]) => params.action === "cleanupRuntimeDistribution",
    ),
  ).toHaveLength(0);
  await value.release(other, second.distributionId!);
  expect(
    request.mock.calls.filter(
      ([params]) => params.action === "cleanupRuntimeDistribution",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(value.status(context))).not.toContain(
    "synthetic-capability",
  );
});

it("reopens the same prepared operation after restart and keeps active installation leases", async () => {
  const request = rpc();
  const original = manager(request);
  const source = await original.source(resource);
  await original.stop();
  expect(
    request.mock.calls.filter(
      ([params]) => params.action === "cleanupRuntimeDistribution",
    ),
  ).toHaveLength(0);
  const reopened = manager(request);
  reopened.prepare(context);
  expect((await ready(reopened)).phase).toBe("ready");
  expect(
    request.mock.calls.filter(
      ([params]) => params.action === "prepareRuntimeDistribution",
    ),
  ).toHaveLength(1);
  expect(
    request.mock.calls.filter(
      ([params]) => params.action === "readRuntimeDistribution",
    ),
  ).toHaveLength(1);
  await reopened.release(resource, source.distributionId!);
});

it("does not generate another purchase-time bucket while cleanup of an unknown upload fails", async () => {
  const request = rpc();
  request.mockRejectedValueOnce(Error("synthetic-secret"));
  request.mockRejectedValueOnce(Error("synthetic-secret"));
  const value = manager(request);
  value.prepare(context);
  expect(await ready(value)).toMatchObject({
    phase: "failed",
    diagnostic: "CLOUD_INSTALL_RELEASE_UNAVAILABLE",
  });
  request.mockRejectedValueOnce(Error("synthetic-secret"));
  value.prepare(context);
  expect((await ready(value)).phase).toBe("failed");
  const requests = request.mock.calls.map(([params]) => params);
  expect(requests.map((params) => params.action)).toEqual([
    "prepareRuntimeDistribution",
    "cleanupRuntimeDistribution",
    "cleanupRuntimeDistribution",
  ]);
  expect(
    new Set(
      requests.map((params) => "operationId" in params && params.operationId),
    ).size,
  ).toBe(1);
});

it("rejects changed object targets and short capabilities before handing them to installation", async () => {
  for (const patch of [
    {
      downloadUrl: "https://unrelated.invalid/runtime.tar.gz?secret=synthetic",
    },
    { expiresAt: Date.now() + 1000 },
    { archiveSha256: "c".repeat(64) },
  ]) {
    const request = rpc();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (params) => {
      const result = await base(params);
      return params.action === "signRuntimeDistribution"
        ? { data: { ...(result.data as object), ...patch } }
        : result;
    });
    const value = manager(request);
    await expect(value.source(resource)).rejects.toThrow(
      /^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/u,
    );
    await value.stop();
  }
});

it("stops waiting for an unknown in-flight RPC without resending it", async () => {
  const request = rpc();
  request.mockImplementationOnce(
    async () => await new Promise(() => undefined),
  );
  const value = manager(request);
  value.prepare(context);
  for (let i = 0; i < 100 && !request.mock.calls.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  expect(request.mock.calls[0]?.[0].action).toBe("prepareRuntimeDistribution");
  await value.stop();
  expect(
    request.mock.calls.filter(
      ([params]) => params.action === "prepareRuntimeDistribution",
    ),
  ).toHaveLength(1);
});
