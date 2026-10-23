import { describe, expect, it } from "vitest";
import {
  downloadHistoryClearEvidence,
  downloadHistoryMatchesDisk,
  downloadHistoryMissingFileEvidence,
  downloadHistoryPublicEvidence,
  downloadHistoryTraceEvidence,
} from "./browser-runtime-electron-gate-b-download-history-evidence.mjs";
import { startDownloadServer } from "./browser-runtime-electron-gate-b-download-history-native.mjs";

function entry(id = "download-current", state = "completed") {
  return {
    id,
    url: `http://127.0.0.1:1234/${id}.bin`,
    filename: `${id}.bin`,
    mimeType: "application/octet-stream",
    state,
    receivedBytes: 16,
    totalBytes: 16,
    startedAt: 100,
    updatedAt: 110,
    canPause: state === "progressing",
    canResume: state === "paused",
    canCancel: state === "progressing" || state === "paused",
    fileExists: state === "completed",
  };
}
const page = (entries = [entry()], revision = 2) => ({
  entries,
  total: entries.length,
  nextOffset: null,
  revision,
  historyRevision: revision,
});
const disk = (publicPage) => ({
  schemaVersion: 2,
  revision: publicPage.revision,
  entries: publicPage.entries.map(
    ({
      canPause: _pause,
      canResume: _resume,
      canCancel: _cancel,
      fileExists: _fileExists,
      ...metadata
    }) => ({
      ...metadata,
      savePath: `/isolated/native/${metadata.filename}`,
      finished: ["completed", "cancelled", "interrupted"].includes(
        metadata.state,
      ),
      resume: null,
    }),
  ),
});

describe("download history real-host evidence", () => {
  it("does not accept a missing-file label while the GUI still permits opening the file", () => {
    const before = entry(),
      missing = { ...before, fileExists: false },
      restored = { ...before };
    const originalFile = {
      matchesResponse: true,
      sha256: "same-real-byte-hash",
      byteLength: 16,
    };
    const evidence = {
      before,
      missing,
      restored,
      missingUi: {
        missingText: true,
        strikethrough: true,
        openDisabled: true,
        revealUnavailable: true,
      },
      restoredUi: {
        missingText: false,
        strikethrough: false,
        openDisabled: false,
        revealAvailable: true,
      },
      originalFile,
      restoredFile: { ...originalFile },
    };
    expect(
      Object.values(downloadHistoryMissingFileEvidence(evidence)).every(
        Boolean,
      ),
    ).toBe(true);
    expect(
      downloadHistoryMissingFileEvidence({
        ...evidence,
        missingUi: { ...evidence.missingUi, openDisabled: false },
      }).missingUiNamesAndDisablesFile,
    ).toBe(false);
    expect(
      downloadHistoryMissingFileEvidence({
        ...evidence,
        missingUi: { ...evidence.missingUi, revealUnavailable: false },
      }).missingUiNamesAndDisablesFile,
    ).toBe(false);
  });

  it("does not accept recovery on another native record or with changed file bytes", () => {
    const before = entry(),
      originalFile = {
        matchesResponse: true,
        sha256: "hash-before",
        byteLength: 16,
      };
    const evidence = {
      before,
      missing: { ...before, fileExists: false },
      restored: { ...before },
      originalFile,
      restoredFile: { ...originalFile },
    };
    expect(
      downloadHistoryMissingFileEvidence({
        ...evidence,
        restored: { ...before, id: "foreign-record" },
      }).sameCompletedNativeRecord,
    ).toBe(false);
    expect(
      downloadHistoryMissingFileEvidence({
        ...evidence,
        restoredFile: { ...originalFile, sha256: "changed-bytes" },
      }).restoredFileBytesUnchanged,
    ).toBe(false);
    expect(
      downloadHistoryMissingFileEvidence({
        ...evidence,
        restored: { ...before, fileExists: false },
      }).liveFileExistenceReflectsRename,
    ).toBe(false);
  });

  it("serves real small attachment bytes with the validators required for native resume", async () => {
    const server = await startDownloadServer();
    try {
      const file = server.files.find((file) => file.name === "removed");
      const response = await fetch(file.url);
      expect(response.status).toBe(200);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("etag")).toBeTruthy();
      expect(response.headers.get("last-modified")).toBeTruthy();
      expect(response.headers.get("content-disposition")).toContain(
        file.filename,
      );
      expect(
        Buffer.from(await response.arrayBuffer()).equals(file.content),
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("implements open-ended and bounded byte ranges rather than pretending resume works", async () => {
    const server = await startDownloadServer();
    try {
      const file = server.files.find((file) => file.name === "retained");
      for (const [range, start, end] of [
        ["bytes=7-", 7, file.content.length - 1],
        ["bytes=3-18", 3, 18],
      ]) {
        const response = await fetch(file.url, { headers: { range } });
        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe(
          `bytes ${start}-${end}/${file.content.length}`,
        );
        expect(
          Buffer.from(await response.arrayBuffer()).equals(
            file.content.subarray(start, end + 1),
          ),
        ).toBe(true);
      }
      const slow = server.files.find((file) => file.name === "active");
      const response = await fetch(slow.url, {
        headers: { range: "bytes=100-163" },
      });
      expect(response.status).toBe(206);
      expect(
        Buffer.from(await response.arrayBuffer()).equals(Buffer.alloc(64, 65)),
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("rejects impossible ranges without returning a false successful response", async () => {
    const server = await startDownloadServer();
    try {
      const file = server.files[0];
      for (const range of ["bytes=99-3", "bytes=99999999-", "bytes=nonsense"]) {
        const response = await fetch(file.url, { headers: { range } });
        expect(response.status).toBe(416);
        expect(response.headers.get("content-range")).toBe(
          `bytes */${file.content.length}`,
        );
        await response.arrayBuffer();
      }
    } finally {
      await server.close();
    }
  });

  it("exports only a validated public snapshot without sharing mutable input", () => {
    const input = page(),
      safe = downloadHistoryPublicEvidence(input);
    input.entries[0].filename = "changed";
    expect(safe.entries[0].filename).toBe("download-current.bin");
    expect(downloadHistoryPublicEvidence(page([]))).toEqual(page([]));
  });

  it.each(["savePath", "finished", "localPath", "path"])(
    "rejects native-only field %s before exporting evidence",
    (key) => {
      const input = page();
      input.entries[0][key] = "/private/native/file";
      expect(() => downloadHistoryPublicEvidence(input)).toThrow(
        "private native fields",
      );
    },
  );

  it("rejects a private destination hidden in a permitted public string", () => {
    const input = page();
    input.entries[0].filename = "/private/isolated/file.bin";
    expect(() =>
      downloadHistoryPublicEvidence(input, ["/private/isolated"]),
    ).toThrow("private native fields");
    input.entries[0].filename = "C:\\private\\isolated\\file.bin";
    expect(() =>
      downloadHistoryPublicEvidence(input, ["C:\\private\\isolated"]),
    ).toThrow("private native fields");
  });

  it("rejects duplicate identities, unknown states and missing capability facts", () => {
    const duplicate = page([entry(), entry()]);
    expect(() => downloadHistoryPublicEvidence(duplicate)).toThrow();
    const unknown = page();
    unknown.entries[0].state = "renderer-invented";
    expect(() => downloadHistoryPublicEvidence(unknown)).toThrow();
    const missing = page();
    delete missing.entries[0].canResume;
    expect(() => downloadHistoryPublicEvidence(missing)).toThrow();
  });

  it("rejects invalid byte counters, backwards timestamps and inconsistent pagination", () => {
    for (const [key, value] of [
      ["receivedBytes", -1],
      ["totalBytes", 1.5],
      ["updatedAt", 99],
      ["fileExists", "true"],
    ]) {
      const input = page();
      input.entries[0][key] = value;
      expect(() => downloadHistoryPublicEvidence(input)).toThrow();
    }
    const input = page();
    input.nextOffset = input.total;
    expect(() => downloadHistoryPublicEvidence(input)).toThrow();
  });

  it("joins each public record to persisted facts while excluding save paths", () => {
    const input = page();
    expect(downloadHistoryMatchesDisk(input, disk(input))).toBe(true);
    const stale = disk(input);
    stale.revision--;
    expect(downloadHistoryMatchesDisk(input, stale)).toBe(false);
    const foreign = disk(input);
    foreign.entries[0].id = "another-download";
    expect(downloadHistoryMatchesDisk(input, foreign)).toBe(false);
    const changed = disk(input);
    changed.entries[0].receivedBytes++;
    expect(downloadHistoryMatchesDisk(input, changed)).toBe(false);
  });

  it("does not treat a partial page as a complete disk read", () => {
    const input = page();
    input.total = 2;
    input.nextOffset = 1;
    const stored = disk(input);
    stored.entries.push({ ...stored.entries[0], id: "second" });
    expect(downloadHistoryMatchesDisk(input, stored)).toBe(false);
  });

  it("proves clear removes terminal records while retaining active native identities", () => {
    const before = page(
      [
        entry("active", "paused"),
        entry("complete"),
        entry("cancelled", "cancelled"),
      ],
      4,
    );
    const after = page([entry("active", "paused")], 5);
    expect(
      Object.values(downloadHistoryClearEvidence(before, after)).every(Boolean),
    ).toBe(true);
    const replaced = structuredClone(after);
    replaced.entries[0].startedAt--;
    expect(
      downloadHistoryClearEvidence(before, replaced).allActivePreserved,
    ).toBe(false);
    const terminalRemains = structuredClone(after);
    terminalRemains.entries.push(entry("complete"));
    terminalRemains.total++;
    expect(
      downloadHistoryClearEvidence(before, terminalRemains).allTerminalRemoved,
    ).toBe(false);
    expect(
      downloadHistoryClearEvidence(before, page([], 5)).allActivePreserved,
    ).toBe(false);
    expect(
      downloadHistoryClearEvidence(before, { ...after, revision: 4 })
        .revisionAdvanced,
    ).toBe(false);
  });

  it("does not claim active-download preservation when only terminal downloads existed", () => {
    expect(
      downloadHistoryClearEvidence(page([entry()]), page([], 3))
        .hadActiveAndTerminal,
    ).toBe(false);
  });

  it("retains resumable cold interruptions while clearing finished interruptions", () => {
    const cold = {
      ...entry("cold", "interrupted"),
      receivedBytes: 8,
      canResume: true,
      canCancel: true,
    };
    const before = page([cold, entry("finished", "interrupted")], 4);
    const after = page([cold], 5);
    expect(
      Object.values(downloadHistoryClearEvidence(before, after)).every(Boolean),
    ).toBe(true);
    expect(
      downloadHistoryClearEvidence(before, page([], 5)).allActivePreserved,
    ).toBe(false);
  });

  it("exports action correlation while dropping arbitrary path/config/result data", () => {
    const trace = [
      {
        command: "browser_downloads_action",
        transport: "electron-ipc",
        status: "success",
        args_preview: {
          id: "download-current",
          action: "pause",
          savePath: "/secret/local/file",
        },
        result: { secret: "credential" },
      },
      {
        command: "app_server_handle_json_lines",
        args_preview: { config: "private-config" },
      },
    ];
    expect(downloadHistoryTraceEvidence(trace)).toEqual([
      {
        command: "browser_downloads_action",
        transport: "electron-ipc",
        status: "success",
        id: "download-current",
        action: "pause",
      },
    ]);
    expect(JSON.stringify(downloadHistoryTraceEvidence(trace))).not.toMatch(
      /secret|credential|private-config/u,
    );
  });

  it("does not invent a successful transport or a valid GUI action", () => {
    expect(
      downloadHistoryTraceEvidence([
        {
          command: "browser_downloads_action",
          args_preview: { id: "download-current", action: "delete-file" },
        },
      ]),
    ).toEqual([
      {
        command: "browser_downloads_action",
        transport: null,
        status: null,
        id: "download-current",
        action: null,
      },
    ]);
  });
});
