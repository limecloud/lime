import { describe, expect, it } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import type { BrowserToolCall, BrowserToolResult } from "./browserTabHost";
import { createHarness, mount } from "./browserTabHost.testHarness";

function call(
  tool: string,
  argumentsValue: Record<string, unknown> = {},
  overrides: Partial<BrowserToolCall> = {},
): BrowserToolCall {
  return {
    tool,
    arguments: argumentsValue,
    callId: `${tool}-1`,
    ownerWebContentsId: 41,
    threadId: "thread-1",
    turnId: "turn-1",
    phase: "preflight",
    ...overrides,
  };
}
const claim = (revision = 0, overrides: Partial<BrowserToolCall> = {}) =>
  call(
    "claimTab",
    {
      tabId: "tab-1",
      title: "Example",
      url: "https://example.com/",
      pageRevision: revision,
    },
    overrides,
  );
function approved(
  original: BrowserToolCall,
  result: BrowserToolResult,
): BrowserToolCall {
  expect(result.status).toBe("approval_required");
  return {
    ...original,
    phase: "approvedExecute",
    approvalToken: result.approval?.approvalToken,
  };
}
async function askHarness() {
  const h = createHarness();
  h.host.setSettings(
    effectiveBrowserSettings({}, null, {
      browserUse: { defaultOriginPolicy: { accessApprovalLifetime: "turn" } },
    }),
  );
  const state = (await mount(h)) as { viewId: string };
  return { ...h, native: h.views.get(state.viewId)! };
}
async function claimApproved(h: Awaited<ReturnType<typeof askHarness>>) {
  const permission = await h.host.executeTool(claim());
  return h.host.executeTool(approved(claim(), permission));
}

describe("turn-scoped browser browsing approvals", () => {
  it("keeps claim and page reads inert until the canonical browse stage is approved", async () => {
    const h = await askHarness();
    const result = await h.host.executeTool(claim());
    expect(result).toMatchObject({
      status: "approval_required",
      state: { controlOwner: "user", activeTurnId: null },
      approval: {
        actionKind: "browse",
        reason: expect.stringContaining("https://example.com"),
        riskClass: "browse",
        webContentsId: h.native.webContents.id,
      },
    });
    expect(result.approval?.reason).toContain("this turn");
    expect(result.approval?.reason).not.toContain("turn-1");
    expect(h.native.webContents.debugger.attach).not.toHaveBeenCalled();
    expect(h.native.webContents.debugger.sendCommand).not.toHaveBeenCalled();
    await expect(
      h.host.executeTool(call("screenshot", { tabId: "tab-1" })),
    ).rejects.toThrow("claimed");
    const metadata = await h.host.executeTool(call("openTabs"));
    expect(metadata.data).toMatchObject([
      { tabId: "tab-1", url: "https://example.com/" },
    ]);
    const claimed = await h.host.executeTool(approved(claim(), result));
    expect(claimed.state?.controlOwner).toBe("agent");
    expect(h.native.webContents.debugger.attach).not.toHaveBeenCalled();
    expect(
      (await h.host.executeTool(call("observe", { tabId: "tab-1" }))).status,
    ).toBe("completed");
    expect(
      (await h.host.executeTool(call("screenshot", { tabId: "tab-1" })))
        .imageBase64,
    ).toBe("cGl4ZWxz");
    await expect(h.host.executeTool(approved(claim(), result))).rejects.toThrow(
      "token is stale or invalid",
    );
  });

  it("authorizes newTab against the selected canonical route before creating or navigating a guest", async () => {
    const h = await askHarness();
    const open = call("newTab", { url: "https://target.example:8443/path" });
    const result = await h.host.executeTool(open);
    expect(result.approval).toMatchObject({
      tabId: "tab-1",
      viewId: h.native.viewId,
      webContentsId: h.native.webContents.id,
      reason: expect.stringContaining("https://target.example:8443"),
    });
    expect(h.views.size).toBe(1);
    expect(
      h.embeddedHost.invoke.mock.calls.filter(
        ([, command]) => command === "embedded_browser_view_mount",
      ),
    ).toHaveLength(1);
    const created = await h.host.executeTool(approved(open, result));
    expect(created.state).toMatchObject({
      tabId: "newTab-1",
      origin: "agent",
      controlOwner: "agent",
      url: open.arguments.url,
    });
    expect(h.views.size).toBe(2);
    expect(h.native.webContents.debugger.attach).not.toHaveBeenCalled();
  });

  it("checks both current and destination origins for goto with fresh tokens and no early navigation", async () => {
    const h = await askHarness();
    await claimApproved(h);
    h.host.setSettings({ ...effectiveBrowserSettings(), show_full_url: true });
    const goto = call("goto", {
      tabId: "tab-1",
      url: "https://target.example:8443/path",
    });
    const source = await h.host.executeTool(goto);
    expect(source.approval?.reason).toContain("https://example.com");
    const destination = await h.host.executeTool(approved(goto, source));
    expect(destination.approval?.reason).toContain(
      "https://target.example:8443",
    );
    expect(destination.approval?.approvalToken).not.toBe(
      source.approval?.approvalToken,
    );
    expect(h.native.webContents.debugger.sendCommand).not.toHaveBeenCalled();
    const loaded = await h.host.executeTool(approved(goto, destination));
    expect(loaded).toMatchObject({
      status: "completed",
      state: { url: "https://target.example:8443/path" },
    });
    expect(h.native.webContents.debugger.sendCommand).toHaveBeenCalledWith(
      "Page.navigate",
      { url: goto.arguments.url },
    );
  });

  it("requires a separate dangerous-action stage after browsing approval on the same call", async () => {
    const h = await askHarness();
    await claimApproved(h);
    const observation = await h.host.executeTool(
      call("observe", { tabId: "tab-1" }),
    );
    h.native.webContents.nodeAttributes = ["aria-label", "Delete account"];
    h.host.setSettings({ ...effectiveBrowserSettings(), show_full_url: true });
    h.native.webContents.debugger.sendCommand.mockClear();
    const click = call("click", {
      tabId: "tab-1",
      snapshotId: (observation.data as { snapshotId: string }).snapshotId,
      backendNodeId: 11,
    });
    const browse = await h.host.executeTool(click);
    expect(browse.approval?.actionKind).toBe("browse");
    expect(h.native.webContents.debugger.sendCommand).not.toHaveBeenCalled();
    const action = await h.host.executeTool(approved(click, browse));
    expect(action.approval).toMatchObject({
      actionKind: "click",
      riskClass: "high_impact_click",
    });
    expect(action.approval?.approvalToken).not.toBe(
      browse.approval?.approvalToken,
    );
    expect(
      h.native.webContents.debugger.sendCommand.mock.calls.some(
        ([method]) => method === "Input.dispatchMouseEvent",
      ),
    ).toBe(false);
    await expect(h.host.executeTool(approved(click, browse))).rejects.toThrow(
      "token is stale or invalid",
    );
    expect((await h.host.executeTool(approved(click, action))).status).toBe(
      "completed",
    );
    expect(
      h.native.webContents.debugger.sendCommand.mock.calls.filter(
        ([method]) => method === "Input.dispatchMouseEvent",
      ),
    ).toHaveLength(2);
  });

  it.each([
    "settings",
    "takeover",
    "release",
    "turn",
    "disconnect",
    "destroy",
  ] as const)("revokes temporary origin grants on %s", async (lifecycle) => {
    const h = await askHarness();
    await claimApproved(h);
    let revision = 0;
    let turnId = "turn-1";
    if (lifecycle === "settings")
      h.host.setSettings({
        ...effectiveBrowserSettings(),
        show_full_url: true,
      });
    if (lifecycle === "takeover") {
      h.native.webContents.emit(
        "before-input-event",
        {},
        { type: "keyDown", key: "a" },
      );
      revision = 1;
    }
    if (lifecycle === "release") {
      await h.host.executeTool(call("releaseTab", { tabId: "tab-1" }));
      revision = 1;
    }
    if (lifecycle === "turn") {
      h.host.turnEnded("thread-1", "turn-1");
      turnId = "turn-2";
    }
    if (lifecycle === "disconnect") {
      h.host.connectionLost();
      turnId = "turn-2";
    }
    if (lifecycle === "destroy") {
      await h.host.invoke(h.window as never, "browser_tab_close", {
        tabId: "tab-1",
      });
      await mount(h);
    }
    const retry =
      lifecycle === "settings"
        ? call("observe", { tabId: "tab-1" })
        : claim(revision, { turnId, callId: `claim-${lifecycle}` });
    expect(await h.host.executeTool(retry)).toMatchObject({
      status: "approval_required",
      approval: { actionKind: "browse" },
    });
  });

  it("allows release when settings are disabled and the provider is unavailable", async () => {
    const h = await askHarness();
    await claimApproved(h);
    h.host.setSettings({ ...effectiveBrowserSettings(), enabled: false });
    h.host.setSettingsProvider(async () => {
      throw new Error("unavailable");
    });
    expect(
      await h.host.executeTool(call("releaseTab", { tabId: "tab-1" })),
    ).toMatchObject({
      status: "completed",
      state: { controlOwner: "released", activeTurnId: null },
    });
  });

  it.each(["observe", "screenshot"] as const)(
    "discards in-flight %s content when browsing access is revoked",
    async (tool) => {
      const h = await askHarness();
      await claimApproved(h);
      const original =
        h.native.webContents.debugger.sendCommand.getMockImplementation()!;
      let entered!: () => void;
      let finish!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const contentCommand =
        tool === "observe"
          ? "Accessibility.getFullAXTree"
          : "Page.captureScreenshot";
      h.native.webContents.debugger.sendCommand.mockImplementation(
        async (method, params) => {
          if (method === contentCommand) {
            entered();
            await released;
          }
          return original(method, params);
        },
      );
      const reading = h.host.executeTool(call(tool, { tabId: "tab-1" }));
      const rejected = expect(reading).rejects.toThrow(
        "browsing grant is unavailable",
      );
      await started;
      h.host.setSettings({
        ...effectiveBrowserSettings(),
        show_full_url: true,
      });
      finish();
      await rejected;
    },
  );

  it("rejects changed approval arguments and discards a claim pending when the human interacts", async () => {
    const h = await askHarness();
    const first = await h.host.executeTool(claim());
    await expect(
      h.host.executeTool({
        ...approved(claim(), first),
        arguments: { ...claim().arguments, url: "https://other.example/" },
      }),
    ).rejects.toThrow("identity or page revision mismatch");
    const retry = claim(0, { callId: "claim-retry" });
    const second = await h.host.executeTool(retry);
    h.native.webContents.emit(
      "before-input-event",
      {},
      { type: "keyDown", key: "a" },
    );
    await expect(h.host.executeTool(approved(retry, second))).rejects.toThrow(
      "token is stale or invalid",
    );
    expect(h.native.webContents.debugger.attach).not.toHaveBeenCalled();
  });

  it("applies exact origin grants to native main-frame navigation and leaves human browsing available", async () => {
    const h = await askHarness();
    await claimApproved(h);
    const allows = h.embeddedHost.setAgentPermissionResolver.mock.calls[0][0];
    expect(allows(h.native.viewId, "https://example.com/next", "browse")).toBe(
      true,
    );
    for (const url of [
      "http://example.com/",
      "https://example.com:8443/",
      "https://other.example/",
    ])
      expect(allows(h.native.viewId, url, "browse")).toBe(false);
    await h.host.executeTool(call("releaseTab", { tabId: "tab-1" }));
    expect(allows(h.native.viewId, "https://other.example/", "browse")).toBe(
      true,
    );
  });
});
