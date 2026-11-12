import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCredentialEncryption,
  LocalCredentialEncryption,
} from "./localCredentialEncryption";
import { ElectronSecureCredentialStore } from "./secureCredentialStore";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "lime-local-encryption-"));
  roots.push(root);
  return {
    root,
    keyPath: path.join(root, "credentials", "encryption-key.v1"),
    storage: new LocalCredentialEncryption(root),
  };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")(
  "LocalCredentialEncryption",
  () => {
    it.each(["darwin", "linux"] as const)(
      "%s 保存和重读不调用系统钥匙串，密文和密钥权限受限",
      async (platform) => {
        const { root, keyPath } = fixture();
        const vault = {
          isEncryptionAvailable: vi.fn(() => {
            throw new Error("OS vault must not be used");
          }),
          encryptString: vi.fn(() => {
            throw new Error("OS vault must not be used");
          }),
          decryptString: vi.fn(() => {
            throw new Error("OS vault must not be used");
          }),
        };
        const storage = createCredentialEncryption(root, platform, vault);
        const store = new ElectronSecureCredentialStore(
          root,
          storage,
          platform,
        );
        const credential = {
          tenantId: "fixture",
          endpoint: "ws://127.0.0.1:8787/",
          token: "synthetic-token-must-not-be-plaintext",
        };
        await store.setCloudSessionCredential(credential);
        const saved = readFileSync(
          path.join(root, "credentials", "app-server-session.v1"),
        );
        expect(saved.includes(credential.token)).toBe(false);
        expect(readFileSync(keyPath)).toHaveLength(32);
        expect(lstatSync(keyPath).mode & 0o777).toBe(0o600);
        expect(lstatSync(path.dirname(keyPath)).mode & 0o777).toBe(0o700);
        const recreated = new ElectronSecureCredentialStore(
          root,
          createCredentialEncryption(root, platform, vault),
          platform,
        );
        expect(await recreated.readCloudSessionCredential()).toEqual(
          credential,
        );
        expect(vault.isEncryptionAvailable).not.toHaveBeenCalled();
        expect(vault.encryptString).not.toHaveBeenCalled();
        expect(vault.decryptString).not.toHaveBeenCalled();
      },
    );

    it("随机 nonce、认证加密和独立密钥拒绝篡改及跨目录解密", () => {
      const { storage, keyPath } = fixture();
      const first = storage.encryptString("synthetic-secret");
      expect(storage.encryptString("synthetic-secret")).not.toEqual(first);
      expect(storage.decryptString(first)).toBe("synthetic-secret");
      const before = readFileSync(keyPath);
      for (const index of [16, 30, first.length - 1]) {
        const changed = Buffer.from(first);
        changed[index] ^= 1;
        expect(() => storage.decryptString(changed)).toThrow(
          "encrypted state is invalid",
        );
      }
      const other = fixture();
      other.storage.encryptString("create another key");
      expect(() => other.storage.decryptString(first)).toThrow(
        "encrypted state is invalid",
      );
      expect(readFileSync(keyPath)).toEqual(before);
    });

    it.each([
      "permissions",
      "symlink",
      "dangling-symlink",
      "hardlink",
      "truncated",
      "directory",
    ])("拒绝不安全或损坏的密钥 %s，不覆盖原文件", (kind) => {
      const { storage, keyPath, root } = fixture();
      const encrypted = storage.encryptString("synthetic-secret");
      if (kind === "permissions") chmodSync(keyPath, 0o644);
      if (kind === "truncated") writeFileSync(keyPath, "bad");
      if (kind === "symlink") {
        const target = path.join(root, "target");
        writeFileSync(target, readFileSync(keyPath), { mode: 0o600 });
        unlinkSync(keyPath);
        symlinkSync(target, keyPath);
      }
      if (kind === "hardlink") linkSync(keyPath, path.join(root, "alias"));
      if (kind === "dangling-symlink") {
        unlinkSync(keyPath);
        symlinkSync(path.join(root, "missing"), keyPath);
      }
      if (kind === "directory") {
        unlinkSync(keyPath);
        mkdirSync(keyPath);
      }
      const info = lstatSync(keyPath);
      expect(storage.isEncryptionAvailable()).toBe(false);
      expect(() => storage.decryptString(encrypted)).toThrow();
      expect(() => storage.encryptString("replacement")).toThrow();
      expect(lstatSync(keyPath).ino).toBe(info.ino);
      expect(lstatSync(keyPath).mode).toBe(info.mode);
    });

    it("读取时密钥丢失或旧钥匙串密文均不重新生成密钥或尝试系统解密", () => {
      const { storage, keyPath } = fixture();
      const encrypted = storage.encryptString("synthetic-secret");
      unlinkSync(keyPath);
      expect(() => storage.decryptString(encrypted)).toThrow();
      expect(existsSync(keyPath)).toBe(false);
      expect(() =>
        storage.decryptString(Buffer.from("old-keychain-ciphertext")),
      ).toThrow("encrypted state requires reconnection");
      expect(existsSync(keyPath)).toBe(false);
    });

    it("读取旧钥匙串记录时保留原密文且不生成新密钥", async () => {
      const { root, keyPath, storage } = fixture();
      const directory = path.join(root, "credentials");
      mkdirSync(directory, { mode: 0o700 });
      const original = Buffer.from("v10-synthetic-old-keychain-ciphertext");
      const credentialPath = path.join(directory, "app-server-session.v1");
      writeFileSync(credentialPath, original, { mode: 0o600 });
      const store = new ElectronSecureCredentialStore(root, storage, "darwin");
      await expect(store.readCloudSessionCredential()).rejects.toThrow(
        "stored Cloud session credential is invalid",
      );
      expect(readFileSync(credentialPath)).toEqual(original);
      expect(existsSync(keyPath)).toBe(false);
    });

    it("拒绝开放或符号链接密钥目录", () => {
      const { root, storage } = fixture();
      const directory = path.join(root, "credentials");
      mkdirSync(directory, { mode: 0o755 });
      expect(storage.isEncryptionAvailable()).toBe(false);
      expect(() => storage.encryptString("synthetic-secret")).toThrow(
        "must be private",
      );
      rmSync(directory, { recursive: true });
      const target = path.join(root, "private-target");
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, directory);
      expect(storage.isEncryptionAvailable()).toBe(false);
      expect(() => storage.encryptString("synthetic-secret")).toThrow(
        "must be private",
      );
    });

    it("独立 Node 进程可重读原密文，不依赖 Electron 或钥匙串", () => {
      const { root, storage } = fixture();
      const encrypted = storage.encryptString("synthetic-process-secret");
      const moduleUrl = pathToFileURL(
        path.resolve("electron/localCredentialEncryption.ts"),
      ).href;
      const script = `
      const { LocalCredentialEncryption } = await import(${JSON.stringify(moduleUrl)});
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const { root, encrypted } = JSON.parse(input);
      const value = new LocalCredentialEncryption(root).decryptString(Buffer.from(encrypted, 'base64'));
      process.stdout.write(value === 'synthetic-process-secret' ? 'verified' : 'invalid');
    `;
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          input: JSON.stringify({
            root,
            encrypted: encrypted.toString("base64"),
          }),
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("verified");
    });
  },
);

it("Windows 继续使用无密码框的系统 DPAPI 后端", () => {
  const backend = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  };
  expect(createCredentialEncryption("/unused", "win32", backend)).toBe(backend);
});
