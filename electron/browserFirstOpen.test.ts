import { describe, expect, it, vi } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import { createHarness } from "./browserTabHost.testHarness";
import type { BrowserToolCall } from "./browserTabHost";

const call: BrowserToolCall = {
  tool: "newTab",
  arguments: { url: "https://www.baidu.com/" },
  callId: "first-open",
  ownerWebContentsId: 41,
  threadId: "thread-1",
  turnId: "turn-1",
  phase: "preflight",
};

function setup(ask = false) {
  const h = createHarness();
  if (ask) h.host.setSettings(effectiveBrowserSettings());
  const handler = {
    open: vi.fn(async () => ({
      browserSessionId: "browser-session-1",
      tabId: "primary",
    })),
    reveal: vi.fn(async () => {}),
  };
  h.browserHost.setToolWorkspaceHandler(handler);
  return { ...h, handler };
}

describe("first browser tool opens the session browser", () => {
  it("opens Baidu from zero tabs and reveals the same native page", async () => {
    const h = setup();
    const result = await h.host.executeTool(call);
    expect(result).toMatchObject({
      status: "completed",
      state: {
        tabId: "primary",
        url: call.arguments.url,
        origin: "agent",
        controlOwner: "agent",
      },
    });
    expect(h.views.size).toBe(1);
    expect(h.handler.open).toHaveBeenCalledTimes(1);
    expect(h.handler.reveal).toHaveBeenCalledTimes(1);
  });

  it("creates only a blank approval anchor until browsing is approved", async () => {
    const h = setup(true);
    const result = await h.host.executeTool(call);
    expect(result.status).toBe("approval_required");
    expect(result.approval?.webContentsId).toBeGreaterThan(0);
    expect([...h.views.values()][0].webContents.getURL()).toBe("");
    expect(
      h.embeddedHost.invoke.mock.calls.filter(
        ([, command]) => command === "embedded_browser_view_navigate",
      ),
    ).toHaveLength(0);
    const done = await h.host.executeTool({
      ...call,
      phase: "approvedExecute",
      approvalToken: result.approval?.approvalToken,
    });
    expect(done.state?.url).toBe(call.arguments.url);
    expect(h.views.size).toBe(1);
  });

  it("rejects a denied destination before allocating identity or a page", async () => {
    const h = setup();
    h.host.setSettings(
      effectiveBrowserSettings({
        approvalMode: "neverAsk",
        deniedOrigins: ["https://www.baidu.com"],
      }),
    );
    await expect(h.host.executeTool(call)).rejects.toThrow("denied");
    expect(h.handler.open).not.toHaveBeenCalled();
    expect(h.views.size).toBe(0);
  });

  it.each(["turn", "disconnect", "window", "policy"])(
    "cannot resurrect a page after %s while allocating identity",
    async (lifecycle) => {
      const h = setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.handler.open.mockImplementationOnce(async () => {
        await gate;
        return { browserSessionId: "browser-session-1", tabId: "primary" };
      });
      const execution = h.host.executeTool(call);
      const rejected = expect(execution).rejects.toThrow(
        /stale|unavailable|policy changed/,
      );
      await vi.waitFor(() => expect(h.handler.open).toHaveBeenCalledTimes(1));
      if (lifecycle === "turn") h.host.turnEnded(call.threadId, call.turnId);
      if (lifecycle === "disconnect") h.host.connectionLost();
      if (lifecycle === "window") h.window.isDestroyed = () => true;
      if (lifecycle === "policy")
        h.host.setSettings(effectiveBrowserSettings({ enabled: false }));
      release();
      await rejected;
      expect(h.views.size).toBe(0);
      expect(h.handler.reveal).not.toHaveBeenCalled();
    },
  );

  it("closes the blank approval anchor when the turn is cancelled", async () => {
    const h = setup(true);
    const permission = await h.host.executeTool(call);
    h.host.turnEnded(call.threadId, call.turnId);
    expect(h.views.size).toBe(0);
    await expect(
      h.host.executeTool({
        ...call,
        phase: "approvedExecute",
        approvalToken: permission.approval?.approvalToken,
      }),
    ).rejects.toThrow(/stale/);
  });

  it("serializes concurrent first opens without duplicate primary native pages", async () => {
    const h = setup();
    const results = await Promise.all([
      h.host.executeTool(call),
      h.host.executeTool({ ...call, callId: "second-open" }),
    ]);
    expect(results.map((result) => result.state?.tabId)).toEqual([
      "primary",
      "second-open",
    ]);
    expect(h.handler.open).toHaveBeenCalledTimes(1);
    expect(h.views.size).toBe(2);
  });
});
