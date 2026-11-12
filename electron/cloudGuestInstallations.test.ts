// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  CloudDesktopParams,
  CloudDesktopResource,
} from "@limecloud/app-server-client";
import { CloudGuestInstallations } from "./cloudGuestInstallations";
import { ElectronEncryptedStateFile } from "./secureCredentialStore";
import type { requestCloudGuestUpload } from "./cloudGuestUpload";

type FixtureResponse = {
  data: {
    [key: string]: unknown;
    operationId?: string;
    request?: Record<string, unknown> & { resource: CloudDesktopResource };
    outcome?: string;
    packagesPrepared?: boolean;
    expiresAt?: number;
    upload?: {
      operationId: string;
      certificate: string;
      expiresAt: number;
    };
  };
};

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const resource: CloudDesktopResource = {
  provider: "ecs",
  profile: "test",
  regionId: "cn-test",
  resourceId: "i-test",
};
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (value: string) =>
    Buffer.from(Buffer.from(value).toString("base64")),
  decryptString: (value: Buffer) =>
    Buffer.from(value.toString(), "base64").toString(),
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lime-install-test-"));
  roots.push(root);
  const archive = path.join(root, "runtime.tar.gz");
  const bytes = Buffer.from(
    "explicit synthetic artifact; not a real Linux runtime",
  );
  await writeFile(archive, bytes);
  const artifact = {
    archiveBytes: bytes.length,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    manifestSha256: "b".repeat(64),
  };
  await writeFile(
    archive + ".json",
    JSON.stringify({
      schemaVersion: 1,
      archive: path.basename(archive),
      ...artifact,
    }),
  );
  let original:
    | Extract<
        CloudDesktopParams,
        { action: "startEcsRuntimeInstallation" | "reconnectEcsRuntime" }
      >
    | undefined;
  let guestPhase = "waiting";
  let expiresAt = Math.floor(Date.now() / 1000) + 120;
  let preparation:
    | Extract<CloudDesktopParams, { action: "prepareEcsDesktop" }>
    | undefined;
  const request = vi.fn(
    async (params: CloudDesktopParams): Promise<FixtureResponse> => {
      if (
        params.action === "openEcsTunnel" ||
        params.action === "closeEcsTunnel"
      )
        return {
          data: {
            state: params.action === "openEcsTunnel" ? "listening" : "closed",
            channel: "installation",
            persistent: false,
            endpoint: "https://127.0.0.1:34567",
          },
        };
      if (params.action === "prepareEcsDesktop") preparation = params;
      if (
        preparation &&
        (params.action === "prepareEcsDesktop" ||
          (params.action === "readOperation" &&
            params.operationId === preparation.operationId))
      )
        return {
          data: {
            operationId: preparation.operationId,
            request: {
              action: "prepareEcsDesktop",
              resource: { ...preparation.resource },
              installSystemPackages: true,
            },
            outcome: "dependenciesReady",
            packagesPrepared: true,
          },
        };
      if (
        params.action === "startEcsRuntimeInstallation" ||
        params.action === "reconnectEcsRuntime"
      ) {
        original = params;
        expiresAt = Math.floor(Date.now() / 1000) + 120;
      }
      if (!original) throw new Error("fixture missing original request");
      return {
        data: {
          operationId: original.operationId,
          request: {
            ...original,
            resource: {
              resourceId: resource.resourceId,
              regionId: resource.regionId,
              provider: resource.provider,
              profile: resource.profile,
            },
            ...(original.action === "startEcsRuntimeInstallation"
              ? { artifact }
              : {}),
          },
          outcome: "runtimeUploadReady",
          expiresAt,
          upload: {
            operationId: original.operationId,
            certificate: "explicit-public-certificate-fixture",
            expiresAt,
          },
        },
      };
    },
  );
  const transport = vi.fn<typeof requestCloudGuestUpload>(
    async (target, _capability, route, _signal, upload) => {
      if (route === "/runtime") {
        if (!upload || !("file" in upload))
          throw new Error("missing file fixture");
        expect(upload.bytes).toBe(bytes.length);
        const blocks: Buffer[] = [];
        for await (const block of upload.file.createReadStream({
          start: 0,
          autoClose: false,
        }))
          blocks.push(block);
        expect(Buffer.concat(blocks)).toEqual(bytes);
        guestPhase = "installed";
      }
      if (route === "/download") {
        expect(upload && "downloadUrl" in upload).toBe(true);
        guestPhase = "installed";
      }
      if (route === "/reconnect") guestPhase = "installed";
      if (route === "/credentials")
        return {
          operationId: target.operationId,
          token: "synthetic_token_".repeat(3),
          viewerPassword: "testVnc8",
        };
      if (route === "/finish") return { phase: "finished" };
      return { operationId: target.operationId, phase: guestPhase, expiresAt };
    },
  );
  const save = vi.fn(async () => undefined);
  const picker = vi.fn<() => Promise<string | undefined>>(async () => archive);
  const showPassword = vi.fn(async () => undefined);
  const release = vi.fn(async () => ({
    artifact: { ...artifact },
    downloadUrl: "https://assets.example.com/release.tar.gz",
  }));
  const create = () =>
    new CloudGuestInstallations(
      root,
      safeStorage,
      request,
      picker,
      save,
      transport,
      1,
      showPassword,
      release,
    );
  const manager = create();
  const start = () =>
    manager.invoke("key", resource, {
      action: "installRuntime",
      source: "file",
      resource,
      confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
      trustArtifact: true,
      createDesktopUser: true,
      installSystemPackages: true,
    });
  const idle = async (owner = manager) => {
    for (let i = 0; i < 1000; i++) {
      const status = await owner.status("key", resource);
      if (!status.busy) return status;
      await delay(2);
    }
    throw new Error("fixture did not settle");
  };
  const reconnect = (owner = manager) =>
    owner.invoke("key", resource, {
      action: "reconnectRuntime",
      resource,
      confirmation: `reconnectRuntime:${resource.regionId}:${resource.resourceId}`,
      workSaved: true,
    });
  return {
    root,
    archive,
    artifact,
    manager,
    create,
    request,
    transport,
    save,
    picker,
    start,
    idle,
    showPassword,
    reconnect,
    release,
  };
}

describe("private cloud runtime orchestration", () => {
  it("resolves a release before cloud mutation and persists its recovery without a local file", async () => {
    const f = await fixture();
    const request = {
      action: "installRuntime" as const,
      source: "release" as const,
      resource,
      confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
      trustArtifact: true,
      createDesktopUser: true,
      installSystemPackages: true,
    };
    f.release.mockRejectedValueOnce(Error("CLOUD_INSTALL_RELEASE_UNAVAILABLE"));
    await expect(f.manager.invoke("key", resource, request)).rejects.toThrow(
      "CLOUD_INSTALL_RELEASE_UNAVAILABLE",
    );
    expect(f.request).not.toHaveBeenCalled();
    expect(f.picker).not.toHaveBeenCalled();
    expect((await f.manager.status("key", resource)).exists).toBe(false);
    await f.manager.invoke("key", resource, request);
    const completed = await f.idle();
    expect(completed.connectionSaved).toBe(true);
    await f.manager.stop();
    const resumed = f.create();
    expect((await resumed.status("key", resource)).operationId).toBe(
      completed.operationId,
    );
    expect(f.release).toHaveBeenCalledTimes(2);
    expect(f.picker).not.toHaveBeenCalled();
    expect(
      f.transport.mock.calls.filter((call) => call[2] === "/download"),
    ).toHaveLength(1);
    expect(JSON.stringify(completed)).not.toContain("release.tar.gz");
    await resumed.stop();
  });
  it("downloads a large descriptor once without exposing its signed URL to cloud management or status", async () => {
    const f = await fixture();
    f.artifact.archiveBytes = 128 * 1024 ** 2;
    const url =
      "https://assets.example.com/runtime.tar.gz?signature=private-fixture-url";
    const descriptor = f.archive + ".json";
    await writeFile(
      descriptor,
      JSON.stringify({
        schemaVersion: 1,
        archive: path.basename(f.archive),
        ...f.artifact,
        downloadUrl: url,
      }),
    );
    f.picker.mockResolvedValue(descriptor);
    await f.start();
    const status = await f.idle();
    expect(status.phase).toBe("complete");
    expect(
      f.transport.mock.calls.filter(([, , route]) => route === "/download"),
    ).toHaveLength(1);
    expect(
      f.transport.mock.calls.some(([, , route]) => route === "/runtime"),
    ).toBe(false);
    expect(JSON.stringify(f.request.mock.calls)).not.toContain(url);
    expect(JSON.stringify(status)).not.toContain("downloadUrl");
    expect(JSON.stringify(status)).not.toContain("signature");
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.request.mock.calls.at(-1)?.[0].action).toBe("closeEcsTunnel");
  });

  it("recovers a lost download acknowledgement by reading the original remote state", async () => {
    const f = await fixture();
    const url = "https://assets.example.com/runtime.tar.gz";
    await writeFile(
      f.archive + ".json",
      JSON.stringify({
        schemaVersion: 1,
        archive: path.basename(f.archive),
        ...f.artifact,
        downloadUrl: url,
      }),
    );
    f.picker.mockResolvedValue(f.archive + ".json");
    const original = f.transport.getMockImplementation()!;
    let lost = false;
    f.transport.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[2] === "/download" && !lost) {
        lost = true;
        throw new Error("lost acknowledgement");
      }
      return result;
    });
    await f.start();
    const pending = await f.idle();
    expect(pending.phase).toBe("needsAttention");
    const resumed = f.create();
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: pending.operationId!,
    });
    expect((await f.idle(resumed)).phase).toBe("complete");
    expect(
      f.transport.mock.calls.filter(([, , route]) => route === "/download"),
    ).toHaveLength(1);
    expect(
      f.request.mock.calls.filter(
        ([request]) => request.action === "startEcsRuntimeInstallation",
      ),
    ).toHaveLength(1);
    expect(f.picker).toHaveBeenCalledOnce();
  });
  it("rejects a large local upload before preparing or launching any cloud operation", async () => {
    const f = await fixture();
    const bytes = Buffer.alloc(8 * 1024 ** 2 + 1);
    await writeFile(f.archive, bytes);
    await writeFile(
      f.archive + ".json",
      JSON.stringify({
        schemaVersion: 1,
        archive: path.basename(f.archive),
        ...f.artifact,
        archiveBytes: bytes.length,
        archiveSha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
    await expect(f.start()).rejects.toThrow(
      /^CLOUD_INSTALL_DOWNLOAD_REQUIRED$/u,
    );
    expect(f.request).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect((await f.manager.status("key", resource)).exists).toBe(false);
  });

  it("requires system-package consent and a selected artifact before any cloud mutation", async () => {
    const f = await fixture();
    await expect(
      f.manager.invoke("key", resource, {
        action: "installRuntime",
        source: "file",
        resource,
        confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
        trustArtifact: true,
        createDesktopUser: true,
        installSystemPackages: false,
      }),
    ).rejects.toThrow("CONSENT_REQUIRED");
    expect(f.picker).not.toHaveBeenCalled();
    f.picker.mockResolvedValueOnce(undefined);
    await f.start();
    expect(f.request).not.toHaveBeenCalled();
    expect((await f.manager.status("key", resource)).exists).toBe(false);
  });

  it("prepares once, verifies the exact original receipt, then launches once", async () => {
    const f = await fixture();
    await f.start();
    expect((await f.idle()).phase).toBe("complete");
    expect(f.request.mock.calls.map(([value]) => value.action)).toEqual([
      "prepareEcsDesktop",
      "startEcsRuntimeInstallation",
      "openEcsTunnel",
      "closeEcsTunnel",
    ]);
    const prepare = f.request.mock.calls[0][0];
    const launch = f.request.mock.calls[1][0];
    expect(prepare).toMatchObject({
      action: "prepareEcsDesktop",
      resource,
      installSystemPackages: true,
      confirmation: `prepareEcsDesktop:${resource.regionId}:${resource.resourceId}`,
    });
    expect((prepare as { operationId: string }).operationId).not.toBe(
      (launch as { operationId: string }).operationId,
    );
  });

  it.each([
    "notSubmitted",
    "preparationFailed",
    "wrongResource",
    "invalidReady",
  ])(
    "does not launch a runtime after preparation returns %s",
    async (failure) => {
      const f = await fixture();
      const normal = f.request.getMockImplementation()!;
      f.request.mockImplementation(async (params) => {
        const result = await normal(params);
        if (params.action === "prepareEcsDesktop") {
          if (failure === "wrongResource")
            return {
              data: {
                ...result.data,
                request: {
                  ...result.data.request,
                  resource: { ...resource, resourceId: "i-other" },
                },
              },
            };
          if (failure === "invalidReady")
            return { data: { ...result.data, packagesPrepared: false } };
          return {
            data: { ...result.data, outcome: failure, packagesPrepared: false },
          };
        }
        return result;
      });
      await f.start();
      const status = await f.idle();
      expect(status.phase).toBe(
        ["notSubmitted", "preparationFailed"].includes(failure)
          ? "failed"
          : "needsAttention",
      );
      expect(f.request).toHaveBeenCalledTimes(1);
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
    },
  );

  it("recovers a lost preparation response after restart without another package installation", async () => {
    const f = await fixture();
    const normal = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (params) => {
      const result = await normal(params);
      if (params.action === "prepareEcsDesktop")
        throw new Error("lost preparation response");
      return result;
    });
    await f.start();
    const original = await f.idle();
    expect(original.phase).toBe("needsAttention");
    expect(original.createdAt).toEqual(expect.any(Number));
    const resumed = f.create();
    expect((await resumed.status("key", resource)).createdAt).toBe(
      original.createdAt,
    );
    expect(f.request).toHaveBeenCalledTimes(1);
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: original.operationId!,
    });
    expect((await f.idle(resumed)).phase).toBe("complete");
    expect(f.request.mock.calls.map(([value]) => value.action)).toEqual([
      "prepareEcsDesktop",
      "readOperation",
      "startEcsRuntimeInstallation",
      "openEcsTunnel",
      "closeEcsTunnel",
    ]);
  });

  it("can launch after interruption between preparation completion and launch intent", async () => {
    const f = await fixture();
    const write = ElectronEncryptedStateFile.prototype.write;
    let interrupted = false;
    const spy = vi
      .spyOn(ElectronEncryptedStateFile.prototype, "write")
      .mockImplementation(async function (
        this: ElectronEncryptedStateFile,
        value,
      ) {
        const state = value as {
          phase?: string;
          preparation?: { ready?: boolean; launchStartedAt?: number };
        };
        if (
          !interrupted &&
          state.phase === "launching" &&
          state.preparation?.ready &&
          state.preparation.launchStartedAt === undefined
        ) {
          interrupted = true;
          throw new Error("interrupted before launch intent");
        }
        return write.call(this, value);
      });
    try {
      await f.start();
      const original = await f.idle();
      expect(original.phase).toBe("needsAttention");
      const resumed = f.create();
      await resumed.invoke("key", resource, {
        action: "resumeInstallation",
        resource,
        operationId: original.operationId!,
      });
      expect((await f.idle(resumed)).phase).toBe("complete");
      expect(f.request.mock.calls.map(([value]) => value.action)).toEqual([
        "prepareEcsDesktop",
        "startEcsRuntimeInstallation",
        "openEcsTunnel",
        "closeEcsTunnel",
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("gives the upload its own time window after a long preparation", async () => {
    const f = await fixture();
    const normal = f.request.getMockImplementation()!;
    const initial = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(initial);
    f.request.mockImplementation(async (params) => {
      const result = await normal(params);
      if (params.action === "prepareEcsDesktop")
        clock.mockReturnValue(initial + 29 * 60_000);
      return result;
    });
    try {
      await f.start();
      expect((await f.idle()).phase).toBe("complete");
    } finally {
      clock.mockRestore();
    }
  });

  it("reconnects through the same fixed TLS owner without a picker, artifact upload or token in metadata", async () => {
    const f = await fixture();
    await expect(
      f.manager.invoke("key", resource, {
        action: "reconnectRuntime",
        resource,
        confirmation: `reconnectRuntime:${resource.regionId}:${resource.resourceId}`,
        workSaved: false,
      }),
    ).rejects.toThrow("CONSENT_REQUIRED");
    expect(f.request).not.toHaveBeenCalled();
    await f.reconnect();
    const status = await f.idle();
    expect(status).toMatchObject({
      mode: "reconnect",
      phase: "complete",
      connectionSaved: true,
    });
    expect(f.picker).not.toHaveBeenCalled();
    expect(
      f.request.mock.calls.filter(
        ([value]) => value.action === "reconnectEcsRuntime",
      ),
    ).toHaveLength(1);
    expect(
      f.transport.mock.calls.filter(([, , route]) => route === "/reconnect"),
    ).toHaveLength(1);
    expect(
      f.transport.mock.calls.some(([, , route]) => route === "/runtime"),
    ).toBe(false);
    expect(f.save).toHaveBeenCalledExactlyOnceWith(
      resource,
      "synthetic_token_".repeat(3),
      true,
    );
    expect(JSON.stringify(status)).not.toContain("synthetic_token_");
    const restarted = f.create();
    expect(await restarted.status("key", resource)).toEqual(status);
    expect(await restarted.blocksConnectionOpen("key", resource)).toBe(false);
  });

  it("reads the original rotated credentials after a lost TLS response without replaying the rotation", async () => {
    const f = await fixture();
    const original = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (...args) => {
      const value = await original(...args);
      if (args[2] === "/reconnect") throw new Error("lost reset response");
      return value;
    });
    await f.reconnect();
    const unknown = await f.idle();
    expect(unknown.phase).toBe("needsAttention");
    expect(await f.manager.blocksConnectionOpen("key", resource)).toBe(true);
    const restarted = f.create();
    await restarted.status("key", resource);
    expect(
      f.transport.mock.calls.filter(([, , route]) => route === "/reconnect"),
    ).toHaveLength(1);
    await restarted.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: unknown.operationId!,
    });
    expect((await f.idle(restarted)).phase).toBe("complete");
    expect(
      f.transport.mock.calls.filter(([, , route]) => route === "/reconnect"),
    ).toHaveLength(1);
    expect(
      f.request.mock.calls.filter(
        ([value]) => value.action === "reconnectEcsRuntime",
      ),
    ).toHaveLength(1);
    expect(f.save).toHaveBeenCalledTimes(1);
  });
  it("keeps polling when the job completes while a status snapshot is being read", async () => {
    const f = await fixture();
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const finishReached = deferred();
    const releaseFinish = deferred();
    const snapshotRead = deferred();
    const releaseSnapshot = deferred();
    const transport = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (...args) => {
      if (args[2] === "/finish") {
        finishReached.resolve();
        await releaseFinish.promise;
      }
      return transport(...args);
    });
    const read = ElectronEncryptedStateFile.prototype.read;
    let holdSnapshot = false;
    const spy = vi
      .spyOn(ElectronEncryptedStateFile.prototype, "read")
      .mockImplementation(async function (this: ElectronEncryptedStateFile) {
        const state = await read.call(this);
        if (
          holdSnapshot &&
          (state as { phase?: string } | null)?.phase === "finishPending"
        ) {
          holdSnapshot = false;
          snapshotRead.resolve();
          await releaseSnapshot.promise;
        }
        return state;
      });
    try {
      await f.start();
      await finishReached.promise;
      holdSnapshot = true;
      const pending = f.manager.status("key", resource);
      await snapshotRead.promise;
      releaseFinish.resolve();
      expect(await f.idle()).toMatchObject({ phase: "complete", busy: false });
      releaseSnapshot.resolve();
      expect(await pending).toMatchObject({
        phase: "finishPending",
        busy: true,
      });
      expect(await f.manager.status("key", resource)).toMatchObject({
        phase: "complete",
        busy: false,
      });
      expect(f.save).toHaveBeenCalledTimes(1);
      expect(
        f.transport.mock.calls.filter((call) => call[2] === "/finish"),
      ).toHaveLength(1);
    } finally {
      releaseFinish.resolve();
      releaseSnapshot.resolve();
      spy.mockRestore();
      await f.manager.stop();
    }
  });

  it("keeps saved credentials on a lost finish response and resumes only closing the service", async () => {
    const f = await fixture();
    const normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (...args) => {
      if (args[2] === "/finish") throw new Error("lost finish response");
      return normal(...args);
    });
    await f.start();
    const interrupted = await f.idle();
    expect(interrupted.phase).toBe("needsAttention");
    expect(interrupted.connectionSaved).toBe(true);
    expect(f.save).toHaveBeenCalledTimes(1);
    const count = f.transport.mock.calls.length;
    const resumed = f.create();
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: interrupted.operationId!,
    });
    expect((await f.idle(resumed)).connectionSaved).toBe(true);
    expect(f.transport.mock.calls.slice(count).map((args) => args[2])).toEqual([
      "/finish",
    ]);
    expect(f.save).toHaveBeenCalledTimes(1);
  });
  it("requires both consents before the picker, then saves credentials before closing the temporary service", async () => {
    const f = await fixture();
    await expect(
      f.manager.invoke("key", resource, {
        action: "installRuntime",
        source: "file",
        resource,
        confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
        trustArtifact: false,
        createDesktopUser: true,
        installSystemPackages: true,
      }),
    ).rejects.toThrow("CONSENT");
    expect(f.picker).not.toHaveBeenCalled();
    expect((await f.manager.status("key", resource)).exists).toBe(false);
    expect(f.request).not.toHaveBeenCalled();
    await f.start();
    const status = await f.idle();
    expect(status.phase).toBe("complete");
    expect(status.connectionSaved).toBe(true);
    expect(f.save).toHaveBeenCalledExactlyOnceWith(
      resource,
      "synthetic_token_".repeat(3),
    );
    expect(f.transport.mock.calls.map((call) => call[2])).toEqual([
      "/status",
      "/runtime",
      "/status",
      "/credentials",
      "/finish",
    ]);
    expect(f.save.mock.invocationCallOrder[0]).toBeLessThan(
      f.transport.mock.invocationCallOrder.at(-1)!,
    );
    expect(f.request).toHaveBeenCalledTimes(4);
    for (const secret of [
      f.root,
      "certificate",
      "capability",
      "testVnc8",
      "synthetic_token_",
    ])
      expect(JSON.stringify(status)).not.toContain(secret);
    expect(JSON.stringify(f.request.mock.calls)).not.toContain(
      "synthetic_token_",
    );
    const raw = await readFile(
      path.join(
        f.root,
        "cloud-desktop-connections/key/credentials/runtime-installation.v1",
      ),
      "utf8",
    );
    expect(raw).not.toContain(f.archive);
    expect(raw).not.toContain("testVnc8");
    const calls = f.transport.mock.calls.length;
    const shown = await f.manager.invoke("key", resource, {
      action: "showDesktopPassword",
      resource,
    });
    expect(f.showPassword).toHaveBeenCalledExactlyOnceWith("testVnc8");
    expect(f.transport).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify(shown)).not.toContain("testVnc8");
  });

  it("recovers a lost upload response after restart without another launch or PUT", async () => {
    const f = await fixture();
    const normal = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (...args) => {
      const result = await normal(...args);
      if (args[2] === "/runtime")
        throw new Error("Authorization: secret-network-error");
      return result;
    });
    await f.start();
    const interrupted = await f.idle();
    expect(interrupted.phase).toBe("needsAttention");
    const resumed = f.create();
    expect((await resumed.status("key", resource)).busy).toBe(false);
    expect(f.request).toHaveBeenCalledTimes(4);
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: interrupted.operationId!,
    });
    expect((await f.idle(resumed)).phase).toBe("complete");
    expect(f.request).toHaveBeenCalledTimes(6);
    expect(
      f.transport.mock.calls.filter((call) => call[2] === "/runtime"),
    ).toHaveLength(1);
    expect(JSON.stringify(await resumed.status("key", resource))).not.toContain(
      "secret-network-error",
    );
  });

  it("recovers the original unknown cloud launch with readOperation and rejects another operation identity", async () => {
    const f = await fixture();
    const normal = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (params) => {
      const result = await normal(params);
      if (params.action === "startEcsRuntimeInstallation")
        throw new Error("lost response");
      return result;
    });
    await f.start();
    const interrupted = await f.idle();
    expect(interrupted.phase).toBe("needsAttention");
    await expect(f.start()).rejects.toThrow("UNRESOLVED");
    await expect(
      f.manager.invoke("key", resource, {
        action: "resumeInstallation",
        resource,
        operationId: "wrong",
      }),
    ).rejects.toThrow("STATE_INVALID");
    const resumed = f.create();
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: interrupted.operationId!,
    });
    expect((await f.idle(resumed)).phase).toBe("complete");
    expect(f.request.mock.calls.map(([params]) => params.action)).toEqual([
      "prepareEcsDesktop",
      "startEcsRuntimeInstallation",
      "readOperation",
      "openEcsTunnel",
      "closeEcsTunnel",
    ]);
  });

  it("never replays an upload whose durable submission intent has an unknown result", async () => {
    const f = await fixture();
    f.transport.mockImplementation(async (target, _capability, route) => {
      if (route === "/runtime") throw new Error("submission not observed");
      return {
        operationId: target.operationId,
        expiresAt: target.expiresAt,
        phase: "waiting",
      };
    });
    await f.start();
    const status = await f.idle();
    const resumed = f.create();
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: status.operationId!,
    });
    const result = await f.idle(resumed);
    expect(result.diagnostic).toBe("CLOUD_INSTALL_UPLOAD_UNKNOWN");
    expect(
      f.transport.mock.calls.filter((call) => call[2] === "/runtime"),
    ).toHaveLength(1);
    expect(f.save).not.toHaveBeenCalled();
  });

  it("rejects mismatched supplier identity and changed artifacts without saving credentials", async () => {
    const f = await fixture();
    const normal = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (params) => {
      const result = await normal(params);
      if (params.action !== "prepareEcsDesktop" && result.data.request)
        result.data.request.resource.resourceId = "i-someone-else";
      return result;
    });
    await f.start();
    expect((await f.idle()).phase).toBe("needsAttention");
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    const privateFile = new ElectronEncryptedStateFile(
      path.join(f.root, "cloud-desktop-connections/key"),
      "runtime-installation.v1",
      safeStorage,
    );
    const state = (await privateFile.read()) as Record<string, unknown>;
    state.upload = {
      operationId: state.operationId,
      certificate: "fixture",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };
    await privateFile.write(state);
    await writeFile(f.archive, "changed");
    const resumed = f.create();
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: String(state.operationId),
    });
    expect((await f.idle(resumed)).phase).toBe("needsAttention");
    expect(
      f.transport.mock.calls.filter((call) => call[2] === "/runtime"),
    ).toHaveLength(0);
  });
});
