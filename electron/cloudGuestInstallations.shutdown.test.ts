// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CloudDesktopParams } from "@limecloud/app-server-client";
import { CloudGuestInstallations } from "./cloudGuestInstallations";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";
import type { requestCloudGuestUpload } from "./cloudGuestUpload";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it.each([
  "prepareEcsDesktop",
  "readOperation",
  "reconnectEcsRuntime",
  "openEcsTunnel",
  "closeEcsTunnel",
] as const)(
  "stops waiting for %s, preserves its durable identity and never replays the mutation",
  async (heldAction) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lime-install-shutdown-"),
    );
    roots.push(root);
    const resource = {
      provider: "ecs" as const,
      profile: "synthetic",
      regionId: "cn-test",
      resourceId: "i-test",
    };
    const safeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "local_key",
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    };
    const reached = deferred<void>();
    const release = deferred<void>();
    const pendingFinished = deferred<void>();
    let held = false;
    const submitted = new Map<string, CloudDesktopParams>();
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const artifact = {
      archiveBytes: 1024,
      archiveSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
    };
    const request = vi.fn<CloudDesktopRequest>(async (params) => {
      if (
        params.action === "prepareEcsDesktop" ||
        params.action === "reconnectEcsRuntime" ||
        params.action === "startEcsRuntimeInstallation"
      ) {
        expect(submitted.has(params.operationId)).toBe(false);
        submitted.set(params.operationId, params);
      }
      if (params.action === heldAction && !held) {
        held = true;
        reached.resolve();
        try {
          await release.promise;
        } finally {
          pendingFinished.resolve();
        }
      }
      if (
        params.action === "openEcsTunnel" ||
        params.action === "closeEcsTunnel"
      )
        return {
          data: {
            state: params.action === "openEcsTunnel" ? "listening" : "closed",
            channel: "installation",
            persistent: false,
            endpoint: "https://127.0.0.1:34567/",
          },
        };
      if (!("operationId" in params)) throw Error("unexpected request");
      const original = submitted.get(params.operationId);
      if (!original) throw Error("unknown operation identity");
      return {
        data: {
          operationId: params.operationId,
          request: {
            ...original,
            ...(original.action === "startEcsRuntimeInstallation"
              ? { artifact }
              : {}),
          },
          outcome:
            original.action === "prepareEcsDesktop"
              ? "dependenciesReady"
              : heldAction === "readOperation" &&
                  params.action === "reconnectEcsRuntime"
                ? "accepted"
                : "runtimeUploadReady",
          packagesPrepared: original.action === "prepareEcsDesktop",
          expiresAt,
          upload: {
            operationId: params.operationId,
            certificate: "explicit synthetic public certificate",
            expiresAt,
          },
        },
      };
    });
    const save = vi.fn(async () => undefined);
    const transport = vi.fn<typeof requestCloudGuestUpload>(
      async (target, _capability, route) =>
        route === "/credentials"
          ? {
              operationId: target.operationId,
              token: "synthetic_task_token_".repeat(3),
              viewerPassword: "testVnc8",
            }
          : {
              operationId: target.operationId,
              expiresAt,
              phase: route === "/finish" ? "finished" : "installed",
            },
    );
    const create = () =>
      new CloudGuestInstallations(
        root,
        safeStorage,
        request,
        async () => undefined,
        save,
        transport,
        1,
        undefined,
        async () => ({
          artifact,
          downloadUrl: "https://assets.example.com/guest.tar.gz",
        }),
      );
    const manager = create();
    let resumed: CloudGuestInstallations | undefined;
    const action =
      heldAction === "prepareEcsDesktop"
        ? "installRuntime"
        : "reconnectRuntime";
    try {
      await manager.invoke("key", resource, {
        action,
        resource,
        confirmation: `${action}:${resource.regionId}:${resource.resourceId}`,
        workSaved: true,
        source: "release",
        trustArtifact: true,
        createDesktopUser: true,
        installSystemPackages: true,
      });
      await reached.promise;
      const before = await manager.status("key", resource);
      let stopped = false;
      const stopping = manager.stop().then(() => {
        stopped = true;
      });
      await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 1000 });
      await stopping;
      const after = await manager.status("key", resource);
      expect(after).toMatchObject({
        operationId: before.operationId,
        createdAt: before.createdAt,
        busy: false,
        phase: heldAction === "closeEcsTunnel" ? "complete" : "needsAttention",
      });
      const stateFile = path.join(
        root,
        "cloud-desktop-connections/key/credentials/runtime-installation.v1",
      );
      const saved = await readFile(stateFile);
      if (heldAction === "reconnectEcsRuntime")
        release.reject(Error("late supplier failure"));
      else release.resolve();
      await pendingFinished.promise;
      expect(await readFile(stateFile)).toEqual(saved);
      resumed = create();
      await resumed.invoke("key", resource, {
        action: "resumeInstallation",
        resource,
        operationId: after.operationId!,
      });
      await vi.waitFor(async () =>
        expect(await resumed!.status("key", resource)).toMatchObject({
          operationId: before.operationId,
          createdAt: before.createdAt,
          busy: false,
          phase: "complete",
          connectionSaved: true,
        }),
      );
      expect(save).toHaveBeenCalledTimes(1);
      expect(
        request.mock.calls.filter(([p]) => p.action === "reconnectEcsRuntime"),
      ).toHaveLength(action === "reconnectRuntime" ? 1 : 0);
      expect(
        request.mock.calls.filter(([p]) => p.action === "prepareEcsDesktop"),
      ).toHaveLength(action === "installRuntime" ? 1 : 0);
      expect(
        transport.mock.calls.some(([, , route]) =>
          ["/runtime", "/download", "/reconnect"].includes(route),
        ),
      ).toBe(false);
    } finally {
      release.resolve();
      await manager.stop();
      await resumed?.stop();
    }
  },
);
