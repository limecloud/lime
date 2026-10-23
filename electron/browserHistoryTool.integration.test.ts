import { describe, expect, it, vi } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import type { BrowserHistoryHost } from "./browserHistoryHost";
import type { BrowserToolCall, BrowserToolResult } from "./browserTabHost";
import { createHarness, mount } from "./browserTabHost.testHarness";

const page = {
  entries: [
    {
      id: "history-1",
      url: "https://visited.example/docs",
      title: "History marker",
      visitCount: 1,
      firstVisitedAt: 1,
      lastVisitedAt: 1,
    },
  ],
  nextCursor: null,
  total: 1,
  revision: 1,
};
const call = (
  args: Record<string, unknown> = {},
  overrides: Partial<BrowserToolCall> = {},
): BrowserToolCall => ({
  tool: "history",
  arguments: args,
  callId: "history-call-1",
  ownerWebContentsId: 41,
  threadId: "thread-1",
  turnId: "turn-1",
  phase: "preflight",
  ...overrides,
});
const approved = (
  original: BrowserToolCall,
  result: BrowserToolResult,
): BrowserToolCall => ({
  ...original,
  phase: "approvedExecute",
  approvalToken: result.approval?.approvalToken,
});
async function setup(
  access: "alwaysAsk" | "neverAsk" | "disabled" = "neverAsk",
) {
  const invoke = vi.fn(async () => structuredClone(page));
  const h = createHarness({
    history: { invoke, forget: vi.fn() } as unknown as BrowserHistoryHost,
  });
  const settings = effectiveBrowserSettings({ history_access: access });
  // History permission is independent of authorization to browse a website.
  settings.agent_permissions.default.browse = "deny";
  h.host.setSettings(settings);
  const state = (await mount(h)) as { viewId: string };
  return { ...h, native: h.views.get(state.viewId)!, settings, invoke };
}

describe("Agent browser history access", () => {
  it.each([
    ["zh-CN", "允许 Agent", "最近的浏览记录"],
    ["zh-TW", "允許 Agent", "最近的瀏覽記錄"],
    ["en-US", "Allow this Agent", "recent browsing history"],
    ["ja-JP", "Agent による", "最近の閲覧履歴"],
    ["ko-KR", "Agent의", "최근 방문 기록"],
  ])(
    "uses the configured %s language in history approval",
    async (locale, prefix, recent) => {
      const h = await setup("alwaysAsk");
      h.host.setSettings(h.settings, locale);
      const pending = await h.host.executeTool(call());
      expect(pending.approval?.reason.startsWith(prefix)).toBe(true);
      expect(pending.approval?.reason).toContain(recent);
      expect(h.invoke).not.toHaveBeenCalled();
    },
  );
  it("consumes neverAsk without acquiring page control or website browsing permission", async () => {
    const h = await setup();
    const result = await h.host.executeTool(
      call({ query: "History marker", limit: 10 }),
    );
    expect(result).toMatchObject({ status: "completed", data: page });
    expect(result.approval).toBeUndefined();
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("browser_history_list", {
      query: "history marker",
      cursor: null,
      limit: 10,
    });
    expect(h.native.webContents.debugger.attach).not.toHaveBeenCalled();
    expect(h.native.webContents.debugger.sendCommand).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      controlOwner: "user",
      activeTurnId: null,
    });
  });

  it("asks before reading and consumes exactly one bound query after approval", async () => {
    const h = await setup("alwaysAsk");
    const input = call({ query: "History marker", limit: 10 });
    const pending = await h.host.executeTool(input);
    expect(pending).toMatchObject({
      status: "approval_required",
      approval: {
        actionKind: "history",
        riskClass: "history_read",
        reason: expect.stringContaining("History marker"),
        tabId: "tab-1",
        webContentsId: h.native.webContents.id,
      },
    });
    expect(h.invoke).not.toHaveBeenCalled();
    const granted = approved(input, pending);
    expect(await h.host.executeTool(granted)).toMatchObject({
      status: "completed",
      data: page,
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    await expect(h.host.executeTool(granted)).rejects.toThrow(
      "token is stale or invalid",
    );
    const next = await h.host.executeTool(
      call({}, { callId: "history-call-2" }),
    );
    expect(next.approval?.approvalToken).toBeTruthy();
    expect(next.approval?.approvalToken).not.toBe(
      pending.approval?.approvalToken,
    );
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.native.webContents.debugger.attach).not.toHaveBeenCalled();
  });

  it("keeps the user's history management available when Agent access is disabled", async () => {
    const h = await setup("disabled");
    await expect(h.host.executeTool(call())).rejects.toThrow(
      /history.*disabled/i,
    );
    expect(h.invoke).not.toHaveBeenCalled();
    expect(
      await h.host.invoke(h.window as never, "browser_history_list", {}),
    ).toEqual(page);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects changed arguments without reading and consumes the rejected token", async () => {
    const h = await setup("alwaysAsk");
    const input = call({ query: "first" });
    const pending = await h.host.executeTool(input);
    await expect(
      h.host.executeTool({
        ...approved(input, pending),
        arguments: { query: "different" },
      }),
    ).rejects.toThrow(/identity mismatch/);
    await expect(h.host.executeTool(approved(input, pending))).rejects.toThrow(
      "token is stale or invalid",
    );
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("revokes a pending query when the user disables history access", async () => {
    const h = await setup("alwaysAsk");
    const input = call();
    const pending = await h.host.executeTool(input);
    h.host.setSettings({ ...h.settings, history_access: "disabled" });
    await expect(h.host.executeTool(approved(input, pending))).rejects.toThrow(
      /stale|disabled/,
    );
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each([
    { query: 1 },
    { query: "x".repeat(257) },
    { cursor: 1 },
    { cursor: "x".repeat(4097) },
    { limit: 0 },
    { limit: 201 },
    { limit: 1.5 },
    { remove: true },
    { path: "/private/history" },
  ])(
    "rejects malformed or unbounded queries before the history owner: %j",
    async (args) => {
      const h = await setup();
      await expect(h.host.executeTool(call(args))).rejects.toThrow();
      expect(h.invoke).not.toHaveBeenCalled();
    },
  );

  it.each(["turn", "disconnect", "close", "takeover", "settings"] as const)(
    "discards in-flight results after %s",
    async (lifecycle) => {
      const h = await setup();
      let finish!: () => void;
      let enter!: () => void;
      const started = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        finish = resolve;
      });
      h.invoke.mockImplementationOnce(async () => {
        enter();
        await released;
        return structuredClone(page);
      });
      const reading = h.host.executeTool(call());
      const rejected = expect(reading).rejects.toThrow(
        /history.*(changed|unavailable|revoked|disabled)|stale/i,
      );
      await Promise.race([
        started,
        reading.then(() => {
          throw new Error("History call completed before entering storage");
        }),
      ]);
      if (lifecycle === "turn") h.host.turnEnded("thread-1", "turn-1");
      if (lifecycle === "disconnect") h.host.connectionLost();
      if (lifecycle === "close")
        await h.host.invoke(h.window as never, "browser_tab_close", {
          tabId: "tab-1",
        });
      if (lifecycle === "takeover")
        h.native.webContents.emit(
          "before-input-event",
          {},
          { type: "keyDown", key: "a" },
        );
      if (lifecycle === "settings")
        h.host.setSettings({ ...h.settings, history_access: "disabled" });
      finish();
      await rejected;
    },
  );

  it("rereads authoritative settings after asynchronous IO before releasing history", async () => {
    const h = await setup();
    h.invoke.mockImplementationOnce(async () => {
      h.host.setSettingsProvider(async () => ({
        ...h.settings,
        history_access: "disabled",
      }));
      return structuredClone(page);
    });
    await expect(h.host.executeTool(call())).rejects.toThrow(
      /history.*(changed|disabled|unavailable|revoked)/i,
    );
  });

  it("propagates storage and config failures without returning empty success", async () => {
    const h = await setup();
    h.invoke.mockRejectedValueOnce(new Error("history storage unavailable"));
    await expect(h.host.executeTool(call())).rejects.toThrow(
      "history storage unavailable",
    );
    h.host.setSettingsProvider(async () => {
      throw new Error("config unavailable");
    });
    await expect(
      h.host.executeTool(call({}, { callId: "history-call-2" })),
    ).rejects.toThrow("config unavailable");
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
});
