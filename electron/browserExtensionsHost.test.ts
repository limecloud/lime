import { describe, expect, it, vi } from "vitest";
import {
  BrowserExtensionStore,
  listBrowserExtensions,
  loadBrowserExtension,
  removeBrowserExtension,
  restoreBrowserExtensions,
} from "./browserExtensionsHost";

const extension = {
  id: "abc123",
  name: "Fixture Extension",
  version: "1.0.0",
  path: "/tmp/ext",
  manifest: { manifest_version: 3 },
};

function session() {
  return {
    getAllExtensions: vi.fn(() => [extension]),
    loadExtension: vi.fn(async () => extension),
    removeExtension: vi.fn(),
  };
}

describe("browserExtensionsHost", () => {
  it("列出已加载扩展并保留清单版本", () => {
    expect(listBrowserExtensions(session())).toEqual([
      {
        id: "abc123",
        name: "Fixture Extension",
        version: "1.0.0",
        manifestVersion: 3,
        path: "/tmp/ext",
        enabled: true,
      },
    ]);
  });

  it("加载扩展时允许文件访问并返回摘要", async () => {
    const fake = session();
    await expect(loadBrowserExtension(fake, " /tmp/ext ")).resolves.toEqual({
      id: "abc123",
      name: "Fixture Extension",
      version: "1.0.0",
      manifestVersion: 3,
      path: "/tmp/ext",
      enabled: true,
    });
    expect(fake.loadExtension).toHaveBeenCalledWith("/tmp/ext", {
      allowFileAccess: true,
    });
  });

  it("拒绝空路径与空 ID，删除时传递扩展 ID", () => {
    const fake = session();
    expect(() => removeBrowserExtension(fake, "abc123")).not.toThrow();
    expect(fake.removeExtension).toHaveBeenCalledWith("abc123");
    expect(() => removeBrowserExtension(fake, " ")).toThrow("扩展 ID");
  });
});

describe("BrowserExtensionStore", () => {
  it("持久化扩展记录、去重并移除", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const directory = await mkdtemp(path.join(os.tmpdir(), "lime-ext-store-"));
    const store = new BrowserExtensionStore(
      path.join(directory, "browser-extensions.json"),
    );
    expect(await store.read()).toEqual([]);
    await store.add({ id: "a", path: "/tmp/a" });
    await store.add({ id: "a", path: "/tmp/a" });
    await store.add({ id: "b", path: "/tmp/b" });
    expect(await store.read()).toEqual([
      { id: "a", path: "/tmp/a", enabled: true },
      { id: "b", path: "/tmp/b", enabled: true },
    ]);
    await expect(store.setEnabled("a", false)).resolves.toBe(true);
    expect((await store.read())[0]).toMatchObject({ id: "a", enabled: false });
    await expect(store.setEnabled("missing", false)).resolves.toBe(false);
    await store.remove("a");
    expect(await store.read()).toEqual([
      { id: "b", path: "/tmp/b", enabled: true },
    ]);
  });

  it("启动时恢复记录并跳过损坏扩展", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "lime-ext-restore-"),
    );
    const store = new BrowserExtensionStore(
      path.join(directory, "browser-extensions.json"),
    );
    await store.add({ id: "a", path: "/tmp/a" });
    await store.add({ id: "bad", path: "/tmp/bad" });
    const session = {
      getAllExtensions: vi.fn(() => [] as never),
      loadExtension: vi.fn(async (extensionPath: string) => {
        if (extensionPath === "/tmp/bad") throw new Error("broken");
        return {
          id: "a",
          name: "A",
          version: "1.0.0",
          path: extensionPath,
          manifest: { manifest_version: 3 },
        };
      }),
      removeExtension: vi.fn(),
    };
    await expect(restoreBrowserExtensions(session, store)).resolves.toEqual([
      {
        id: "a",
        name: "A",
        version: "1.0.0",
        path: "/tmp/a",
        manifestVersion: 3,
        enabled: true,
      },
    ]);
  });
});
