// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CloudDesktopResource } from "@limecloud/app-server-client";
import { CloudGuestInstallations } from "./cloudGuestInstallations";
import type { CloudDesktopRequest } from "./cloudDesktopTaskTunnel";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const resource: CloudDesktopResource = {
  provider: "ecs",
  profile: "test",
  regionId: "cn-test",
  resourceId: "i-cold",
};
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString(),
};
async function fixture(invalidWaiting: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lime-agent-ready-"));
  roots.push(root);
  const archive = path.join(root, "test.tar.gz"),
    bytes = Buffer.from("explicit synthetic artifact");
  await writeFile(archive, bytes);
  await writeFile(
    archive + ".json",
    JSON.stringify({
      schemaVersion: 1,
      archive: path.basename(archive),
      archiveBytes: bytes.length,
      archiveSha256: createHash("sha256").update(bytes).digest("hex"),
      manifestSha256: "b".repeat(64),
    }),
  );
  let ready = false,
    submitted = false,
    loseResponse = false,
    preparationId: string | undefined;
  const requests: Parameters<CloudDesktopRequest>[0][] = [];
  const save = vi.fn(async () => undefined);
  const request: CloudDesktopRequest = async (params) => {
    requests.push(params);
    if (params.action === "startEcsRuntimeInstallation")
      return new Promise(() => {});
    if (params.action === "prepareEcsDesktop") {
      preparationId ??= params.operationId;
      expect(params.operationId).toBe(preparationId);
      if (ready) {
        expect(submitted).toBe(false);
        submitted = true;
        if (loseResponse) throw new Error("explicit lost submission response");
      }
    } else {
      expect(params.action).toBe("readOperation");
      expect((params as { operationId: string }).operationId).toBe(
        preparationId,
      );
    }
    return {
      data: {
        operationId: preparationId,
        request: {
          action: "prepareEcsDesktop",
          resource,
          installSystemPackages: true,
        },
        outcome: submitted ? "dependenciesReady" : "waitingForAgent",
        packagesPrepared: submitted,
        ...(!submitted
          ? {
              submitted: false,
              requiresInspection: false,
              agentReady: ready,
              ...invalidWaiting,
            }
          : {}),
      },
    };
  };
  const managers: CloudGuestInstallations[] = [];
  const create = () => {
    const owner = new CloudGuestInstallations(
      root,
      safeStorage,
      request,
      async () => archive,
      save,
      undefined,
      1,
    );
    managers.push(owner);
    return owner;
  };
  const manager = create();
  const start = () =>
    manager.invoke("cold", resource, {
      action: "installRuntime",
      source: "file",
      resource,
      confirmation: "installRuntime:cn-test:i-cold",
      trustArtifact: true,
      createDesktopUser: true,
      installSystemPackages: true,
    });
  return {
    root,
    manager,
    create,
    managers,
    start,
    requests,
    save,
    ready: () => {
      ready = true;
    },
    loseResponse: () => {
      loseResponse = true;
    },
    submitted: () => submitted,
  };
}

it("waits with read-only polls, then continues the same preparation identity once", async () => {
  const f = await fixture();
  try {
    const original = await f.start();
    await vi.waitFor(async () =>
      expect((await f.manager.status("cold", resource)).phase).toBe(
        "waitingForAgent",
      ),
    );
    await vi.waitFor(() =>
      expect(
        f.requests.filter((x) => x.action === "readOperation").length,
      ).toBeGreaterThan(1),
    );
    expect(
      f.requests.filter((x) => x.action === "prepareEcsDesktop"),
    ).toHaveLength(1);
    expect(f.submitted()).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
    f.ready();
    await vi.waitFor(() =>
      expect(
        f.requests.some((x) => x.action === "startEcsRuntimeInstallation"),
      ).toBe(true),
    );
    expect(
      f.requests.filter((x) => x.action === "prepareEcsDesktop"),
    ).toHaveLength(2);
    expect((await f.manager.status("cold", resource)).operationId).toBe(
      original.operationId,
    );
    expect((await f.manager.status("cold", resource)).createdAt).toBe(
      original.createdAt,
    );
  } finally {
    await Promise.all(f.managers.map((owner) => owner.stop()));
  }
});

it.each([
  { submitted: true },
  { agentReady: "true" },
  { invokeId: "already-submitted" },
])(
  "rejects invalid waiting evidence %j without a second preparation",
  async (invalid) => {
    const f = await fixture(invalid);
    try {
      await f.start();
      await vi.waitFor(async () =>
        expect((await f.manager.status("cold", resource)).phase).toBe(
          "needsAttention",
        ),
      );
      expect(f.requests).toHaveLength(1);
      expect(f.submitted()).toBe(false);
    } finally {
      await Promise.all(f.managers.map((owner) => owner.stop()));
    }
  },
);

it("stops a wait and resumes its original receipt after restart without a new intent", async () => {
  const f = await fixture();
  try {
    const original = await f.start();
    await vi.waitFor(async () =>
      expect((await f.manager.status("cold", resource)).phase).toBe(
        "waitingForAgent",
      ),
    );
    await f.manager.stop();
    const next = f.create();
    const before = f.requests.length;
    expect((await next.status("cold", resource)).operationId).toBe(
      original.operationId,
    );
    expect(f.requests).toHaveLength(before);
    await next.invoke("cold", resource, {
      action: "resumeInstallation",
      resource,
      operationId: original.operationId!,
    });
    await vi.waitFor(async () =>
      expect((await next.status("cold", resource)).phase).toBe(
        "waitingForAgent",
      ),
    );
    expect(
      f.requests.filter((x) => x.action === "prepareEcsDesktop"),
    ).toHaveLength(1);
    f.ready();
    await vi.waitFor(() => expect(f.submitted()).toBe(true));
    expect(
      f.requests.filter((x) => x.action === "prepareEcsDesktop"),
    ).toHaveLength(2);
  } finally {
    await Promise.all(f.managers.map((owner) => owner.stop()));
  }
});

it("does not resubmit when the response to the one ready submission was lost", async () => {
  const f = await fixture();
  try {
    const original = await f.start();
    await vi.waitFor(async () =>
      expect((await f.manager.status("cold", resource)).phase).toBe(
        "waitingForAgent",
      ),
    );
    f.loseResponse();
    f.ready();
    await vi.waitFor(async () =>
      expect((await f.manager.status("cold", resource)).phase).toBe(
        "needsAttention",
      ),
    );
    await f.manager.stop();
    const next = f.create();
    await next.invoke("cold", resource, {
      action: "resumeInstallation",
      resource,
      operationId: original.operationId!,
    });
    await vi.waitFor(() =>
      expect(
        f.requests.some((x) => x.action === "startEcsRuntimeInstallation"),
      ).toBe(true),
    );
    expect(
      f.requests.filter((x) => x.action === "prepareEcsDesktop"),
    ).toHaveLength(2);
  } finally {
    await Promise.all(f.managers.map((owner) => owner.stop()));
  }
});
