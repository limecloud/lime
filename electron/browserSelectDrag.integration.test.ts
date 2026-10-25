import { describe, expect, it, vi } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { readBrowserSelectOptions } from "./browserSelect";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";

async function setup(tool: "select" | "drag") {
  const h = createHarness();
  const mounted = (await mount(h)) as { viewId: string };
  const native = h.views.get(mounted.viewId)!;
  let sequence = 0;
  const call = (name: string, args: Record<string, unknown> = {}) =>
    h.host.executeTool({
      threadId: "thread-1",
      turnId: "turn-1",
      ownerWebContentsId: 41,
      callId: `prepare-${++sequence}`,
      tool: name,
      arguments: { tabId: "tab-1", ...args },
    });
  await call("claimTab", {
    pageRevision: 0,
    title: "Example",
    url: "https://example.com/",
  });
  const send = native.webContents.debugger.sendCommand;
  const original = send.getMockImplementation()!;
  const model = {
    mask: 1,
    description: "initial target",
    values: ["beta"],
    html5: false,
    files: false,
  };
  send.mockImplementation(async (method, params, sessionId) => {
    switch (method) {
      case "Accessibility.getFullAXTree":
        return {
          nodes: [11, 12].map((id) => ({
            backendDOMNodeId: id,
            childIds: [],
            ignored: false,
            name: { value: `node ${id}` },
            nodeId: `ax-${id}`,
            role: { value: "button" },
          })),
        };
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "main-frame" } } };
      case "Page.createIsolatedWorld":
        return { executionContextId: 1 };
      case "DOM.resolveNode":
        return { object: { objectId: `node-${params?.backendNodeId}` } };
      case "Runtime.callFunctionOn": {
        const args = params?.arguments as Array<{ value: unknown }> | undefined;
        if (args?.length === 3)
          return {
            result: {
              value: { description: model.description, values: model.values },
            },
          };
        if (args?.length === 1)
          return {
            result: {
              value: { x: params?.objectId === "node-11" ? 20 : 100, y: 20 },
            },
          };
        return { result: { value: model.description } };
      }
      case "Page.getLayoutMetrics":
        return {
          cssVisualViewport: {
            clientWidth: 800,
            clientHeight: 600,
            pageX: 0,
            pageY: 0,
          },
        };
      case "DOM.getNodeForLocation":
        return { frameId: "main-frame" };
      case "Input.dispatchMouseEvent":
        if (
          model.html5 &&
          params?.type === "mouseMoved" &&
          params.buttons === 1
        )
          native.webContents.debugger.emit(
            "message",
            {},
            "Input.dragIntercepted",
            {
              data: {
                items: [{ mimeType: "text/plain", data: "dragged" }],
                dragOperationsMask: model.mask,
                ...(model.files ? { files: ["/private/file"] } : {}),
              },
            },
          );
    }
    return original(method, params, sessionId);
  });
  const observed = await call("observe");
  const args: Record<string, unknown> = {
    tabId: "tab-1",
    snapshotId: (observed.data as { snapshotId: string }).snapshotId,
    backendNodeId: 11,
    ...(tool === "select"
      ? { options: [{ value: "beta" }] }
      : { targetBackendNodeId: 12 }),
  };
  const request = {
    threadId: "thread-1",
    turnId: "turn-1",
    ownerWebContentsId: 41,
    callId: "action-1",
    tool,
    arguments: args,
  };
  const preflight = () => h.host.executeTool(request);
  const approve = (token: string, changedArgs = args) =>
    h.host.executeTool({
      ...request,
      phase: "approvedExecute",
      approvalToken: token,
      arguments: changedArgs,
    });
  send.mockClear();
  return { ...h, native, send, model, args, request, preflight, approve, call };
}

describe("Browser selection and drag authority", () => {
  it.each(["select", "drag"] as const)(
    "%s preflight is read-only and approval is one-use",
    async (tool) => {
      const h = await setup(tool);
      const preflight = await h.preflight();
      expect(preflight.status).toBe("approval_required");
      expect(h.send.mock.calls.some(([m]) => m.startsWith("Input."))).toBe(
        false,
      );
      expect(
        h.send.mock.calls.some(
          ([m, p]) =>
            m === "Runtime.callFunctionOn" &&
            (p?.arguments as Array<{ value: unknown }> | undefined)?.[1]
              ?.value === true,
        ),
      ).toBe(false);
      const approved = await h.approve(preflight.approval!.approvalToken);
      expect(approved).toMatchObject({
        status: "completed",
        data:
          tool === "select"
            ? { values: ["beta"] }
            : { mode: "pointer", dispatched: true },
      });
      await expect(
        h.approve(preflight.approval!.approvalToken),
      ).rejects.toThrow("stale or invalid");
      await expect(h.call("hover", h.args)).rejects.toThrow(
        "snapshot is stale",
      );
    },
  );

  it.each(["select", "drag"] as const)(
    "%s rejects mutated approved arguments",
    async (tool) => {
      const h = await setup(tool);
      const p = await h.preflight();
      h.send.mockClear();
      await expect(
        h.approve(p.approval!.approvalToken, {
          ...h.args,
          ...(tool === "select"
            ? { options: [] }
            : { targetBackendNodeId: 11 }),
        }),
      ).rejects.toThrow("identity mismatch");
      expect(h.send.mock.calls.some(([m]) => m.startsWith("Input."))).toBe(
        false,
      );
    },
  );

  it.each(["select", "drag"] as const)(
    "%s rejects a target changed after approval",
    async (tool) => {
      const h = await setup(tool);
      const p = await h.preflight();
      h.model.description = "changed target";
      h.send.mockClear();
      await expect(h.approve(p.approval!.approvalToken)).rejects.toThrow(
        "changed after preflight",
      );
      expect(h.send.mock.calls.some(([m]) => m.startsWith("Input."))).toBe(
        false,
      );
    },
  );

  it("requires both drag endpoints in the same snapshot", async () => {
    const h = await setup("drag");
    h.args.targetBackendNodeId = 99;
    await expect(h.preflight()).rejects.toThrow("snapshot is stale");
    expect(
      h.send.mock.calls.some(
        ([m]) => m.startsWith("Input.") || m === "Runtime.callFunctionOn",
      ),
    ).toBe(false);
  });

  it("rejects identical drag endpoints", async () => {
    const h = await setup("drag");
    h.args.targetBackendNodeId = 11;
    await expect(h.preflight()).rejects.toThrow(
      "different observed destination",
    );
  });

  it.each([1, -1])(
    "uses captured HTML5 mask %s and restores the interceptor/listeners",
    async (mask) => {
      const h = await setup("drag");
      h.model.mask = mask;
      h.model.html5 = true;
      const p = await h.preflight();
      const listeners = h.native.webContents.debugger.listenerCount("message");
      expect(await h.approve(p.approval!.approvalToken)).toMatchObject({
        data: { mode: "html5" },
      });
      expect(
        h.send.mock.calls
          .filter(([m]) => m === "Input.dispatchDragEvent")
          .map(([, p]) => p?.type),
      ).toEqual(["dragEnter", "dragOver", "drop"]);
      expect(h.send).toHaveBeenCalledWith("Input.setInterceptDrags", {
        enabled: false,
      });
      expect(h.native.webContents.debugger.listenerCount("message")).toBe(
        listeners,
      );
    },
  );

  it("rejects file drag payloads and cancels the active drag", async () => {
    const h = await setup("drag");
    h.model.html5 = true;
    h.model.files = true;
    const p = await h.preflight();
    await expect(h.approve(p.approval!.approvalToken)).rejects.toThrow(
      "cannot upload local files",
    );
    expect(h.send).toHaveBeenCalledWith("Input.cancelDragging");
    expect(h.send).toHaveBeenCalledWith("Input.setInterceptDrags", {
      enabled: false,
    });
    expect(
      h.send.mock.calls.some(([m]) => m === "Input.dispatchDragEvent"),
    ).toBe(false);
  });

  it("does not clean up input in a replacement debugger attachment", async () => {
    const h = await setup("drag");
    h.model.html5 = true;
    h.model.files = true;
    const p = await h.preflight();
    const original = h.send.getMockImplementation()!;
    h.send.mockImplementation(async (method, params, sessionId) => {
      if (method === "Input.cancelDragging") {
        h.native.webContents.debugger.detach();
        h.native.webContents.debugger.attach();
      }
      return original(method, params, sessionId);
    });
    await expect(h.approve(p.approval!.approvalToken)).rejects.toThrow(
      "cannot upload local files",
    );
    expect(
      h.send.mock.calls.some(
        ([method, params]) =>
          method === "Input.dispatchMouseEvent" &&
          params?.type === "mouseReleased",
      ),
    ).toBe(false);
    expect(h.send).not.toHaveBeenCalledWith("Input.setInterceptDrags", {
      enabled: false,
    });
  });

  it.each(["navigation", "user", "turn", "policy"] as const)(
    "stops drag after %s interrupts preparation",
    async (kind) => {
      const h = await setup("drag");
      const p = await h.preflight();
      const original = h.send.getMockImplementation()!;
      let interrupted = false;
      let pressed = false;
      h.send.mockImplementation(async (method, params, sessionId) => {
        const result = await original(method, params, sessionId);
        if (
          method === "Input.dispatchMouseEvent" &&
          params?.type === "mousePressed"
        )
          pressed = true;
        if (!interrupted && pressed && method === "Page.getLayoutMetrics") {
          interrupted = true;
          if (kind === "navigation")
            h.host.observeEmbeddedEvent(
              "embedded-browser-view-navigation-started",
              { viewId: h.native.viewId },
            );
          if (kind === "user")
            h.native.webContents.emit(
              "before-input-event",
              {},
              { type: "keyDown", key: "Escape" },
            );
          if (kind === "turn") await h.host.turnEnded("thread-1", "turn-1");
          if (kind === "policy")
            h.host.setSettings(effectiveBrowserSettings({ enabled: false }));
        }
        return result;
      });
      await expect(h.approve(p.approval!.approvalToken)).rejects.toThrow();
      expect(interrupted).toBe(true);
      expect(
        h.send.mock.calls.some(([m]) => m === "Input.dispatchDragEvent"),
      ).toBe(false);
    },
  );

  it("rejects stale approval after turn completion", async () => {
    const h = await setup("select");
    const p = await h.preflight();
    await h.host.turnEnded("thread-1", "turn-1");
    await expect(h.approve(p.approval!.approvalToken)).rejects.toThrow(
      "stale or invalid",
    );
  });

  it("rejects overlapping input on the same native page", async () => {
    const h = await setup("drag");
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
    const pending = h.preflight();
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    await expect(h.call("hover", h.args)).rejects.toThrow(
      "already in progress",
    );
    resume();
    await expect(pending).resolves.toMatchObject({
      status: "approval_required",
    });
  });

  it("cancels an HTML5 drag when its destination becomes obscured", async () => {
    const h = await setup("drag");
    h.model.html5 = true;
    const p = await h.preflight();
    const original = h.send.getMockImplementation()!;
    let dragging = false;
    h.send.mockImplementation(async (method, params, sessionId) => {
      const result = await original(method, params, sessionId);
      if (
        method === "Input.dispatchMouseEvent" &&
        params?.type === "mouseMoved" &&
        params.buttons === 1
      )
        dragging = true;
      if (
        dragging &&
        method === "Runtime.callFunctionOn" &&
        params?.objectId === "node-12"
      )
        return {
          result: { value: { error: "Browser input target is obscured" } },
        };
      return result;
    });
    await expect(h.approve(p.approval!.approvalToken)).rejects.toThrow(
      "obscured",
    );
    expect(h.send).toHaveBeenCalledWith("Input.cancelDragging");
    expect(
      h.send.mock.calls.some(([m]) => m === "Input.dispatchDragEvent"),
    ).toBe(false);
  });

  it.each([
    null,
    [{}],
    [{ value: undefined }],
    [{ value: 1 }],
    [{ label: "x", extra: true }],
    [{ index: -1 }],
    [{ index: 1.2 }],
    Array(101).fill({ value: "x" }),
  ])("rejects malformed select choices %j", (value) => {
    expect(() => readBrowserSelectOptions(value)).toThrow();
  });
});
