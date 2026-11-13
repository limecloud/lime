// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { Buffer } from "node:buffer";
import path from "node:path";
import { CloudModelConnections } from "./cloudModelConnections";
import { LocalCredentialEncryption } from "./localCredentialEncryption";
import type { CloudDesktopParams } from "@limecloud/app-server-client";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const resource = {
  provider: "ecs" as const,
  profile: "fixture",
  regionId: "cn-test",
  resourceId: "i-test",
};
const credential = {
  tenantId: "fixture-target",
  endpoint: "wss://cloud.invalid/rpc",
  token: "fixture-private-token",
};
const share = {
  action: "shareModelConnection" as const,
  resource,
  providerId: "selected-provider",
  keyId: "selected-key",
  confirmation: "share-model:cn-test:i-test:selected-provider:selected-key",
};

async function fixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lime-model-transfer-host-"),
  );
  roots.push(root);
  const encryption = new LocalCredentialEncryption(root);
  const ciphertext = Buffer.from("age-encrypted-fixture").toString("base64");
  const local = vi.fn(async (params: CloudDesktopParams) => ({
    data: {
      operationId: "operationId" in params ? params.operationId : "",
      ciphertext,
    },
  }));
  const owner = () => new CloudModelConnections(encryption, local);
  let phase = "notFound";
  const remote = vi.fn(async (params: CloudDesktopParams) => {
    if (params.action === "prepareModelConnection") phase = "prepared";
    if (params.action === "applyModelConnection") phase = "complete";
    return {
      data: {
        operationId: "operationId" in params ? params.operationId : "",
        phase,
        recipient: `age1${"q".repeat(58)}`,
        expiresAt: Math.floor(Date.now() / 1000) + 590,
      },
    };
  });
  return {
    root,
    owner,
    local,
    remote,
    ciphertext,
    setPhase: (value: string) => {
      phase = value;
    },
  };
}

it("seals only the selected key for this destination and exposes only sanitized status", async () => {
  const f = await fixture();
  const result = await f
    .owner()
    .invoke(f.root, resource, credential, share, f.remote);
  expect(result).toMatchObject({
    kind: "modelConnection",
    phase: "complete",
    providerId: share.providerId,
    keyId: share.keyId,
  });
  expect(Object.keys(result).sort()).toEqual([
    "keyId",
    "kind",
    "operationId",
    "phase",
    "providerId",
  ]);
  expect(f.local).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      action: "sealModelConnection",
      providerId: share.providerId,
      keyId: share.keyId,
    }),
  );
  expect(f.remote.mock.calls.map(([p]) => p.action)).toEqual([
    "readModelConnection",
    "prepareModelConnection",
    "applyModelConnection",
  ]);
  const saved = await readFile(
    path.join(f.root, "credentials", "model-connection.v1"),
  );
  expect(saved.toString()).not.toContain(share.providerId);
  expect(saved.toString()).not.toContain(f.ciphertext);
  expect(JSON.stringify(result)).not.toMatch(
    /ciphertext|token|recipient|endpoint/,
  );
});

it("lost completion survives a new owner and resumes by reading without another apply", async () => {
  const f = await fixture();
  expect(
    await CloudModelConnections.blocksConnectionChange(
      f.root,
      f.owner().safeStorage,
    ),
  ).toBe(false);
  const wrapped = vi.fn(async (params: CloudDesktopParams) => {
    const result = await f.remote(params);
    if (params.action === "applyModelConnection")
      throw new Error("private response lost");
    return result;
  });
  await expect(
    f.owner().invoke(f.root, resource, credential, share, wrapped),
  ).rejects.toThrow(/^CLOUD_MODEL_CONNECTION_FAILED$/);
  const status = await f.owner().invoke(f.root, resource, null, {
    action: "modelConnectionStatus",
    resource,
  });
  expect(status.phase).toBe("unknown");
  expect(
    await CloudModelConnections.blocksConnectionChange(
      f.root,
      f.owner().safeStorage,
    ),
  ).toBe(true);
  const resumed = await f.owner().invoke(
    f.root,
    resource,
    credential,
    {
      action: "resumeModelConnection",
      resource,
      operationId: status.operationId!,
    },
    f.remote,
  );
  expect(resumed.phase).toBe("complete");
  expect(
    await CloudModelConnections.blocksConnectionChange(
      f.root,
      f.owner().safeStorage,
    ),
  ).toBe(false);
  expect(
    f.remote.mock.calls.filter(([p]) => p.action === "applyModelConnection"),
  ).toHaveLength(1);
  expect(f.local).toHaveBeenCalledTimes(1);
});

it("explicit resume sends the persisted ciphertext and rejects a new share while unresolved", async () => {
  const f = await fixture();
  const lost = async (params: CloudDesktopParams) => {
    if (params.action === "applyModelConnection") {
      f.setPhase("receiving");
      throw new Error("lost");
    }
    return f.remote(params);
  };
  await expect(
    f.owner().invoke(f.root, resource, credential, share, lost),
  ).rejects.toThrow();
  await expect(
    f.owner().invoke(f.root, resource, credential, share, f.remote),
  ).rejects.toThrow();
  const state = await f.owner().invoke(f.root, resource, null, {
    action: "modelConnectionStatus",
    resource,
  });
  await f.owner().invoke(
    f.root,
    resource,
    credential,
    {
      action: "resumeModelConnection",
      resource,
      operationId: state.operationId!,
    },
    f.remote,
  );
  expect(f.remote).toHaveBeenLastCalledWith({
    action: "applyModelConnection",
    operationId: state.operationId,
    ciphertext: f.ciphertext,
  });
  expect(f.local).toHaveBeenCalledTimes(1);
});

it("missing confirmation, changed target and malformed recipients cannot expose a key", async () => {
  const f = await fixture();
  await expect(
    f
      .owner()
      .invoke(
        f.root,
        resource,
        credential,
        { ...share, confirmation: "" },
        f.remote,
      ),
  ).rejects.toThrow();
  expect(f.local).not.toHaveBeenCalled();
  expect(f.remote).not.toHaveBeenCalled();
  const malformed = async (params: CloudDesktopParams) => {
    const result = await f.remote(params);
    return { data: { ...result.data, recipient: "attacker" } };
  };
  await expect(
    f.owner().invoke(f.root, resource, credential, share, malformed),
  ).rejects.toThrow();
  const state = await f.owner().invoke(f.root, resource, null, {
    action: "modelConnectionStatus",
    resource,
  });
  const before = f.remote.mock.calls.length;
  await expect(
    f.owner().invoke(
      f.root,
      resource,
      { ...credential, token: "another" },
      {
        action: "resumeModelConnection",
        resource,
        operationId: state.operationId!,
      },
      f.remote,
    ),
  ).rejects.toThrow();
  expect(f.remote).toHaveBeenCalledTimes(before);
  expect(f.local).not.toHaveBeenCalled();
});

it("an expired receiver is terminal without resealing or applying", async () => {
  const f = await fixture();
  const lost = async (params: CloudDesktopParams) => {
    if (params.action === "applyModelConnection") throw new Error("lost");
    return f.remote(params);
  };
  await expect(
    f.owner().invoke(f.root, resource, credential, share, lost),
  ).rejects.toThrow();
  const state = await f.owner().invoke(f.root, resource, null, {
    action: "modelConnectionStatus",
    resource,
  });
  f.setPhase("expired");
  const result = await f.owner().invoke(
    f.root,
    resource,
    credential,
    {
      action: "resumeModelConnection",
      resource,
      operationId: state.operationId!,
    },
    f.remote,
  );
  expect(result.phase).toBe("expired");
  expect(
    await CloudModelConnections.blocksConnectionChange(
      f.root,
      f.owner().safeStorage,
    ),
  ).toBe(false);
  expect(f.local).toHaveBeenCalledTimes(1);
  expect(
    f.remote.mock.calls.filter(([p]) => p.action === "applyModelConnection"),
  ).toHaveLength(0);
});
