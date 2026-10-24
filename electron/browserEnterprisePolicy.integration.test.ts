import { expect, it, vi } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import { createHarness, mount } from "./browserTabHost.testHarness";
import type { BrowserToolCall } from "./browserTabHost";
import type { BrowserHistoryHost } from "./browserHistoryHost";

const call = (
  tool: string,
  args: Record<string, unknown> = {},
  overrides: Partial<BrowserToolCall> = {},
): BrowserToolCall => ({
  tool,
  arguments: args,
  phase: "preflight",
  callId: `${tool}-enterprise`,
  ownerWebContentsId: 41,
  threadId: "thread-1",
  turnId: "turn-1",
  ...overrides,
});
const claim = () =>
  call("claimTab", {
    tabId: "tab-1",
    title: "Example",
    url: "https://example.com/",
    pageRevision: 0,
  });

it("a requirements-only change revokes a pending browse receipt without acquiring native control", async () => {
  const h = createHarness();
  h.host.setSettings(effectiveBrowserSettings());
  const state = (await mount(h)) as { viewId: string };
  const pending = await h.host.executeTool(claim());
  expect(pending.status).toBe("approval_required");
  h.host.setSettings(
    effectiveBrowserSettings({}, null, {
      browserUse: { origins: { "example.com": { access: "deny" } } },
    }),
  );
  await expect(
    h.host.executeTool({
      ...claim(),
      phase: "approvedExecute",
      approvalToken: pending.approval?.approvalToken,
    }),
  ).rejects.toThrow();
  const native = h.views.get(state.viewId)!;
  expect(native.webContents.debugger.attach).not.toHaveBeenCalled();
  expect(native.webContents.debugger.sendCommand).not.toHaveBeenCalled();
});

it("administrator shutdown releases an active controller and detaches its debugger while retaining the user page", async () => {
  const h = createHarness();
  const state = (await mount(h)) as { viewId: string };
  await h.host.executeTool(claim());
  await h.host.executeTool(call("observe", { tabId: "tab-1" }));
  const native = h.views.get(state.viewId)!;
  expect(native.webContents.debugger.attach).toHaveBeenCalled();
  h.host.setSettings(
    effectiveBrowserSettings({ approvalMode: "neverAsk" }, null, {
      allowBrowserAndComputerUse: false,
    }),
  );
  expect(native.webContents.debugger.detach).toHaveBeenCalled();
  expect(h.views.has(state.viewId)).toBe(true);
  await expect(
    h.host.executeTool(call("observe", { tabId: "tab-1" })),
  ).rejects.toThrow("disabled");
});

it("an administrator history revocation during disk IO suppresses the entire read result", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const h = createHarness({
    history: { invoke, forget: vi.fn() } as unknown as BrowserHistoryHost,
  });
  h.host.setSettings(
    effectiveBrowserSettings({ iabHistoryApprovalMode: "neverAsk" }),
  );
  await mount(h);
  const reading = h.host.executeTool(
    call("history", { query: "private history" }),
  );
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  h.host.setSettings(
    effectiveBrowserSettings({ iabHistoryApprovalMode: "neverAsk" }, null, {
      browserUse: { allowHistoryAccess: false },
    }),
  );
  resolve({ entries: [], total: 0, nextCursor: null, revision: 1 });
  await expect(reading).rejects.toThrow("history access is disabled");
});

it("managed upload denial blocks execution before native commands", async () => {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings(
      { approvalMode: "neverAsk", fullCdpAccessEnabled: true },
      null,
      {
        browserUse: {
          defaultOriginPolicy: { uploads: "deny", fullCdpAccess: "deny" },
        },
      },
    ),
  );
  const state = (await mount(h)) as { viewId: string };
  await h.host.executeTool(claim());
  const native = h.views.get(state.viewId)!;
  await expect(
    h.host.executeTool(call("uploadArtifact", { tabId: "tab-1" })),
  ).rejects.toThrow("uploads are denied");
  expect(native.webContents.debugger.sendCommand).not.toHaveBeenCalled();
});
