import { expect, it, vi } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import type { BrowserToolCall } from "./browserTabHost";
import { BrowserCdpSessions } from "./browserCdpSessions";

const frameId = "child-target";
const sessionId = "child-session";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function setup() {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings({
      approvalMode: "neverAsk",
      fullCdpAccessEnabled: true,
    }),
  );
  const state = (await mount(h)) as { viewId: string };
  const native = h.views.get(state.viewId)!.webContents;
  let next = 0;
  const call = (
    tool: string,
    args: Record<string, unknown> = {},
  ): BrowserToolCall => ({
    arguments: { tabId: "tab-1", ...args },
    callId: `session-${next++}`,
    ownerWebContentsId: 41,
    phase: "preflight",
    threadId: "thread-1",
    tool,
    turnId: "turn-1",
  });
  await h.host.executeTool(
    call("claimTab", {
      title: "Example",
      url: "https://example.com/",
      pageRevision: 0,
    }),
  );
  native.debugger.sendCommand.mockImplementation(
    async (method, params, selectedSession) => {
      if (method === "Page.getFrameTree")
        return {
          frameTree: { frame: { id: "main", url: "https://example.com/" } },
        };
      if (method === "Target.getTargets")
        return {
          targetInfos: [
            {
              targetId: frameId,
              parentFrameId: "main",
              type: "iframe",
              url: "https://frame.example/",
            },
            {
              targetId: "other-tab-child",
              parentFrameId: "other-main",
              type: "iframe",
              url: "https://frame.example/",
            },
          ],
        };
      if (method === "Target.attachToTarget") {
        native.debugger.emit("message", {}, "Target.attachedToTarget", {
          sessionId,
          targetInfo: { targetId: params?.targetId },
        });
        return { sessionId };
      }
      if (method === "Target.detachFromTarget") {
        native.debugger.emit("message", {}, "Target.detachedFromTarget", {
          sessionId: params?.sessionId,
        });
        return {};
      }
      if (method === "Runtime.evaluate")
        return {
          result: { value: selectedSession === sessionId ? "child" : "main" },
        };
      return {};
    },
  );
  const approve = async (tool: string, args: Record<string, unknown> = {}) => {
    const request = call(tool, args);
    const pending = await h.host.executeTool(request);
    expect(pending).toMatchObject({
      status: "approval_required",
      approval: { riskClass: "full_cdp", actionKind: tool },
    });
    return h.host.executeTool({
      ...request,
      phase: "approvedExecute",
      approvalToken: pending.approval!.approvalToken,
    });
  };
  return { ...h, native, call, approve };
}

it("attaches only after canonical approval and routes both target and session selections to the same native frame", async () => {
  const h = await setup();
  const request = h.call("attachTarget", { targetId: frameId });
  const pending = await h.host.executeTool(request);
  expect(pending.status).toBe("approval_required");
  expect(h.native.debugger.attach).not.toHaveBeenCalled();
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalled();
  const attached = await h.host.executeTool({
    ...request,
    phase: "approvedExecute",
    approvalToken: pending.approval!.approvalToken,
  });
  expect(attached).toMatchObject({
    status: "completed",
    data: { targetId: frameId, sessionId },
  });
  expect(h.native.debugger.sendCommand).toHaveBeenCalledWith(
    "Target.attachToTarget",
    { targetId: frameId, flatten: true },
  );
  for (const target of [
    { targetId: frameId },
    { sessionId },
    { targetId: frameId, sessionId },
  ]) {
    const result = await h.approve("executeCdpCommand", {
      method: "Runtime.evaluate",
      commandParams: { expression: "location.href" },
      target,
    });
    expect(result).toMatchObject({ data: { result: { value: "child" } } });
    expect(h.native.debugger.sendCommand).toHaveBeenCalledWith(
      "Runtime.evaluate",
      { expression: "location.href" },
      sessionId,
    );
  }
  await h.approve("detachTarget", { targetId: frameId });
  expect(h.native.debugger.sendCommand).toHaveBeenCalledWith(
    "Target.detachFromTarget",
    { sessionId },
  );
  await expect(
    h.host.executeTool(
      h.call("executeCdpCommand", {
        method: "Runtime.evaluate",
        target: { sessionId },
      }),
    ),
  ).rejects.toThrow(/session|attached/iu);
});

it("rejects another page's frame even when its URL equals an owned frame", async () => {
  const h = await setup();
  await expect(
    h.approve("attachTarget", { targetId: "other-tab-child" }),
  ).rejects.toThrow(/target|frame/iu);
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalledWith(
    "Target.attachToTarget",
    expect.anything(),
  );
});

it("does not attach a frame denied by the administrator's origin policy", async () => {
  const h = await setup();
  h.host.setSettings(
    effectiveBrowserSettings(
      { approvalMode: "neverAsk", fullCdpAccessEnabled: true },
      null,
      {
        browserUse: { origins: { "frame.example": { fullCdpAccess: "deny" } } },
      },
    ),
  );
  await expect(
    h.approve("attachTarget", { targetId: frameId }),
  ).rejects.toThrow(/target|frame|denied/iu);
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalledWith(
    "Target.attachToTarget",
    expect.anything(),
  );
});

it("binds target attachment approval to the original target and rejects mismatched target/session pairs", async () => {
  const h = await setup();
  const request = h.call("attachTarget", { targetId: frameId });
  const pending = await h.host.executeTool(request);
  await expect(
    h.host.executeTool({
      ...request,
      phase: "approvedExecute",
      approvalToken: pending.approval!.approvalToken,
      arguments: { ...request.arguments, targetId: "other-tab-child" },
    }),
  ).rejects.toThrow("identity mismatch");
  await h.approve("attachTarget", { targetId: frameId });
  await expect(
    h.host.executeTool(
      h.call("executeCdpCommand", {
        method: "Runtime.evaluate",
        target: { targetId: "other-tab-child", sessionId },
      }),
    ),
  ).rejects.toThrow(/session|target/iu);
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalledWith(
    "Runtime.evaluate",
    expect.anything(),
    sessionId,
  );
});

it("forgets a detached frame's session before another command can use it", async () => {
  const h = await setup();
  await h.approve("attachTarget", { targetId: frameId });
  h.native.debugger.emit("message", {}, "Target.detachedFromTarget", {
    sessionId,
  });
  await expect(
    h.host.executeTool(
      h.call("executeCdpCommand", {
        method: "Runtime.evaluate",
        target: { targetId: frameId },
      }),
    ),
  ).rejects.toThrow(/session|attached/iu);
});

it.each(["turn", "policy", "native-detach", "crash", "destroyed"])(
  "removes debugger listeners and frame control on %s revocation",
  async (reason) => {
    const h = await setup();
    await h.approve("attachTarget", { targetId: frameId });
    expect(h.native.debugger.listenerCount("message")).toBe(1);
    if (reason === "turn") h.host.turnEnded("thread-1", "turn-1");
    else if (reason === "policy")
      h.host.setSettings(
        effectiveBrowserSettings({
          approvalMode: "neverAsk",
          fullCdpAccessEnabled: false,
        }),
      );
    else if (reason === "crash") h.native.emit("render-process-gone", {}, {});
    else if (reason === "destroyed") h.native.emit("destroyed");
    else h.native.debugger.emit("detach", {}, "target_closed");
    expect(h.native.debugger.listenerCount("message")).toBe(0);
    h.native.debugger.emit("message", {}, "Target.attachedToTarget", {
      sessionId,
      targetInfo: { targetId: frameId },
    });
    await expect(
      h.host.executeTool(
        h.call("executeCdpCommand", {
          method: "Runtime.evaluate",
          target: { sessionId },
        }),
      ),
    ).rejects.toThrow();
    expect(h.native.debugger.sendCommand).not.toHaveBeenCalledWith(
      "Runtime.evaluate",
      expect.anything(),
      sessionId,
    );
  },
);

it.each(["attach", "Page.enable", "DOM.enable"])(
  "cleans native listeners and debugger attachment after %s initialization fails",
  async (stage) => {
    const h = await setup();
    const original = h.native.debugger.sendCommand.getMockImplementation()!;
    if (stage === "attach")
      h.native.debugger.attach.mockImplementationOnce(() => {
        throw new Error("native initialization failed");
      });
    else
      h.native.debugger.sendCommand.mockImplementation(async (...args) => {
        if (args[0] === stage) throw new Error("native initialization failed");
        return original(...args);
      });
    await expect(
      h.approve("attachTarget", { targetId: frameId }),
    ).rejects.toThrow("native initialization failed");
    expect(h.native.debugger.listenerCount("message")).toBe(0);
    expect(h.native.debugger.listenerCount("detach")).toBe(0);
    expect(h.native.debugger.isAttached()).toBe(false);
  },
);

it("invalidates pending approval when a native session is remapped", async () => {
  const h = await setup();
  await h.approve("attachTarget", { targetId: frameId });
  const request = h.call("executeCdpCommand", {
    method: "Runtime.evaluate",
    target: { sessionId },
  });
  const pending = await h.host.executeTool(request);
  h.native.debugger.emit("message", {}, "Target.attachedToTarget", {
    sessionId,
    targetInfo: { targetId: "other-tab-child" },
  });
  await expect(
    h.host.executeTool({
      ...request,
      phase: "approvedExecute",
      approvalToken: pending.approval!.approvalToken,
    }),
  ).rejects.toThrow(/approval|stale|expired/iu);
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalledWith(
    "Runtime.evaluate",
    expect.anything(),
    sessionId,
  );
});

it("revalidates native frame ancestry after approval before sending to a session", async () => {
  const h = await setup();
  await h.approve("attachTarget", { targetId: frameId });
  const original = h.native.debugger.sendCommand.getMockImplementation()!;
  const request = h.call("executeCdpCommand", {
    method: "Runtime.evaluate",
    target: { sessionId },
  });
  const pending = await h.host.executeTool(request);
  h.native.debugger.sendCommand.mockImplementation(async (...args) =>
    args[0] === "Target.getTargets"
      ? {
          targetInfos: [
            {
              targetId: frameId,
              parentFrameId: "other-main",
              type: "iframe",
              url: "https://frame.example/",
            },
          ],
        }
      : original(...args),
  );
  await expect(
    h.host.executeTool({
      ...request,
      phase: "approvedExecute",
      approvalToken: pending.approval!.approvalToken,
    }),
  ).rejects.toThrow(/unavailable|denied/iu);
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalledWith(
    "Runtime.evaluate",
    expect.anything(),
    sessionId,
  );
});

it("does not revive a timed out attachment when its native response arrives late", async () => {
  const h = await setup();
  const original = h.native.debugger.sendCommand.getMockImplementation()!;
  const deferred = createDeferred<Record<string, unknown>>();
  const started = createDeferred<void>();
  h.native.debugger.sendCommand.mockImplementation(async (...args) => {
    if (args[0] !== "Target.attachToTarget") return original(...args);
    started.resolve();
    return deferred.promise;
  });
  vi.useFakeTimers();
  try {
    const result = h.approve("attachTarget", {
      targetId: frameId,
      timeoutMs: 20,
    });
    const rejected = expect(result).rejects.toThrow(/timed out/iu);
    await started.promise;
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    deferred.resolve({ sessionId });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.native.debugger.listenerCount("message")).toBe(0);
    expect(h.native.debugger.isAttached()).toBe(false);
    await expect(
      h.host.executeTool(
        h.call("executeCdpCommand", {
          method: "Runtime.evaluate",
          target: { sessionId },
        }),
      ),
    ).rejects.toThrow();
  } finally {
    deferred.resolve({ sessionId });
    vi.useRealTimers();
  }
});

it("does not reuse another tab's session even within the same owner and turn", async () => {
  const h = await setup();
  await h.approve("attachTarget", { targetId: frameId });
  const second = (await mount(h, { tabId: "tab-2" })) as { viewId: string };
  await h.host.executeTool(
    h.call("claimTab", {
      tabId: "tab-2",
      title: "Example",
      url: "https://example.com/",
      pageRevision: 0,
    }),
  );
  await expect(
    h.host.executeTool(
      h.call("executeCdpCommand", {
        tabId: "tab-2",
        method: "Runtime.evaluate",
        target: { sessionId },
      }),
    ),
  ).rejects.toThrow(/session.*attached/iu);
  expect(
    h.views.get(second.viewId)!.webContents.debugger.sendCommand,
  ).not.toHaveBeenCalled();
});

it("routes native auto-attach events through the same scoped frame session validation", async () => {
  const h = await setup();
  const original = h.native.debugger.sendCommand.getMockImplementation()!;
  h.native.debugger.sendCommand.mockImplementation(async (...args) => {
    if (args[0] === "Target.setAutoAttach") {
      h.native.debugger.emit("message", {}, "Target.attachedToTarget", {
        sessionId,
        targetInfo: { targetId: frameId },
      });
      return {};
    }
    return original(...args);
  });
  await h.approve("executeCdpCommand", {
    method: "Target.setAutoAttach",
    commandParams: {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
    },
  });
  const result = await h.approve("executeCdpCommand", {
    method: "Runtime.evaluate",
    target: { sessionId },
  });
  expect(result).toMatchObject({ data: { result: { value: "child" } } });
});

it("does not initialize or detach a newer native attachment when an older initialization fails late", async () => {
  const h = await setup();
  const sessions = new BrowserCdpSessions();
  const deferred = createDeferred<Record<string, unknown>>();
  h.native.debugger.sendCommand.mockImplementationOnce(() => deferred.promise);
  const old = sessions.attachDebugger(
    "tab-1",
    h.native as never,
    vi.fn(),
    vi.fn(),
  );
  const rejected = expect(old).rejects.toThrow("old initialization failed");
  sessions.unregisterDebuggerListener("tab-1");
  await sessions.attachDebugger("tab-1", h.native as never, vi.fn(), vi.fn());
  deferred.reject(new Error("old initialization failed"));
  await rejected;
  expect(h.native.debugger.isAttached()).toBe(true);
  expect(h.native.debugger.detach).not.toHaveBeenCalled();
  expect(h.native.debugger.listenerCount("message")).toBe(1);
  sessions.unregisterDebuggerListener("tab-1");
});
