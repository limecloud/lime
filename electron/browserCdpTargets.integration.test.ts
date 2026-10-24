import { expect, it } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import type { BrowserToolCall } from "./browserTabHost";

const targetId = "browser-use-iab-tab:tab-1";
const command = (method: string, commandParams = {}): BrowserToolCall => ({
  arguments: { method, commandParams, tabId: "tab-1" },
  callId: `cdp-${method}`,
  ownerWebContentsId: 41,
  phase: "preflight",
  threadId: "thread-1",
  tool: "executeCdpCommand",
  turnId: "turn-1",
});

async function setup() {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings({
      approvalMode: "neverAsk",
      fullCdpAccessEnabled: true,
    }),
  );
  const state = (await mount(h)) as { viewId: string };
  await h.host.executeTool({
    ...command("Target.getTargetInfo"),
    tool: "claimTab",
    arguments: {
      tabId: "tab-1",
      title: "Example",
      url: "https://example.com/",
      pageRevision: 0,
    },
  });
  const native = h.views.get(state.viewId)!.webContents;
  const execute = async (method: string, params = {}) => {
    const call = command(method, params);
    const pending = await h.host.executeTool(call);
    expect(pending.status).toBe("approval_required");
    return h.host.executeTool({
      ...call,
      phase: "approvedExecute",
      approvalToken: pending.approval!.approvalToken,
    });
  };
  return { ...h, native, execute };
}

it("reads only the current logical target without attaching or forwarding a global Target command", async () => {
  const h = await setup();
  const result = await h.execute("Target.getTargetInfo", { targetId });
  expect(result).toMatchObject({
    status: "completed",
    data: {
      targetInfo: {
        id: targetId,
        targetId,
        tabId: "tab-1",
        type: "page",
        attached: false,
        canAccessOpener: false,
        title: "Example",
        url: "https://example.com/",
      },
    },
  });
  expect(h.native.debugger.attach).not.toHaveBeenCalled();
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalled();
});

it.each(["Target.getTargetInfo", "Target.closeTarget"])(
  "rejects a different target before canonical approval: %s",
  async (method) => {
    const h = await setup();
    await expect(
      h.host.executeTool(
        command(method, { targetId: "browser-use-iab-tab:other" }),
      ),
    ).rejects.toThrow("current in-app browser tab");
    expect(h.native.debugger.sendCommand).not.toHaveBeenCalled();
  },
);

it("rejects an unattached explicit target/session selection before approval", async () => {
  const h = await setup();
  const call = command("Runtime.evaluate", { expression: "42" });
  call.arguments.target = { sessionId: "another-session" };
  await expect(h.host.executeTool(call)).rejects.toThrow(/session.*attached/iu);
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalled();
});

it("lists this browser session's tabs and joins native frame targets to the current frame tree", async () => {
  const h = await setup();
  await mount(h, { tabId: "tab-2", selected: false });
  await mount(h, {
    tabId: "other-session",
    browserSessionId: "other",
    selected: false,
  });
  await mount(h, { tabId: "other-thread", threadId: "other", selected: false });
  h.native.debugger.sendCommand.mockImplementation(async (method) => {
    if (method === "Page.getFrameTree")
      return {
        frameTree: {
          frame: { id: "main", url: "https://example.com/" },
          childFrames: [
            { frame: { id: "child", url: "https://frame.example/" } },
          ],
        },
      };
    if (method === "Target.getTargets")
      return {
        targetInfos: [
          {
            targetId: "child",
            type: "iframe",
            url: "https://frame.example/",
            title: "Frame",
          },
          {
            targetId: "unrelated",
            type: "iframe",
            url: "https://private.example/",
          },
          { targetId: "main", type: "page", url: "https://example.com/" },
          {
            targetId: "worker",
            type: "service_worker",
            url: "https://example.com/",
          },
        ],
      };
    return {};
  });
  const result = await h.execute("Target.getTargets");
  expect(result).toMatchObject({
    status: "completed",
    data: {
      targetInfos: [
        { targetId, tabId: "tab-1", type: "page" },
        { targetId: "browser-use-iab-tab:tab-2", tabId: "tab-2", type: "page" },
        { targetId: "child", tabId: "tab-1", type: "iframe" },
      ],
    },
  });
  expect((result.data as { targetInfos: unknown[] }).targetInfos).toHaveLength(
    3,
  );
});

it("includes out-of-process frame descendants by native parent identity without admitting unrelated frames", async () => {
  const h = await setup();
  h.native.debugger.sendCommand.mockImplementation(async (method) => {
    if (method === "Page.getFrameTree")
      return {
        frameTree: { frame: { id: "main", url: "https://example.com/" } },
      };
    if (method === "Target.getTargets")
      return {
        targetInfos: [
          {
            targetId: "grandchild",
            parentFrameId: "child",
            type: "iframe",
            url: "https://nested.example/",
          },
          {
            targetId: "child",
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
          {
            targetId: "main",
            parentFrameId: "child",
            type: "iframe",
            url: "https://wrong.example/",
          },
          {
            targetId: "cycle-1",
            parentFrameId: "cycle-2",
            type: "iframe",
            url: "https://cycle.example/",
          },
          {
            targetId: "cycle-2",
            parentFrameId: "cycle-1",
            type: "iframe",
            url: "https://cycle.example/",
          },
        ],
      };
    return {};
  });
  const result = await h.execute("Target.getTargets");
  expect(result).toMatchObject({
    status: "completed",
    data: {
      targetInfos: [
        { targetId, type: "page" },
        { targetId: "grandchild", tabId: "tab-1", type: "iframe" },
        { targetId: "child", tabId: "tab-1", type: "iframe" },
      ],
    },
  });
  expect((result.data as { targetInfos: unknown[] }).targetInfos).toHaveLength(
    3,
  );
});

it("closes through the existing route owner, detaches and refuses subsequent commands", async () => {
  const h = await setup();
  await h.execute("Runtime.evaluate", { expression: "42" });
  const result = await h.execute("Target.closeTarget", { targetId });
  expect(result).toEqual({ status: "completed", data: { success: true } });
  expect(h.native.debugger.detach).toHaveBeenCalledOnce();
  expect(h.views.size).toBe(0);
  expect(h.events).toContainEqual({
    event: "browser-tab-closed",
    payload: expect.objectContaining({
      tabId: "tab-1",
      reason: "cdp-target-close",
    }),
  });
  await expect(
    h.host.executeTool(command("Target.getTargetInfo")),
  ).rejects.toThrow();
});

it("binds a Target close receipt to the original target identity", async () => {
  const h = await setup();
  const call = command("Target.closeTarget", { targetId });
  const pending = await h.host.executeTool(call);
  await expect(
    h.host.executeTool({
      ...call,
      phase: "approvedExecute",
      approvalToken: pending.approval!.approvalToken,
      arguments: {
        ...call.arguments,
        commandParams: { targetId: "browser-use-iab-tab:other" },
      },
    }),
  ).rejects.toThrow("identity mismatch");
  expect(h.views.size).toBe(1);
});

it("suppresses Target discovery when policy is revoked during native IO", async () => {
  const h = await setup();
  h.native.debugger.sendCommand.mockImplementation(async (method) => {
    if (method !== "Page.getFrameTree") return {};
    h.host.setSettings(
      effectiveBrowserSettings({ fullCdpAccessEnabled: false }),
    );
    return {
      frameTree: { frame: { id: "main", url: "https://example.com/" } },
    };
  });
  await expect(h.execute("Target.getTargets")).rejects.toThrow();
  expect(h.native.debugger.sendCommand).toHaveBeenCalledWith(
    "Page.getFrameTree",
    {},
  );
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalledWith(
    "Target.getTargets",
    {},
  );
  expect(h.views.size).toBe(1);
});
