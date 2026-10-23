import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assert, sleep } from "./claw-chat-current-fixture-utils.mjs";
import { mergeInvokeTraceEvidence } from "./claw-chat-current-fixture-invoke-trace.mjs";
import {
  downloadHistoryMatchesDisk,
  downloadHistoryPublicEvidence,
} from "./browser-runtime-electron-gate-b-download-history-evidence.mjs";

const CHUNK_SIZE = 32 * 1024;
const SLOW_SIZE = 128 * 1024 * 1024;

/** Real attachment responses, with Range support for Chromium's native DownloadItem. */
export async function startDownloadServer() {
  const marker = `download-history-${randomUUID()}`;
  const files = ["removed", "retained", "cancelled", "active"].map((name) => ({
    name,
    filename: `${marker}-${name}.bin`,
    slow: ["cancelled", "active"].includes(name),
    content: Buffer.from(`${marker}:${name}\n`.repeat(64)),
  }));
  const requests = [],
    timers = new Set();
  const server = http.createServer((request, response) => {
    const file = files.find((file) => request.url === `/${file.filename}`);
    if (!file || request.method !== "GET") {
      response.writeHead(404);
      response.end();
      return;
    }
    const size = file.slow ? SLOW_SIZE : file.content.length;
    const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if ((request.headers.range && !range) || start >= size || start > end) {
      response.writeHead(416, { "content-range": `bytes */${size}` });
      response.end();
      return;
    }
    const record = {
      name: file.name,
      filename: file.filename,
      rangeStart: start,
      bytesWritten: 0,
      complete: false,
      closed: false,
    };
    requests.push(record);
    response.writeHead(range ? 206 : 200, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      etag: `"${file.filename}"`,
      "last-modified": "Thu, 22 Oct 2026 00:00:00 GMT",
      "cache-control": "no-store",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (!file.slow) {
      record.bytesWritten = end - start + 1;
      record.complete = true;
      response.end(file.content.subarray(start, end + 1));
      return;
    }
    let offset = start;
    const write = () => {
      if (response.destroyed || response.writableNeedDrain) return;
      const length = Math.min(CHUNK_SIZE, end + 1 - offset);
      response.write(Buffer.alloc(length, file.name === "active" ? 65 : 67));
      offset += length;
      record.bytesWritten += length;
      if (offset > end) {
        record.complete = true;
        clearInterval(timer);
        timers.delete(timer);
        response.end();
      }
    };
    const timer = setInterval(write, 40);
    timers.add(timer);
    write();
    response.once("close", () => {
      record.closed = true;
      clearInterval(timer);
      timers.delete(timer);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(
    address && typeof address !== "string",
    "Download fixture did not bind a local port",
  );
  for (const file of files)
    file.url = `http://127.0.0.1:${address.port}/${file.filename}`;
  return {
    marker,
    files,
    requests,
    addPaginationFiles(count) {
      const additional = Array.from({ length: count }, (_, index) => {
        const name = `page-${String(index).padStart(3, "0")}`;
        const filename = `${marker}-${name}.bin`;
        return {
          name,
          filename,
          slow: false,
          content: Buffer.from(`${marker}:${name}\n`),
          url: `http://127.0.0.1:${address.port}/${filename}`,
        };
      });
      files.push(...additional);
      return additional;
    },
    close: async () => {
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

export async function waitFor(options, read, predicate, description) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await sleep(options.intervalMs);
  }
  // Do not serialize the last raw config or native persisted record on failure.
  throw new Error(description);
}

export async function isolatedProfile(app) {
  const profile = await app.evaluate(({ app }) => ({
    e2e: process.env.LIME_ELECTRON_E2E === "1",
    directory: process.env.ELECTRON_E2E_USER_DATA_DIR || "",
    userData: app.getPath("userData"),
  }));
  const relative = path.relative(os.tmpdir(), profile.directory);
  assert(
    profile.e2e &&
      path.isAbsolute(profile.directory) &&
      path.resolve(profile.directory) === path.resolve(profile.userData) &&
      relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative),
    "Download history fixture requires isolated temporary Electron userdata",
  );
  return {
    root: profile.directory,
    store: path.join(profile.directory, "browser", "downloads.json"),
    downloads: path.join(profile.directory, "download-history-fixture"),
  };
}

export async function nativeState(app, id) {
  return app.evaluate(({ BrowserWindow, webContents }, id) => {
    const target = webContents.fromId(id);
    const window = BrowserWindow.getAllWindows().find((window) =>
      window.contentView.children.some((view) => view.webContents?.id === id),
    );
    return target && !target.isDestroyed()
      ? {
          webContentsId: target.id,
          url: target.getURL(),
          loading: target.isLoading(),
          ownerWebContentsId: window?.webContents.id ?? null,
          windowId: window?.id ?? null,
        }
      : null;
  }, id);
}

export async function installObservers(app, page, key, targetId) {
  await page.evaluate((key) => {
    const state = { changed: 0, events: [], stops: [] };
    state.stops.push(
      window.electronAPI.listen("browser-downloads-changed", () => {
        ++state.changed;
      }),
    );
    state.stops.push(
      window.electronAPI.listen("browser-tab-download", (event) => {
        state.events.push(event.payload ?? event);
      }),
    );
    window[key] = state;
  }, key);
  await app.evaluate(
    ({ webContents }, { key, targetId }) => {
      const target = webContents.fromId(targetId),
        records = [],
        removers = [];
      if (!target || target.isDestroyed())
        throw new Error("Download fixture native target is unavailable");
      const listener = (_event, item, source) => {
        if (source?.id !== targetId) return;
        const url = item.getURL();
        const capture = (state) =>
          records.push({
            sourceWebContentsId: source.id,
            url,
            state,
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
            paused: item.isPaused(),
          });
        const updated = (_event, state) => capture(state),
          done = (_event, state) => capture(state);
        capture("will-download");
        item.on("updated", updated);
        item.on("done", done);
        removers.push(() => {
          item.off("updated", updated);
          item.off("done", done);
        });
      };
      target.session.on("will-download", listener);
      globalThis[key] = {
        records,
        close: () => {
          target.session.off("will-download", listener);
          removers.forEach((remove) => remove());
        },
      };
    },
    { key, targetId },
  );
}

export async function readTrace(page, readInvokeTrace) {
  return mergeInvokeTraceEvidence(
    readInvokeTrace?.() ?? [],
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
    ),
  );
}

export async function listDownloads(page, profile, query = "") {
  const value = await page.evaluate(
    (query) =>
      window.electronAPI.invoke("browser_downloads_list", {
        query,
        offset: 0,
        limit: 100,
      }),
    query,
  );
  return downloadHistoryPublicEvidence(value, [
    profile.root,
    profile.downloads,
  ]);
}

export async function snapshot(page, profile) {
  const ipc = await listDownloads(page, profile);
  const disk = JSON.parse(await fs.readFile(profile.store, "utf8"));
  return {
    page: ipc,
    diskMatches: downloadHistoryMatchesDisk(ipc, disk),
    diskEntries: disk.entries.map(({ id, state, filename, finished }) => ({
      id,
      state,
      filename,
      finished,
    })),
  };
}

export async function fileEvidence(profile, file) {
  try {
    const bytes = await fs.readFile(
      path.join(profile.downloads, file.filename),
    );
    return {
      filename: file.filename,
      exists: true,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      matchesResponse: bytes.equals(file.content),
    };
  } catch (error) {
    if (error?.code === "ENOENT")
      return { filename: file.filename, exists: false, matchesResponse: false };
    throw error;
  }
}

/** Move only a completed file whose persisted native path matches this isolated fixture. */
export async function hideCompletedDownload(profile, file, entry) {
  const disk = JSON.parse(await fs.readFile(profile.store, "utf8"));
  const stored = disk.entries.filter((candidate) => candidate.id === entry.id);
  const expected = path.join(profile.downloads, file.filename);
  assert(
    path.basename(file.filename) === file.filename &&
      stored.length === 1 &&
      stored[0].finished === true &&
      stored[0].state === "completed" &&
      stored[0].filename === file.filename &&
      stored[0].savePath === expected &&
      entry.fileExists === true,
    "Missing-file fixture requires the exact completed native save path",
  );
  const [root, directory, real, info] = await Promise.all([
    fs.realpath(profile.root),
    fs.realpath(profile.downloads),
    fs.realpath(expected),
    fs.lstat(expected),
  ]);
  assert(
    directory === path.join(root, "download-history-fixture") &&
      real === path.join(directory, file.filename) &&
      info.isFile() &&
      !info.isSymbolicLink(),
    "Missing-file fixture cannot move a foreign path or symbolic link",
  );
  const original = await fileEvidence(profile, file);
  assert(
    original.matchesResponse,
    "Missing-file fixture source no longer matches the HTTP response",
  );
  const backup = `${expected}.missing-${randomUUID()}.backup`;
  const exists = await fs.lstat(backup).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  assert(!exists, "Missing-file fixture backup destination already exists");
  await fs.rename(expected, backup);
  let moved = true;
  return {
    original,
    restore: async () => {
      if (moved) {
        const occupied = await fs.lstat(expected).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
        assert(
          !occupied,
          "Missing-file fixture refuses to overwrite the original destination",
        );
        await fs.rename(backup, expected);
        moved = false;
      }
      const restored = await fileEvidence(profile, file);
      assert(
        restored.matchesResponse && restored.sha256 === original.sha256,
        "Restored native download bytes changed",
      );
      return restored;
    },
  };
}
