import { describe, expect, it, vi } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";

async function setup() {
  const h = createHarness();
  const mounted = (await mount(h)) as { viewId: string };
  let callId = 0;
  const call = (tool: string, args: Record<string, unknown> = {}) =>
    h.host.executeTool({
      arguments: { tabId: "tab-1", ...args },
      callId: `pointer-${++callId}`,
      ownerWebContentsId: 41,
      threadId: "thread-1",
      tool,
      turnId: "turn-1",
    });
  await call("claimTab", {
    pageRevision: 0,
    title: "Example",
    url: "https://example.com/",
  });
  const native = h.views.get(mounted.viewId)!;
  const send = native.webContents.debugger.sendCommand;
  const original = send.getMockImplementation()!;
  const responses: Record<string, Record<string, unknown>> = {
    "Page.getFrameTree": { frameTree: { frame: { id: "main-frame" } } },
    "Page.createIsolatedWorld": { executionContextId: 1 },
    "DOM.resolveNode": { object: { objectId: "node-11" } },
    "Runtime.callFunctionOn": { result: { value: { x: 20, y: 10 } } },
    "DOM.getNodeForLocation": { frameId: "main-frame", backendNodeId: 11 },
    "Page.getLayoutMetrics": {
      cssVisualViewport: {
        clientWidth: 800,
        clientHeight: 600,
        pageX: 0,
        pageY: 0,
      },
    },
  };
  send.mockImplementation(
    async (method, params, sessionId) =>
      responses[method] ?? original(method, params, sessionId),
  );
  const observe = async () => {
    const observed = await call("observe");
    return (observed.data as { snapshotId: string }).snapshotId;
  };
  return { ...h, call, native, send, responses, observe };
}

describe("Browser native pointer tools", () => {
  it("converts native hit testing to document coordinates after page scroll", async () => {
    const h = await setup();
    h.responses["Page.getLayoutMetrics"] = {
      cssVisualViewport: {
        clientWidth: 800,
        clientHeight: 600,
        pageX: 60,
        pageY: 1400,
      },
    };
    await h.call("hover", { snapshotId: await h.observe(), backendNodeId: 11 });
    expect(h.send).toHaveBeenCalledWith("DOM.getNodeForLocation", {
      x: 80,
      y: 1410,
    });
    expect(h.send).toHaveBeenCalledWith(
      "Input.dispatchMouseEvent",
      expect.objectContaining({ x: 20, y: 10 }),
    );
  });

  it("expires stalled preparation and cannot dispatch input when it resumes", async () => {
    const h = await setup();
    const snapshotId = await h.observe();
    const original = h.send.getMockImplementation()!;
    let resume!: () => void;
    const barrier = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const started = vi.fn();
    h.send.mockImplementation(async (method, params, sessionId) => {
      if (method === "Runtime.callFunctionOn") {
        started();
        await barrier;
      }
      return original(method, params, sessionId);
    });
    vi.useFakeTimers();
    try {
      const result = h
        .call("hover", { snapshotId, backendNodeId: 11 })
        .catch((error: unknown) => error);
      await vi.waitFor(() => expect(started).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(10001);
      expect(await result).toEqual(
        expect.objectContaining({
          message: "Browser pointer action timed out",
        }),
      );
      expect(h.native.webContents.debugger.detach).toHaveBeenCalled();
      const tabs = await h.host.invoke(h.window as never, "browser_tab_list", {
        threadId: "thread-1",
        browserSessionId: "browser-session-1",
      });
      expect(tabs).toEqual([
        expect.objectContaining({ controlOwner: "user", activeTurnId: null }),
      ]);
      resume();
      await vi.advanceTimersByTimeAsync(1);
      expect(
        h.send.mock.calls.some(([method]) => method.startsWith("Input.")),
      ).toBe(false);
    } finally {
      resume();
      vi.useRealTimers();
    }
  });
  it.each(["hover", "scroll"])(
    "executes %s on the claimed original page and consumes its snapshot",
    async (tool) => {
      const h = await setup();
      const snapshotId = await h.observe();
      const args = {
        snapshotId,
        backendNodeId: 11,
        ...(tool === "scroll" ? { deltaX: -12.5, deltaY: 120 } : {}),
      };
      const result = await h.call(tool, args);
      expect(result.state).toMatchObject({
        controlOwner: "agent",
        activeTurnId: "turn-1",
        webContentsId: h.native.webContents.id,
        pageRevision: 1,
      });
      expect(h.send).toHaveBeenCalledWith("Input.dispatchMouseEvent", {
        type: tool === "hover" ? "mouseMoved" : "mouseWheel",
        x: 20,
        y: 10,
        button: "none",
        buttons: 0,
        ...(tool === "scroll" ? { deltaX: -12.5, deltaY: 120 } : {}),
      });
      await expect(h.call(tool, args)).rejects.toThrow("snapshot is stale");
      expect(h.send).toHaveBeenCalledWith("Runtime.releaseObject", {
        objectId: "node-11",
      });
    },
  );

  it("uses the visible viewport for an untargeted wheel and blocks frame hit targets", async () => {
    const h = await setup();
    await h.call("scroll", { snapshotId: await h.observe(), deltaY: 100 });
    expect(h.send).toHaveBeenCalledWith("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 400,
      y: 300,
      deltaX: 0,
      deltaY: 100,
      button: "none",
      buttons: 0,
    });
    h.responses["DOM.getNodeForLocation"] = { frameId: "unapproved-child" };
    h.send.mockClear();
    await expect(
      h.call("scroll", { snapshotId: await h.observe(), deltaY: 100 }),
    ).rejects.toThrow("child frame");
    expect(
      h.send.mock.calls.some(([method]) => method.startsWith("Input.")),
    ).toBe(false);
  });

  it.each([
    ["hover", { backendNodeId: 99 }, "snapshot is stale"],
    ["scroll", { deltaY: 10001 }, "deltaY"],
    ["scroll", { deltaX: "12" }, "deltaX"],
    ["scroll", { deltaY: NaN }, "deltaY"],
    ["scroll", {}, "non-zero"],
  ] as const)(
    "rejects invalid %s input before native dispatch",
    async (tool, args, error) => {
      const h = await setup();
      const snapshotId = await h.observe();
      h.send.mockClear();
      await expect(h.call(tool, { snapshotId, ...args })).rejects.toThrow(
        error,
      );
      expect(
        h.send.mock.calls.some(([method]) => method.startsWith("Input.")),
      ).toBe(false);
    },
  );

  it("rejects an obscured node and releases its remote object", async () => {
    const h = await setup();
    h.responses["Runtime.callFunctionOn"] = {
      result: { value: { error: "Browser input target is obscured" } },
    };
    await expect(
      h.call("hover", { snapshotId: await h.observe(), backendNodeId: 11 }),
    ).rejects.toThrow("obscured");
    expect(h.send).toHaveBeenCalledWith("Runtime.releaseObject", {
      objectId: "node-11",
    });
    expect(
      h.send.mock.calls.some(([method]) => method.startsWith("Input.")),
    ).toBe(false);
  });

  it.each(["takeover", "turn-end", "navigation", "policy"])(
    "stops pending native work after %s",
    async (reason) => {
      const h = await setup();
      const snapshotId = await h.observe();
      const original = h.send.getMockImplementation()!;
      let resume!: () => void;
      const barrier = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const started = vi.fn();
      h.send.mockImplementation(async (method, params, sessionId) => {
        if (method === "Runtime.callFunctionOn") {
          started();
          await barrier;
        }
        return original(method, params, sessionId);
      });
      const result = h.call("hover", { snapshotId, backendNodeId: 11 });
      const rejection = expect(result).rejects.toThrow(
        /claimed|snapshot|policy|settings/,
      );
      await vi.waitFor(() => expect(started).toHaveBeenCalled());
      if (reason === "takeover")
        h.native.webContents.emit(
          "before-input-event",
          {},
          { type: "keyDown", key: "a" },
        );
      if (reason === "turn-end") await h.host.turnEnded("thread-1", "turn-1");
      if (reason === "navigation")
        h.host.observeEmbeddedEvent(
          "embedded-browser-view-navigation-started",
          { viewId: h.native.viewId },
        );
      if (reason === "policy")
        h.host.setSettings(effectiveBrowserSettings({ enabled: false }));
      resume();
      await rejection;
      expect(
        h.send.mock.calls.some(([method]) => method.startsWith("Input.")),
      ).toBe(false);
    },
  );
});
