// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { CloudGuestInstallations } from "./cloudGuestInstallations";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";
import {
  CloudGuestUploadError,
  type requestCloudGuestUpload,
} from "./cloudGuestUpload";

const managers: CloudGuestInstallations[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stop()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(reconnect = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lime-install-progress-"));
  roots.push(root);
  const resource = {
    provider: "ecs" as const,
    profile: "synthetic",
    regionId: "cn-test",
    resourceId: "i-progress",
  };
  const artifact = {
    archiveBytes: 1024,
    archiveSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "local_key",
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  };
  const submitted = new Map<string, CloudDesktopParams>();
  const remote = {
    phase: "waiting",
    validIdentity: true,
    transfer: undefined as unknown,
  };
  const request = vi.fn<CloudDesktopRequest>(async (params) => {
    if (params.action === "openEcsTunnel" || params.action === "closeEcsTunnel")
      return {
        data: {
          state: params.action === "openEcsTunnel" ? "listening" : "closed",
          channel: "installation",
          persistent: false,
          endpoint: "https://127.0.0.1:34567/",
        },
      };
    if (params.action !== "readOperation") {
      if (!("operationId" in params)) throw Error("Unexpected fixture action");
      expect(submitted.has(params.operationId)).toBe(false);
      submitted.set(params.operationId, params);
    }
    if (!("operationId" in params)) throw Error("Missing fixture operation");
    const original = submitted.get(params.operationId);
    if (!original) throw Error("Unknown fixture operation");
    const preparation = original.action === "prepareEcsDesktop";
    return {
      data: {
        operationId: params.operationId,
        request: {
          ...original,
          ...(original.action === "startEcsRuntimeInstallation"
            ? { artifact }
            : {}),
        },
        outcome: preparation ? "dependenciesReady" : "runtimeUploadReady",
        packagesPrepared: preparation,
        expiresAt,
        upload: {
          operationId: params.operationId,
          certificate: "explicit synthetic certificate",
          expiresAt,
        },
      },
    };
  });
  const transport = vi.fn<typeof requestCloudGuestUpload>(
    async (target, _capability, route) => {
      if (route === "/download" || route === "/reconnect")
        remote.phase = "receiving";
      if (route === "/credentials")
        return {
          operationId: target.operationId,
          token: "synthetic_task_token_".repeat(3),
          viewerPassword: "testVnc8",
        };
      if (route === "/finish") return { phase: "finished" };
      return {
        operationId: remote.validIdentity
          ? target.operationId
          : "wrong-operation",
        expiresAt,
        phase: remote.phase,
        ...(remote.transfer === undefined ? {} : { transfer: remote.transfer }),
      };
    },
  );
  const release = vi.fn(async () => ({
    artifact,
    downloadUrl:
      "https://assets.example.com/runtime.tar.gz?signature=private-fixture",
  }));
  const save = vi.fn(async () => undefined);
  const create = () => {
    const manager = new CloudGuestInstallations(
      root,
      safeStorage,
      request,
      async () => undefined,
      save,
      transport,
      1,
      undefined,
      release,
    );
    managers.push(manager);
    return manager;
  };
  const manager = create();
  const status = (owner = manager) => owner.status("key", resource);
  const waitFor = async (phase: string, owner = manager) => {
    await expect.poll(async () => (await status(owner)).phase).toBe(phase);
    return status(owner);
  };
  const start = () =>
    manager.invoke(
      "key",
      resource,
      reconnect
        ? {
            action: "reconnectRuntime",
            resource,
            workSaved: true,
            confirmation: `reconnectRuntime:${resource.regionId}:${resource.resourceId}`,
          }
        : {
            action: "installRuntime",
            resource,
            source: "release",
            trustArtifact: true,
            createDesktopUser: true,
            installSystemPackages: true,
            confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
          },
    );
  return {
    manager,
    create,
    resource,
    remote,
    request,
    transport,
    release,
    save,
    status,
    waitFor,
    start,
  };
}

it("persists verified download/install stages and resumes the same operation without repeating setup or download", async () => {
  const f = await fixture();
  await f.start();
  const downloading = await f.waitFor("downloading");
  expect(downloading).toMatchObject({
    mode: "install",
    connectionSaved: false,
  });
  const observer = f.create();
  expect(await f.status(observer)).toMatchObject({
    phase: "downloading",
    operationId: downloading.operationId,
    createdAt: downloading.createdAt,
  });
  expect(JSON.stringify(await f.status(observer))).not.toMatch(
    /downloadUrl|signature|private-fixture/u,
  );
  await f.manager.stop();
  expect((await f.status()).phase).toBe("needsAttention");
  const resumed = f.create();
  await resumed.invoke("key", f.resource, {
    action: "resumeInstallation",
    resource: f.resource,
    operationId: downloading.operationId!,
  });
  await f.waitFor("downloading", resumed);
  f.remote.phase = "installing";
  expect(await f.waitFor("installing", resumed)).toMatchObject({
    operationId: downloading.operationId,
    createdAt: downloading.createdAt,
    connectionSaved: false,
  });
  expect(f.save).not.toHaveBeenCalled();
  f.remote.phase = "installed";
  expect(await f.waitFor("complete", resumed)).toMatchObject({
    operationId: downloading.operationId,
    createdAt: downloading.createdAt,
    connectionSaved: true,
  });
  expect(f.release).toHaveBeenCalledOnce();
  expect(
    f.transport.mock.calls.filter((call) => call[2] === "/download"),
  ).toHaveLength(1);
  expect(
    f.request.mock.calls.filter(
      ([params]) => params.action === "prepareEcsDesktop",
    ),
  ).toHaveLength(1);
  expect(
    f.request.mock.calls.filter(
      ([params]) => params.action === "startEcsRuntimeInstallation",
    ),
  ).toHaveLength(1);
  expect(f.save).toHaveBeenCalledOnce();
});

it("retains trusted byte progress across restart and original-operation recovery", async () => {
  const f = await fixture();
  f.remote.transfer = { receivedBytes: 128, totalBytes: 1024, url: "private" };
  await f.start();
  const original = await f.waitFor("downloading");
  expect(original.transfer).toEqual({ receivedBytes: 128, totalBytes: 1024 });
  f.remote.transfer = { receivedBytes: 512, totalBytes: 1024 };
  await expect
    .poll(async () => (await f.status()).transfer?.receivedBytes)
    .toBe(512);
  await f.manager.stop();
  const resumed = f.create();
  expect((await f.status(resumed)).transfer).toEqual({
    receivedBytes: 512,
    totalBytes: 1024,
  });
  f.remote.transfer = undefined;
  await resumed.invoke("key", f.resource, {
    action: "resumeInstallation",
    resource: f.resource,
    operationId: original.operationId!,
  });
  expect(
    (await f.waitFor("downloading", resumed)).transfer?.receivedBytes,
  ).toBe(512);
  f.remote.transfer = { receivedBytes: 1024, totalBytes: 1024 };
  f.remote.phase = "installing";
  expect(await f.waitFor("installing", resumed)).toMatchObject({
    connectionSaved: false,
    transfer: { receivedBytes: 1024, totalBytes: 1024 },
  });
  expect(f.save).not.toHaveBeenCalled();
  expect(
    f.transport.mock.calls.filter((call) => call[2] === "/download"),
  ).toHaveLength(1);
});

it.each([
  null,
  { receivedBytes: -1, totalBytes: 1024 },
  { receivedBytes: 1.5, totalBytes: 1024 },
  { receivedBytes: "128", totalBytes: 1024 },
  { receivedBytes: 128, totalBytes: 2048 },
  { receivedBytes: 1025, totalBytes: 1024 },
  { receivedBytes: 127, totalBytes: 1024 },
])(
  "rejects invalid or regressing progress while keeping the last verified snapshot: %j",
  async (invalid) => {
    const f = await fixture();
    f.remote.transfer = { receivedBytes: 128, totalBytes: 1024 };
    await f.start();
    await f.waitFor("downloading");
    f.remote.transfer = invalid;
    expect(await f.waitFor("needsAttention")).toMatchObject({
      connectionSaved: false,
      transfer: { receivedBytes: 128, totalBytes: 1024 },
    });
    expect(f.save).not.toHaveBeenCalled();
  },
);

it("rejects artifact progress during credential-only rebuilding", async () => {
  const f = await fixture(true);
  f.remote.transfer = { receivedBytes: 128, totalBytes: 1024 };
  await f.start();
  expect((await f.waitFor("needsAttention")).transfer).toBeUndefined();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.transport.mock.calls.map((call) => call[2])).toEqual(["/status"]);
});

it.each(["receiving", "installing"])(
  "rejects an unrelated operation before projecting remote %s as progress",
  async (phase) => {
    const f = await fixture();
    f.remote.phase = phase;
    f.remote.validIdentity = false;
    await f.start();
    expect(await f.waitFor("needsAttention")).toMatchObject({
      diagnostic: "CLOUD_INSTALL_RECOVERY_REQUIRED",
      connectionSaved: false,
    });
    expect(f.save).not.toHaveBeenCalled();
    expect(f.transport.mock.calls.map((call) => call[2])).toEqual(["/status"]);
    expect(f.transport.mock.calls.some((call) => call[2] === "/download")).toBe(
      false,
    );
  },
);

it("keeps credential rebuilding separate from downloading and installation", async () => {
  const f = await fixture(true);
  await f.start();
  await expect
    .poll(
      () =>
        f.transport.mock.calls.filter((call) => call[2] === "/reconnect")
          .length,
    )
    .toBe(1);
  expect((await f.status()).phase).toBe("uploading");
  f.remote.phase = "installing";
  await expect
    .poll(
      () =>
        f.transport.mock.calls.filter((call) => call[2] === "/status").length,
    )
    .toBeGreaterThan(2);
  expect((await f.status()).phase).toBe("uploading");
  expect(f.release).not.toHaveBeenCalled();
  f.remote.phase = "installed";
  expect((await f.waitFor("complete")).mode).toBe("reconnect");
});

it("reports guest installation failure without claiming completion or replacing credentials", async () => {
  const f = await fixture();
  await f.start();
  await f.waitFor("downloading");
  f.remote.phase = "installing";
  await f.waitFor("installing");
  f.remote.phase = "failed";
  expect(await f.waitFor("failed")).toMatchObject({
    diagnostic: "CLOUD_INSTALL_FAILED",
    connectionSaved: false,
  });
  expect(f.save).not.toHaveBeenCalled();
  expect(
    f.transport.mock.calls.filter((call) => call[2] === "/download"),
  ).toHaveLength(1);
});

it("persists safe transport diagnostics across restart and resumes the original download without resubmission", async () => {
  const f = await fixture();
  await f.start();
  const downloading = await f.waitFor("downloading");
  f.transport.mockRejectedValueOnce(
    new CloudGuestUploadError({
      route: "/status",
      reason: "httpStatus",
      httpStatus: 403,
    }),
  );
  // A subsequent tunnel-close failure must not erase the original diagnosis.
  f.request.mockRejectedValueOnce(new Error("synthetic-private-close-error"));
  const failed = await f.waitFor("needsAttention");
  await expect.poll(async () => (await f.status()).busy).toBe(false);
  expect(failed).toMatchObject({
    operationId: downloading.operationId,
    diagnostic: "CLOUD_INSTALL_RECOVERY_REQUIRED",
    transportFailure: {
      route: "/status",
      reason: "httpStatus",
      httpStatus: 403,
    },
    connectionSaved: false,
  });
  await f.manager.stop();
  const resumed = f.create();
  expect(await f.status(resumed)).toMatchObject({
    transportFailure: failed.transportFailure,
    operationId: downloading.operationId,
  });
  expect(JSON.stringify(await f.status(resumed))).not.toMatch(
    /private|certificate|capability|downloadUrl|token|endpoint/u,
  );
  await resumed.invoke("key", f.resource, {
    action: "resumeInstallation",
    resource: f.resource,
    operationId: downloading.operationId!,
  });
  const recovering = await f.waitFor("downloading", resumed);
  expect(recovering.transportFailure).toBeUndefined();
  f.remote.phase = "installed";
  const complete = await f.waitFor("complete", resumed);
  expect(complete.transportFailure).toBeUndefined();
  expect(complete).toMatchObject({
    operationId: downloading.operationId,
    connectionSaved: true,
  });
  for (const action of ["prepareEcsDesktop", "startEcsRuntimeInstallation"])
    expect(
      f.request.mock.calls.filter(([params]) => params.action === action),
    ).toHaveLength(1);
  expect(
    f.transport.mock.calls.filter((call) => call[2] === "/download"),
  ).toHaveLength(1);
  expect(f.save).toHaveBeenCalledOnce();
});
