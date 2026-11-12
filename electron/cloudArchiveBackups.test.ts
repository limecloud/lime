// @vitest-environment node
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { CloudArchiveBackups } from "./cloudArchiveBackups";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";

it("persists cross-desktop evidence and checks original bytes, target and consent before release", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lime-backup-evidence-"));
  try {
    const storage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "gnome_libsecret",
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    };
    const source = {
      provider: "ecs" as const,
      profile: "mine",
      regionId: "cn-test",
      resourceId: "i-source",
    };
    const target = { ...source, resourceId: "i-target" };
    const localPath = path.join(root, "test.age");
    const content = Buffer.from("synthetic backup");
    await writeFile(localPath, content, { mode: 0o600 });
    const sha256 = createHash("sha256").update(content).digest("hex");
    const backups = new CloudArchiveBackups(storage);
    await backups.remember(root, {
      kind: "archiveDownload",
      canceled: false,
      bytes: content.length,
      sha256,
      localPath,
    });
    expect(
      await backups.markRestored(
        root,
        source,
        { ...source, profile: "alias" },
        sha256,
      ),
    ).toBe(false);
    expect(
      await backups.markRestored(root, source, target, "0".repeat(64)),
    ).toBe(false);
    expect(
      await backups.markRestored(root, source, target, sha256.toUpperCase()),
    ).toBe(true);

    const restarted = new CloudArchiveBackups(storage);
    expect(await restarted.read(root)).toEqual({
      sha256,
      savedAt: expect.any(String),
      restoredTo: target,
    });
    const release = {
      action: "releaseWithBackup" as const,
      resource: source,
      operationId: randomUUID(),
      confirmation: "release:cn-test:i-source:discard-data",
      archiveSha256: sha256,
      restoredTo: target,
      workSaved: true,
      discardData: true,
      applicationsValidated: true,
    };
    let status = "Released";
    let failAfterSubmission = false;
    const request = vi.fn<CloudDesktopRequest>(async (params) => {
      if (params.action === "inspect") return { data: { status } };
      if (failAfterSubmission) throw new Error("lost release response");
      return { data: { outcome: "accepted" } };
    });
    const signal = new AbortController().signal;
    const denied = {
      kind: "releaseWithBackup",
      data: { outcome: "notSubmitted", submitted: false },
    };
    expect(
      await restarted.release(
        root,
        { ...release, applicationsValidated: false },
        request,
        signal,
      ),
    ).toEqual(denied);
    expect(
      await restarted.release(
        root,
        { ...release, restoredTo: { ...target, resourceId: "i-other" } },
        request,
        signal,
      ),
    ).toEqual(denied);
    await writeFile(localPath, Buffer.alloc(content.length, 0x41));
    expect(await restarted.release(root, release, request, signal)).toEqual(
      denied,
    );
    expect(request).not.toHaveBeenCalled();

    await writeFile(localPath, content);
    expect(await restarted.release(root, release, request, signal)).toEqual(
      denied,
    );
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "inspect",
      resource: target,
    });
    status = "Stopped";
    expect(await restarted.release(root, release, request, signal)).toEqual({
      kind: "releaseWithBackup",
      data: { outcome: "accepted" },
    });
    expect(request).toHaveBeenLastCalledWith({
      action: "release",
      resource: source,
      operationId: release.operationId,
      confirmation: release.confirmation,
      workSaved: true,
      discardData: true,
    });
    failAfterSubmission = true;
    await expect(
      restarted.release(root, release, request, signal),
    ).rejects.toThrow("lost release response");

    await backups.remember(root, {
      kind: "archiveDownload",
      canceled: false,
      bytes: content.length,
      sha256,
      localPath,
    });
    expect(await restarted.release(root, release, request, signal)).toEqual(
      denied,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
