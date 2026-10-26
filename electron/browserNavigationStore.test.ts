// @vitest-environment node
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  BrowserNavigationStore,
  browserNavigationSnapshot,
} from "./browserNavigationStore";
import type { PersistedAtomFileIO } from "./persistedAtomFile";

const file = "/lime-data/browser/navigation.json";
const entries = ["one", "two", "three"].map((title) => ({
  title,
  url: `https://example.com/${title}`,
}));
function fixture(initial?: unknown) {
  const files = new Map<string, string>(
    initial === undefined ? [] : [[file, JSON.stringify(initial)]],
  );
  const io: PersistedAtomFileIO = {
    readFile: vi.fn(async (name) => {
      if (!files.has(name))
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return Buffer.from(files.get(name)!);
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (name, data) => {
      files.set(name, data);
    }),
    rename: vi.fn(async (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    removeTemporary: vi.fn(async (name) => {
      files.delete(name);
    }),
  };
  return {
    files,
    io,
    create: () => new BrowserNavigationStore("/lime-data", { io }),
  };
}

describe("native navigation persistence", () => {
  it("reopens the exact active entry including the forward stack using a fresh store", async () => {
    const f = fixture();
    const store = f.create();
    expect(await store.read("thread", entries[1].url)).toBeNull();
    await store.save("thread", { entries, index: 1 });
    expect(await f.create().read("thread", entries[1].url)).toEqual({
      entries,
      index: 1,
    });
    expect(await store.read("other-thread", entries[1].url)).toBeNull();
    expect(await store.read("thread", entries[0].url)).toBeNull();
    const snapshot = (await store.read("thread", entries[1].url))!;
    snapshot.entries[0].url = "https://wrong.example/";
    expect((await store.read("thread", entries[1].url))!.entries).toEqual(
      entries,
    );
  });
  it("never persists opaque/native URLs, credentials, pageState, form fields or control", async () => {
    const f = fixture();
    await f
      .create()
      .save("thread", {
        index: 2,
        entries: [
          { url: "file:///private/file", title: "secret" },
          ...entries.map((entry) => ({
            ...entry,
            pageState: "private-form",
            approvalToken: "grant",
          })),
        ],
      });
    const data = f.files.get(file)!;
    expect(JSON.parse(data).records[0]).toEqual({
      threadId: "thread",
      entries,
      index: 1,
    });
    expect(data).not.toMatch(/pageState|private-form|approval|file:|grant/);
    for (const target of [
      "data:text/html,secret",
      "about:blank",
      "https://user:pass@example.com/",
    ])
      expect(
        browserNavigationSnapshot([{ url: target, title: "" }], 0),
      ).toBeNull();
    expect(
      browserNavigationSnapshot(
        [entries[0], { url: "about:blank", title: "" }, entries[2]],
        2,
      ),
    ).toEqual({ entries: [entries[2]], index: 0 });
  });
  it("bounds the native stack and stored thread count", async () => {
    const f = fixture();
    const store = f.create();
    const many = Array.from({ length: 200 }, (_, n) => ({
      url: `https://example.com/${n}`,
      title: "t".repeat(600),
    }));
    const snapshot = browserNavigationSnapshot(many, 90)!;
    expect(snapshot.entries).toHaveLength(50);
    expect(snapshot.entries[snapshot.index].url).toBe(many[90].url);
    expect(snapshot.entries[0].title).toHaveLength(512);
    for (let n = 0; n < 102; n++)
      await store.save(`thread-${n}`, { entries, index: 1 });
    expect(JSON.parse(f.files.get(file)!).records).toHaveLength(100);
    expect(await store.read("thread-0", entries[1].url)).toBeNull();
    expect(await store.read("thread-101", entries[1].url)).not.toBeNull();
  });
  it("serializes writes and clearing, preserving other threads and suppressing identical writes", async () => {
    const f = fixture();
    const store = f.create();
    await Promise.all([
      store.save("first", { entries, index: 0 }),
      store.save("second", { entries, index: 1 }),
      store.save("first", { entries, index: 2 }),
    ]);
    await store.save("first", { entries, index: 2 });
    expect(f.io.rename).toHaveBeenCalledTimes(3);
    expect(await store.read("second", entries[1].url)).not.toBeNull();
    await store.clear();
    await store.flush();
    expect(await f.create().read("first", entries[2].url)).toBeNull();
    expect(await f.create().read("second", entries[1].url)).toBeNull();
  });
  it("keeps the last committed file after a failed write and can retry", async () => {
    const f = fixture();
    const store = f.create();
    await store.save("thread", { entries, index: 0 });
    vi.mocked(f.io.rename).mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(store.save("thread", { entries, index: 1 })).rejects.toThrow();
    expect(await f.create().read("thread", entries[0].url)).not.toBeNull();
    expect([...f.files.keys()]).toEqual([file]);
    await store.save("thread", { entries, index: 1 });
    expect(await f.create().read("thread", entries[1].url)).not.toBeNull();
  });
  it("retries Windows sharing violations without changing the profile", async () => {
    const f = fixture();
    const wait = vi.fn(async () => undefined);
    vi.mocked(f.io.rename).mockRejectedValueOnce(
      Object.assign(new Error("busy"), { code: "EBUSY" }),
    );
    await new BrowserNavigationStore("/lime-data", {
      io: f.io,
      platform: "win32",
      wait,
    }).save("thread", { entries, index: 1 });
    expect(wait).toHaveBeenCalledWith(50);
    expect(await f.create().read("thread", entries[1].url)).not.toBeNull();
  });
  it.each([
    { schemaVersion: 2, records: [] },
    { schemaVersion: 1, records: [{ threadId: "thread", index: 3, entries }] },
    {
      schemaVersion: 1,
      records: [
        {
          threadId: "thread",
          index: 0,
          entries: [{ ...entries[0], pageState: "private" }],
        },
      ],
    },
    {
      schemaVersion: 1,
      records: [
        {
          threadId: "thread",
          index: 0,
          entries: [{ url: "file:///secret", title: "" }],
        },
      ],
    },
  ])("refuses malformed or private stored records %#", async (data) => {
    await expect(
      fixture(data).create().read("thread", entries[0].url),
    ).rejects.toThrow("corrupt");
  });
});
