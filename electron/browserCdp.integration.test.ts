import { expect, it } from "vitest";
import { createHarness, mount } from "./browserTabHost.testHarness";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import type { BrowserToolCall } from "./browserTabHost";

const command = (args: Record<string, unknown> = {}): BrowserToolCall => ({
  arguments: {
    method: "Runtime.evaluate",
    commandParams: { expression: "6 * 7" },
    tabId: "tab-1",
    ...args,
  },
  callId: "cdp-1",
  ownerWebContentsId: 41,
  phase: "preflight",
  threadId: "thread-1",
  tool: "executeCdpCommand",
  turnId: "turn-1",
});

async function setup(fullCdpAccessEnabled = true) {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings({
      approvalMode: "neverAsk",
      fullCdpAccessEnabled,
    }),
  );
  const state = (await mount(h)) as { viewId: string };
  await h.host.executeTool({
    ...command(),
    tool: "claimTab",
    arguments: {
      tabId: "tab-1",
      title: "Example",
      url: "https://example.com/",
      pageRevision: 0,
    },
  });
  return { ...h, native: h.views.get(state.viewId)!.webContents };
}

it("default-off and administrator debug denial never attach the debugger", async () => {
  const h = await setup(false);
  await expect(h.host.executeTool(command())).rejects.toThrow(
    "CDP access is denied",
  );
  h.host.setSettings(
    effectiveBrowserSettings(
      { approvalMode: "neverAsk", fullCdpAccessEnabled: true },
      null,
      {
        browserUse: { origins: { "example.com": { fullCdpAccess: "deny" } } },
      },
    ),
  );
  await expect(h.host.executeTool(command())).rejects.toThrow(
    "CDP access is denied",
  );
  expect(h.native.debugger.attach).not.toHaveBeenCalled();
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalled();
});

it("uses the existing one-use action receipt and refuses changed command parameters", async () => {
  const h = await setup();
  const pending = await h.host.executeTool(command());
  expect(pending).toMatchObject({
    status: "approval_required",
    approval: { actionKind: "executeCdpCommand", riskClass: "full_cdp" },
  });
  expect(h.native.debugger.attach).not.toHaveBeenCalled();
  const approved: BrowserToolCall = {
    ...command(),
    phase: "approvedExecute",
    approvalToken: pending.approval!.approvalToken,
  };
  const result = await h.host.executeTool(approved);
  expect(result).toMatchObject({
    status: "completed",
    state: { activeTurnId: "turn-1", controlOwner: "agent", tabId: "tab-1" },
  });
  expect(h.native.debugger.sendCommand).toHaveBeenCalledWith(
    "Runtime.evaluate",
    { expression: "6 * 7" },
  );
  await expect(h.host.executeTool(approved)).rejects.toThrow(
    "stale or invalid",
  );
  const fresh = await h.host.executeTool({ ...command(), callId: "cdp-2" });
  await expect(
    h.host.executeTool({
      ...approved,
      callId: "cdp-2",
      approvalToken: fresh.approval!.approvalToken,
      arguments: {
        ...command().arguments,
        commandParams: { expression: "changed" },
      },
    }),
  ).rejects.toThrow("identity mismatch");
  expect(
    h.native.debugger.sendCommand.mock.calls.filter(
      ([method]) => method === "Runtime.evaluate",
    ),
  ).toHaveLength(1);
});

it("revokes the pending command when a managed requirement changes", async () => {
  const h = await setup();
  const pending = await h.host.executeTool(command());
  h.host.setSettings(
    effectiveBrowserSettings(
      { approvalMode: "neverAsk", fullCdpAccessEnabled: true },
      null,
      {
        browserUse: { origins: { "example.com": { fullCdpAccess: "deny" } } },
      },
    ),
  );
  await expect(
    h.host.executeTool({
      ...command(),
      phase: "approvedExecute",
      approvalToken: pending.approval!.approvalToken,
    }),
  ).rejects.toThrow();
  expect(h.native.debugger.sendCommand).not.toHaveBeenCalled();
});
