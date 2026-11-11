import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ElectronSecureCredentialStore,
  ElectronEncryptedStateFile,
  type SafeStorageLike,
} from "./secureCredentialStore";

const tempRoots: string[] = [];

function createSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) =>
      Buffer.from(Buffer.from(plainText, "utf8").toString("base64url"), "utf8"),
    decryptString: (encrypted) =>
      Buffer.from(encrypted.toString("utf8"), "base64url").toString("utf8"),
  };
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lime-secure-credentials-"),
  );
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ElectronSecureCredentialStore", () => {
  it("原子替换时读取完整快照，仍拒绝多重硬链接", async () => {
    const root = await createRoot();
    const file = new ElectronEncryptedStateFile(
      root,
      "runtime-installation.v1",
      createSafeStorage(),
    );
    await file.write({ revision: 0 });
    await Promise.all([
      (async () => {
        for (let revision = 1; revision <= 80; revision++)
          await file.write({ revision });
      })(),
      (async () => {
        for (let i = 0; i < 160; i++)
          expect(await file.read()).toMatchObject({
            revision: expect.any(Number),
          });
      })(),
    ]);
    expect(await file.read()).toEqual({ revision: 80 });
    await link(file.filePath, path.join(root, "alias"));
    await expect(file.read()).rejects.toThrow("encrypted state is invalid");
  });
  it("保留加密的连接方式并拒绝未知方式", async () => {
    const root = await createRoot();
    const store = new ElectronSecureCredentialStore(root, createSafeStorage());
    const credential = {
      tenantId: "resource",
      endpoint: "ws://127.0.0.1:8787/",
      token: "guest-secret",
      transport: "ecsTunnel" as const,
    };
    await expect(
      store.setCloudSessionCredential(credential),
    ).resolves.toMatchObject({ transport: "ecsTunnel" });
    await expect(store.readCloudSessionCredential()).resolves.toEqual(
      credential,
    );
    await expect(
      store.setCloudSessionCredential({
        ...credential,
        transport: "unknown" as never,
      }),
    ).rejects.toThrow(/unsupported Cloud connection transport/);
    await expect(store.readCloudSessionCredential()).resolves.toEqual(
      credential,
    );
  });

  it.each([undefined, "basic_text", "unknown", "future_backend"])(
    "Linux 拒绝不可信凭据后端 %s",
    async (backend) => {
      const root = await createRoot();
      const storage = createSafeStorage();
      if (backend) storage.getSelectedStorageBackend = () => backend;
      const store = new ElectronSecureCredentialStore(root, storage, "linux");
      await expect(
        store.setCloudSessionCredential({
          tenantId: "tenant-001",
          endpoint: "wss://gateway.example.test",
          token: "session-secret",
        }),
      ).rejects.toThrow("secure credential storage is unavailable");
      await expect(store.getCloudSessionCredentialMetadata()).resolves.toEqual({
        available: false,
        exists: false,
      });
    },
  );

  it("Linux 使用真实 keyring 后端，锁定后拒绝读取既有凭据", async () => {
    const root = await createRoot();
    let unlocked = true;
    const storage = {
      ...createSafeStorage(),
      isEncryptionAvailable: () => unlocked,
      getSelectedStorageBackend: () => "gnome_libsecret",
    };
    const store = new ElectronSecureCredentialStore(root, storage, "linux");
    await store.setCloudSessionCredential({
      tenantId: "tenant-001",
      endpoint: "wss://gateway.example.test",
      token: "session-secret",
    });
    unlocked = false;
    await expect(store.readCloudSessionCredential()).rejects.toThrow(
      "secure credential storage is unavailable",
    );
    await expect(store.getCloudSessionCredentialMetadata()).resolves.toEqual({
      available: false,
      exists: true,
    });
  });

  it("加密保存 Cloud session，并只返回不含 token 的 metadata", async () => {
    const root = await createRoot();
    const store = new ElectronSecureCredentialStore(root, createSafeStorage());

    await expect(
      store.setCloudSessionCredential({
        tenantId: "tenant-001",
        endpoint: "wss://gateway.example.test/v1/app-server",
        token: "session-secret",
      }),
    ).resolves.toMatchObject({
      available: true,
      exists: true,
      tenantId: "tenant-001",
      endpoint: "wss://gateway.example.test/v1/app-server",
    });

    const stored = await readFile(
      path.join(root, "credentials", "app-server-session.v1"),
      "utf8",
    );
    expect(stored).not.toContain("session-secret");
    await expect(
      store.getCloudSessionCredentialMetadata(),
    ).resolves.toMatchObject({
      available: true,
      exists: true,
      tenantId: "tenant-001",
    });
    await expect(store.readCloudSessionCredential()).resolves.toEqual({
      tenantId: "tenant-001",
      endpoint: "wss://gateway.example.test/v1/app-server",
      token: "session-secret",
    });
  });

  it("拒绝不安全 endpoint、空 token 和明文 ws 公网地址", async () => {
    const root = await createRoot();
    const store = new ElectronSecureCredentialStore(root, createSafeStorage());

    await expect(
      store.setCloudSessionCredential({
        tenantId: "tenant-001",
        endpoint: "https://gateway.example.test/v1/app-server",
        token: "session-secret",
      }),
    ).rejects.toThrow("endpoint must use ws:// or wss://");
    await expect(
      store.setCloudSessionCredential({
        tenantId: "tenant-001",
        endpoint: "wss://gateway.example.test/v1/app-server?token=secret",
        token: "session-secret",
      }),
    ).rejects.toThrow("endpoint must not contain userinfo, query, or fragment");
    await expect(
      store.setCloudSessionCredential({
        tenantId: "tenant-001",
        endpoint: "ws://gateway.example.test/v1/app-server",
        token: "session-secret",
      }),
    ).rejects.toThrow("insecure ws:// endpoints must be loopback URLs");
    await expect(
      store.setCloudSessionCredential({
        tenantId: "tenant-001",
        endpoint: "wss://gateway.example.test/v1/app-server",
        token: "   ",
      }),
    ).rejects.toThrow("token must not be empty");
  });

  it("加密能力不可用时拒绝写入，但删除仍可幂等执行", async () => {
    const root = await createRoot();
    const store = new ElectronSecureCredentialStore(
      root,
      createSafeStorage(false),
    );

    await expect(
      store.setCloudSessionCredential({
        tenantId: "tenant-001",
        endpoint: "wss://gateway.example.test/v1/app-server",
        token: "session-secret",
      }),
    ).rejects.toThrow("secure credential storage is unavailable");
    await expect(store.getCloudSessionCredentialMetadata()).resolves.toEqual({
      available: false,
      exists: false,
    });
    await expect(store.deleteCloudSessionCredential()).resolves.toEqual({
      deleted: false,
    });
  });

  it("损坏的密文 fail closed，删除后回到空状态", async () => {
    const root = await createRoot();
    const filePath = path.join(root, "credentials", "app-server-session.v1");
    const store = new ElectronSecureCredentialStore(root, createSafeStorage());
    await store.setCloudSessionCredential({
      tenantId: "tenant-001",
      endpoint: "wss://gateway.example.test/v1/app-server",
      token: "session-secret",
    });
    await writeFile(filePath, "corrupt", "utf8");

    await expect(store.readCloudSessionCredential()).rejects.toThrow(
      "stored Cloud session credential is invalid",
    );
    await expect(store.deleteCloudSessionCredential()).resolves.toEqual({
      deleted: true,
    });
    await expect(store.getCloudSessionCredentialMetadata()).resolves.toEqual({
      available: true,
      exists: false,
    });
  });
});
