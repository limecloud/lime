// @vitest-environment node
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserDownloadFiles } from "./browserDownloadFiles";
import type { StoredBrowserDownload } from "./browserDownloadsStore";
import { parseBrowserDownloadResume } from "./browserDownloadResume";

let root: string;
let files: BrowserDownloadFiles;
let entry: StoredBrowserDownload;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "download-files-"));
  files = new BrowserDownloadFiles(root);
  entry = {
    id: "native-1",
    url: "https://example.test/file",
    filename: "file.bin",
    mimeType: null,
    state: "paused",
    receivedBytes: 4,
    totalBytes: 10,
    startedAt: 1,
    updatedAt: 1,
    savePath: path.join(root, "file.bin"),
    finished: false,
    resume: {
      viewId: "view-1",
      urlChain: ["https://example.test/file"],
      eTag: '"v1"',
      lastModified: "",
      startTime: 1,
    },
  };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("native download recovery files", () => {
  it("preserves a checkpoint and restores a removed native partial file without changing its bytes", async () => {
    await writeFile(entry.savePath!, "part");
    await files.preserve(entry);
    await rm(entry.savePath!);
    const restored = {
      ...entry,
      state: "interrupted" as const,
      finished: true,
    };
    expect(await files.available(restored)).toBe(true);
    expect(await files.prepare(restored)).toMatchObject({
      id: entry.id,
      path: entry.savePath,
      offset: 4,
      length: 10,
      eTag: '"v1"',
    });
    expect(await readFile(entry.savePath!, "utf8")).toBe("part");
    await files.remove(entry.id);
    expect(await readFile(entry.savePath!, "utf8")).toBe("part");
  });
  it("uses the actual retained file length after a crash, without restoring an older checkpoint", async () => {
    await writeFile(entry.savePath!, "part");
    await files.preserve(entry);
    await writeFile(entry.savePath!, "partial");
    expect((await files.prepare(entry)).offset).toBe(7);
    expect(await readFile(entry.savePath!, "utf8")).toBe("partial");
  });
  it("does not overwrite an existing complete file or substitute a directory or symbolic link", async () => {
    await writeFile(entry.savePath!, "part");
    await files.preserve(entry);
    await writeFile(entry.savePath!, "0123456789");
    expect(await files.available(entry)).toBe(false);
    await expect(files.prepare(entry)).rejects.toThrow("unavailable");
    expect(await readFile(entry.savePath!, "utf8")).toBe("0123456789");
    await rm(entry.savePath!);
    await mkdir(entry.savePath!);
    expect(await files.available(entry)).toBe(false);
    await rm(entry.savePath!, { recursive: true });
    const other = path.join(root, "other.bin");
    await writeFile(other, "keep");
    await symlink(other, entry.savePath!);
    expect(await files.available(entry)).toBe(false);
    await expect(files.prepare(entry)).rejects.toThrow("unavailable");
    expect(await readFile(other, "utf8")).toBe("keep");
  });
  it("rejects missing, empty, unknown-length, completed and cancelled recovery sources", async () => {
    expect(await files.available(entry)).toBe(false);
    await writeFile(entry.savePath!, "");
    expect(await files.available(entry)).toBe(false);
    await writeFile(entry.savePath!, "part");
    for (const next of [
      { ...entry, totalBytes: null },
      { ...entry, resume: null },
      { ...entry, state: "completed" as const },
      { ...entry, state: "cancelled" as const },
    ])
      expect(await files.available(next)).toBe(false);
  });
  it("does not use a finished entry to create a new checkpoint", async () => {
    await writeFile(entry.savePath!, "part");
    await files.preserve({ ...entry, finished: true });
    await rm(entry.savePath!);
    expect(await files.available(entry)).toBe(false);
  });
  it("parses only bounded HTTP native recovery facts and rejects credentials, header injection and unknown fields", () => {
    expect(parseBrowserDownloadResume(entry.resume)).toEqual(entry.resume);
    for (const value of [
      { ...entry.resume, urlChain: ["file:///private/file"] },
      { ...entry.resume, urlChain: ["https://user:secret@example.test/file"] },
      { ...entry.resume, eTag: "v1\r\nOther: bad" },
      { ...entry.resume, startTime: NaN },
      { ...entry.resume, urlChain: [] },
      { ...entry.resume, path: "/private/file" },
    ])
      expect(() => parseBrowserDownloadResume(value)).toThrow();
  });
});
