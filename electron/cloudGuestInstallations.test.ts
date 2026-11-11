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
    | Extract<CloudDesktopParams, { action: "startEcsRuntimeInstallation" }>
    | undefined;
  let guestPhase = "waiting";
  const expiresAt = Math.floor(Date.now() / 1000) + 120;
  const request = vi.fn(async (params: CloudDesktopParams) => {
    if (params.action === "startEcsRuntimeInstallation") original = params;
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
          artifact,
        },
        outcome: "runtimeUploadReady",
        publicAddress: "47.1.2.3",
        expiresAt,
        upload: {
          operationId: original.operationId,
          publicAddress: "47.1.2.3",
          certificate: "explicit-public-certificate-fixture",
          expiresAt,
        },
      },
    };
  });
  const transport = vi.fn<typeof requestCloudGuestUpload>(
    async (target, _capability, route, _signal, upload) => {
      if (route === "/runtime") {
        expect(upload?.bytes).toBe(bytes.length);
        const blocks: Buffer[] = [];
        for await (const block of upload!.file.createReadStream({
          start: 0,
          autoClose: false,
        }))
          blocks.push(block);
        expect(Buffer.concat(blocks)).toEqual(bytes);
        guestPhase = "installed";
      }
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
  const picker = vi.fn(async () => archive);
  const showPassword = vi.fn(async () => undefined);
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
    );
  const manager = create();
  const start = () =>
    manager.invoke("key", resource, {
      action: "installRuntime",
      resource,
      confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
      trustArtifact: true,
      createDesktopUser: true,
    });
  const idle = async (owner = manager) => {
    for (let i = 0; i < 1000; i++) {
      const status = await owner.status("key", resource);
      if (!status.busy) return status;
      await delay(2);
    }
    throw new Error("fixture did not settle");
  };
  return {
    root,
    archive,
    manager,
    create,
    request,
    transport,
    save,
    picker,
    start,
    idle,
    showPassword,
  };
}

describe("private cloud runtime orchestration", () => {
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
        resource,
        confirmation: `installRuntime:${resource.regionId}:${resource.resourceId}`,
        trustArtifact: false,
        createDesktopUser: true,
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
    expect(f.request).toHaveBeenCalledTimes(1);
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
    expect(f.request).toHaveBeenCalledTimes(1);
    await resumed.invoke("key", resource, {
      action: "resumeInstallation",
      resource,
      operationId: interrupted.operationId!,
    });
    expect((await f.idle(resumed)).phase).toBe("complete");
    expect(f.request).toHaveBeenCalledTimes(1);
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
      "startEcsRuntimeInstallation",
      "readOperation",
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
      publicAddress: "47.1.2.3",
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
