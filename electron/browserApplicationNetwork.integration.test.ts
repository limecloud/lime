import { afterEach, expect, it, vi } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import { createHarness, mount } from "./browserTabHost.testHarness";
import type { BrowserToolCall } from "./browserTabHost";
import { connect } from "./browserNativePipeClient";
import type { NativePipeConnection } from "./browserNativePipeProtocol";

vi.mock("./browserNativePipeResources", () => ({
  browserNativePipeClientPath: () => "/fixture/browser-client.mjs",
}));
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const claim = (overrides: Partial<BrowserToolCall> = {}): BrowserToolCall => ({
  tool: "claimTab",
  arguments: {
    tabId: "tab-1",
    title: "Example",
    url: "https://example.com/",
    pageRevision: 0,
  },
  phase: "preflight",
  callId: "network-claim",
  ownerWebContentsId: 41,
  threadId: "thread-1",
  turnId: "turn-1",
  ...overrides,
});

function networkChanged(h: ReturnType<typeof createHarness>) {
  h.embeddedHost.setNetworkRequirementsChangedHandler.mock.calls[0][0]!();
}

it("network authority changes invalidate pending browse approval before native control", async () => {
  const h = createHarness();
  h.host.setSettings(effectiveBrowserSettings());
  const state = (await mount(h)) as { viewId: string };
  const pending = await h.host.executeTool(claim());
  expect(pending.status).toBe("approval_required");
  networkChanged(h);
  await expect(
    h.host.executeTool(
      claim({
        phase: "approvedExecute",
        approvalToken: pending.approval?.approvalToken,
      }),
    ),
  ).rejects.toThrow();
  expect(
    h.views.get(state.viewId)!.webContents.debugger.attach,
  ).not.toHaveBeenCalled();
});

it("network authority changes detach active CDP and require fresh browse approval without physical takeover", async () => {
  const h = createHarness();
  h.host.setSettings(effectiveBrowserSettings());
  const interrupt = vi.fn(async () => {});
  h.host.setTurnInterruptHandler(interrupt);
  const state = (await mount(h)) as { viewId: string };
  const granted = await h.host.executeTool(claim());
  await h.host.executeTool(
    claim({
      phase: "approvedExecute",
      approvalToken: granted.approval?.approvalToken,
    }),
  );
  await h.host.executeTool({
    ...claim(),
    tool: "observe",
    arguments: { tabId: "tab-1" },
  });
  const native = h.views.get(state.viewId)!;
  expect(native.webContents.debugger.attach).toHaveBeenCalled();
  networkChanged(h);
  expect(native.webContents.debugger.detach).toHaveBeenCalled();
  expect(h.embeddedHost.revokePermissionGrants).toHaveBeenCalled();
  expect(h.views.has(state.viewId)).toBe(true);
  expect(interrupt).not.toHaveBeenCalled();
  const next = await h.host.executeTool({
    ...claim(),
    tool: "observe",
    arguments: { tabId: "tab-1" },
  });
  expect(next.status).toBe("approval_required");
});

it("network authority changes invalidate pending independent CDP approval", async () => {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings({
      approvalMode: "neverAsk",
      fullCdpAccessEnabled: true,
    }),
  );
  const state = (await mount(h)) as { viewId: string };
  await h.host.executeTool(claim());
  const call = {
    ...claim(),
    tool: "executeCdpCommand",
    arguments: {
      tabId: "tab-1",
      method: "Runtime.evaluate",
      commandParams: { expression: "'secret'" },
    },
  };
  const pending = await h.host.executeTool(call);
  expect(pending.status).toBe("approval_required");
  networkChanged(h);
  const send = h.views.get(state.viewId)!.webContents.debugger.sendCommand;
  send.mockClear();
  await expect(
    h.host.executeTool({
      ...call,
      phase: "approvedExecute",
      approvalToken: pending.approval?.approvalToken,
    }),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it("network authority changes close the persistent event client and reject its old capability", async () => {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings({
      approvalMode: "neverAsk",
      fullCdpAccessEnabled: true,
    }),
  );
  const state = (await mount(h)) as { viewId: string };
  cleanup.push(() => h.host.connectionLost());
  await h.host.executeTool(claim());
  const native = h.views.get(state.viewId)!.webContents;
  const original = native.debugger.sendCommand.getMockImplementation()!;
  native.debugger.sendCommand.mockImplementation(async (method, ...args) =>
    method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "root", url: "https://example.com/" } } }
      : original(method, ...args),
  );
  const call = {
    ...claim(),
    tool: "addCdpEventListener",
    arguments: { tabId: "tab-1" },
  };
  const pending = await h.host.executeTool(call);
  expect(pending.status).toBe("approval_required");
  const subscribed = await h.host.executeTool({
    ...call,
    phase: "approvedExecute",
    approvalToken: pending.approval?.approvalToken,
  });
  expect(subscribed.status).toBe("completed");
  const connection = subscribed.data as NativePipeConnection;
  const peer = await connect(connection);
  cleanup.push(() => peer.dispose());
  const detached = vi.fn();
  peer.addCdpDetachListener(detached);
  networkChanged(h);
  await peer.closed;
  expect(detached).toHaveBeenCalledExactlyOnceWith({ tabId: "tab-1" });
  await expect(connect(connection)).rejects.toThrow();
  expect(native.debugger.isAttached()).toBe(false);
});

it("network authority changes suppress a late native CDP result even with automatic browsing allowed", async () => {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings({
      approvalMode: "neverAsk",
      fullCdpAccessEnabled: true,
    }),
  );
  const state = (await mount(h)) as { viewId: string };
  await h.host.executeTool(claim());
  const native = h.views.get(state.viewId)!.webContents;
  const original = native.debugger.sendCommand.getMockImplementation()!;
  let finish!: (value: Record<string, unknown>) => void;
  native.debugger.sendCommand.mockImplementation((method, ...args) =>
    method === "Runtime.evaluate"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(method, ...args),
  );
  const call = {
    ...claim(),
    tool: "executeCdpCommand",
    arguments: {
      tabId: "tab-1",
      method: "Runtime.evaluate",
      commandParams: { expression: "'secret'" },
    },
  };
  const pending = await h.host.executeTool(call);
  const running = h.host.executeTool({
    ...call,
    phase: "approvedExecute",
    approvalToken: pending.approval?.approvalToken,
  });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  networkChanged(h);
  finish({ result: { value: "late native secret" } });
  await expect(running).rejects.toThrow(/changed|stale|unavailable/);
});

it.each([
  ["observe", "Accessibility.getFullAXTree"],
  ["screenshot", "Page.captureScreenshot"],
])(
  "network authority changes suppress a late %s result",
  async (tool, method) => {
    const h = createHarness();
    const state = (await mount(h)) as { viewId: string };
    await h.host.executeTool(claim());
    const native = h.views.get(state.viewId)!.webContents;
    const original = native.debugger.sendCommand.getMockImplementation()!;
    let finish!: () => void;
    native.debugger.sendCommand.mockImplementation(async (command, ...args) => {
      const result = await original(command, ...args);
      if (command !== method) return result;
      return new Promise((resolve) => {
        finish = () => resolve(result);
      });
    });
    const running = h.host.executeTool({
      ...claim(),
      tool,
      arguments: { tabId: "tab-1" },
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    networkChanged(h);
    finish();
    await expect(running).rejects.toThrow(/changed|stale|unavailable|attached/);
  },
);
