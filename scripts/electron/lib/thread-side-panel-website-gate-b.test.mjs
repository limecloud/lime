import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readWebsitePreloadTrace,
  renderRecentsWebsiteBackendScript,
  waitForLinkTab,
} from "./thread-side-panel-website-gate-b.mjs";
import {
  INVOKE_TRACE_COLLECTOR_KEY as KEY,
  INVOKE_TRACE_COLLECTOR_LIMIT as LIMIT,
  installInvokeTraceCollector,
  stopInvokeTraceCollector,
} from "../../lib/invoke-trace-collector.mjs";

describe("website preload evidence across the native trace ring", () => {
  const page = { evaluate: async (callback, argument) => callback(argument) };
  let collector;
  beforeEach(async () => {
    localStorage.clear();
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("TextEncoder", TextEncoder);
    collector = await installInvokeTraceCollector(page);
  });
  afterEach(async () => {
    try {
      await stopInvokeTraceCollector(page, collector);
    } finally {
      vi.unstubAllGlobals();
      localStorage.clear();
    }
  });
  const entry = (index, command = "app_server_handle_json_lines") => ({
    timestamp: new Date(1_800_000_000_000 + index).toISOString(),
    command,
    transport: "electron-ipc",
    status: "success",
    duration_ms: 1,
  });
  const append = (value) => {
    const ring = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.setItem(KEY, JSON.stringify([...ring, value].slice(-LIMIT)));
  };

  it("retains the actual default-browser receipt after later IPC has evicted it", async () => {
    const receipt = entry(0, "is_default_browser");
    append(receipt);
    for (let index = 1; index <= LIMIT + 10; index += 1) append(entry(index));
    expect(JSON.parse(localStorage.getItem(KEY))).not.toContainEqual(receipt);
    const trace = await readWebsitePreloadTrace(page, collector);
    expect(trace.ledgerEntries[0]).toEqual(receipt);
    expect(trace.provenance).toMatchObject({
      mode: "continuous-storage-append",
      appendCount: LIMIT + 11,
      currentRingCount: LIMIT,
    });
  });

  it("rejects a broken observation interval even if the current ring has a success receipt", async () => {
    append(entry(0, "is_default_browser"));
    localStorage.removeItem(KEY);
    append(entry(1, "is_default_browser"));
    await expect(readWebsitePreloadTrace(page, collector)).rejects.toThrow(
      "website缺少连续preload trace来源证明",
    );
  });
});

it("awaits asynchronous native snapshots until the new identity is present", async () => {
  vi.useFakeTimers();
  try {
    const old = { tabId: "old", url: "http://localhost/old" };
    const next = { tabId: "canonical-new", url: "http://localhost/new" };
    const read = vi
      .fn()
      .mockResolvedValueOnce([old])
      .mockResolvedValue([old, next]);
    let settled = false;
    const result = waitForLinkTab(read, {
      url: next.url,
      beforeIds: [old.tabId],
      timeoutMs: 500,
      readCreationRequests: async () => [{}],
      creationCount: 0,
    }).then((tabs) => {
      settled = true;
      return tabs;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual([old, next]);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("retains the original deadline and reports expected and actual native identities", async () => {
  vi.useFakeTimers();
  try {
    const old = { tabId: "old", url: "http://localhost/new" };
    const result = waitForLinkTab(async () => [old], {
      url: old.url,
      beforeIds: [old.tabId],
      timeoutMs: 200,
      readCreationRequests: async () => [],
      creationCount: 0,
    });
    const check = expect(result).rejects.toThrow(
      JSON.stringify({ url: old.url, beforeIds: [old.tabId], actual: [old] }),
    );
    await vi.advanceTimersByTimeAsync(200);
    await check;
  } finally {
    vi.useRealTimers();
  }
});

it("waits for the actual preload receipt after native creation is already visible", async () => {
  vi.useFakeTimers();
  try {
    const next = { tabId: "new", url: "http://localhost/new" };
    const readCreationRequests = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{}]);
    let settled = false;
    const result = waitForLinkTab(async () => [next], {
      url: next.url,
      beforeIds: [],
      timeoutMs: 500,
      readCreationRequests,
      creationCount: 0,
    }).then((tabs) => {
      settled = true;
      return tabs;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual([next]);
  } finally {
    vi.useRealTimers();
  }
});

describe("Recents website external fixture", () => {
  it("实际子进程只为明确fixture请求产生带独立Turn身份的网站消息", () => {
    const target = "http://127.0.0.1:4317/second";
    const result = spawnSync(process.execPath, ["--input-type=module"], {
      encoding: "utf8",
      input: `const input={kind:"turnStart"},inputText=${JSON.stringify(`RECENTS_WEBSITE_FIXTURE ${target}`)},ledgerPath=null,sessionId="session",threadId="thread",turnId="turn-second";\n${renderRecentsWebsiteBackendScript()}`,
    });
    expect(result.status).toBe(0);
    const { events } = JSON.parse(result.stdout);
    expect(events.map((event) => event.type)).toEqual([
      "message.delta",
      "message.completed",
      "turn.completed",
    ]);
    expect(events[1].payload).toMatchObject({
      itemId: "recents-website:turn-second",
      text: `Website ready: ${target}`,
      status: "completed",
    });
  });
  it("普通请求不进入website分支，继续由原external backend处理", () => {
    const result = spawnSync(process.execPath, ["--input-type=module"], {
      encoding: "utf8",
      input: `const input={kind:"turnStart"},inputText="ordinary fixture prompt";\n${renderRecentsWebsiteBackendScript()}\nconsole.log("normal-handler");`,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("normal-handler");
  });

  it("本地HTML经同一Turn的completed文件变更输出，不伪造普通文件产物", () => {
    const result = spawnSync(process.execPath, ["--input-type=module"], {
      encoding: "utf8",
      input: `const input={kind:"turnStart"},inputText="RECENTS_WEBSITE_FIXTURE recent-website.html",ledgerPath=null,sessionId="session",threadId="thread",turnId="turn-html";\n${renderRecentsWebsiteBackendScript()}`,
    });
    expect(result.status).toBe(0);
    const { events } = JSON.parse(result.stdout);
    const file = events.find((event) => event.type === "item.completed");
    expect(file?.payload.item).toMatchObject({
      sessionId: "session",
      threadId: "thread",
      turnId: "turn-html",
      kind: "file",
      status: "completed",
      payload: {
        type: "file",
        status: "applied",
        changes: [
          {
            path: "recent-website.html",
            kind: { type: "add" },
          },
        ],
      },
    });
    expect(file.payload.item.payload.changes[0].diff).toContain(
      "RECENTS_CANONICAL_HTML",
    );
    expect(events.at(-1).type).toBe("turn.completed");
    expect(events.some((event) => event.type === "artifact.snapshot")).toBe(
      false,
    );
  });
});
