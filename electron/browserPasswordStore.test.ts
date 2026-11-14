import { Buffer } from "node:buffer";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrowserPasswordStore } from "./browserPasswordStore";

async function createStore(overrides?: {
  decryptString?: (buffer: Buffer) => string;
}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lime-passwords-"));
  const filePath = path.join(directory, "browser-passwords.json");
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`enc:${plainText}`),
    decryptString:
      overrides?.decryptString ??
      ((buffer: Buffer) => buffer.toString("utf8").slice(4)),
  };
  return { filePath, store: new BrowserPasswordStore(filePath, encryption) };
}

describe("BrowserPasswordStore", () => {
  it("保存后只暴露摘要，密码可解密", async () => {
    const { filePath, store } = await createStore();
    const summary = await store.save({
      origin: "https://example.com/login",
      username: " alice ",
      password: "S3CRET",
    });
    expect(summary.origin).toBe("https://example.com");
    expect(summary.username).toBe("alice");
    expect(await store.list()).toEqual([summary]);
    expect(JSON.stringify(await store.list())).not.toContain("password");
    expect(await store.reveal(summary.id)).toBe("S3CRET");
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("S3CRET");
  });

  it("同站点同用户名覆盖，不产生重复记录", async () => {
    const { store } = await createStore();
    const first = await store.save({
      origin: "https://example.com",
      username: "alice",
      password: "one",
    });
    const second = await store.save({
      origin: "https://example.com/path",
      username: "alice",
      password: "two",
    });
    expect(second.id).toBe(first.id);
    expect(await store.list()).toHaveLength(1);
    expect(await store.reveal(first.id)).toBe("two");
  });

  it("校验协议与必填项，移除与解密失败行为", async () => {
    const { store } = await createStore();
    await expect(
      store.save({ origin: "ftp://example.com", username: "a", password: "b" }),
    ).rejects.toThrow("http/https");
    await expect(
      store.save({ origin: "not a url", username: "a", password: "b" }),
    ).rejects.toThrow("无效");
    await expect(
      store.save({
        origin: "https://example.com",
        username: " ",
        password: "b",
      }),
    ).rejects.toThrow("用户名");
    await expect(
      store.save({
        origin: "https://example.com",
        username: "a",
        password: "",
      }),
    ).rejects.toThrow("密码");

    const saved = await store.save({
      origin: "https://example.com",
      username: "a",
      password: "b",
    });
    const broken = await createStore({
      decryptString: () => {
        throw new Error("vault locked");
      },
    });
    await broken.store.save({
      origin: "https://example.com",
      username: "a",
      password: "b",
    });
    expect(await broken.store.reveal(saved.id)).toBeNull();
    expect(await store.remove(saved.id)).toBe(true);
    expect(await store.remove(saved.id)).toBe(false);
  });

  it("清除所有密码", async () => {
    const { store } = await createStore();
    await store.save({
      origin: "https://a.example",
      username: "a",
      password: "1",
    });
    await store.save({
      origin: "https://b.example",
      username: "b",
      password: "2",
    });
    await store.clear();
    expect(await store.list()).toEqual([]);
    await expect(store.lookupForUrl("https://a.example")).resolves.toEqual([]);
  });

  it("安全存储不可用时拒绝保存", async () => {
    const store = new BrowserPasswordStore("/tmp/unused.json", {
      isEncryptionAvailable: () => false,
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    });
    await expect(
      store.save({
        origin: "https://example.com",
        username: "a",
        password: "b",
      }),
    ).rejects.toThrow("安全存储");
  });
});

it("按来源查找自动填充凭据并按更新时间排序", async () => {
  const { store } = await createStore();
  const now = vi.spyOn(Date, "now");
  try {
    now.mockReturnValueOnce(1);
    await store.save({
      origin: "https://example.com",
      username: "alice",
      password: "one",
    });
    now.mockReturnValueOnce(2);
    await store.save({
      origin: "https://example.com",
      username: "bob",
      password: "two",
    });
    await expect(
      store.lookupForUrl("https://example.com/login?next=1"),
    ).resolves.toEqual([
      { username: "bob", password: "two" },
      { username: "alice", password: "one" },
    ]);
    now.mockReturnValueOnce(3);
    await store.save({
      origin: "https://example.com",
      username: "alice",
      password: "three",
    });
    await expect(store.lookupForUrl("https://example.com")).resolves.toEqual([
      { username: "alice", password: "three" },
      { username: "bob", password: "two" },
    ]);
  } finally {
    now.mockRestore();
  }
  await expect(store.lookupForUrl("ftp://example.com")).resolves.toEqual([]);
});
