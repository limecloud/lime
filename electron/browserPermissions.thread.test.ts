import { expect, it } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import {
  BrowserPermissions,
  type BrowserPermissionAnchor,
} from "./browserPermissions";
import { BrowserTabPolicy } from "./browserTabPolicy";
import type { BrowserToolCall, BrowserToolResult } from "./browserTabHost";
import { createHarness, mount } from "./browserTabHost.testHarness";

const anchor: BrowserPermissionAnchor = {
  ownerWebContentsId: 41,
  windowId: 7,
  threadId: "thread-1",
  browserSessionId: "session-1",
  turnId: "turn-1",
  tabId: "tab-1",
  viewId: "view-1",
  webContentsId: 51,
  pageRevision: 0,
};
const call = (
  tool = "claimTab",
  overrides: Partial<BrowserToolCall> = {},
): BrowserToolCall => ({
  tool,
  arguments: {
    tabId: "tab-1",
    title: "Example",
    url: "https://example.com/",
    pageRevision: 0,
  },
  ownerWebContentsId: 41,
  threadId: "thread-1",
  turnId: "turn-1",
  callId: "thread-claim-1",
  phase: "preflight",
  ...overrides,
});
const approved = (
  original: BrowserToolCall,
  stage: BrowserToolResult,
): BrowserToolCall => ({
  ...original,
  phase: "approvedExecute",
  approvalToken: stage.approval!.approvalToken,
});
const settings = (lifetime: "turn" | "thread" = "thread") =>
  effectiveBrowserSettings(
    { approvalMode: "neverAsk", allowedOrigins: ["example.com"] },
    null,
    {
      browserUse: { defaultOriginPolicy: { accessApprovalLifetime: lifetime } },
    },
  );
function permissions() {
  const policy = new BrowserTabPolicy();
  policy.setSettings(settings());
  return { policy, permissions: new BrowserPermissions(policy) };
}

it("a thread receipt requires approval, survives the issuing turn and stays within its canonical owner and exact origin", () => {
  const { permissions: p } = permissions();
  const stage = p.require(call(), anchor, "https://example.com:8443/path")!;
  expect(stage.status).toBe("approval_required");
  expect(p.allows(anchor, "https://example.com:8443/")).toBe(false);
  p.consume(approved(call(), stage), anchor);
  p.turnEnded("thread-1", "turn-1");
  expect(
    p.allows({ ...anchor, turnId: "turn-2" }, "https://example.com:8443/next"),
  ).toBe(true);
  for (const changed of [
    { ownerWebContentsId: 42 },
    { windowId: 8 },
    { threadId: "thread-2" },
    { browserSessionId: "session-2" },
  ])
    expect(
      p.allows(
        { ...anchor, turnId: "turn-2", ...changed },
        "https://example.com:8443/",
      ),
    ).toBe(false);
  for (const url of [
    "https://example.com/",
    "http://example.com:8443/",
    "https://sub.example.com:8443/",
  ])
    expect(p.allows({ ...anchor, turnId: "turn-2" }, url)).toBe(false);
});

it("uses the reference thread lifetime when no administrator override exists", () => {
  const p = new BrowserPermissions(new BrowserTabPolicy());
  const stage = p.require(call(), anchor, "https://example.com/")!;
  p.consume(approved(call(), stage), anchor);
  p.turnEnded("thread-1", "turn-1");
  expect(
    p.allows({ ...anchor, turnId: "turn-2" }, "https://example.com/"),
  ).toBe(true);
});

it("thread lifetime never makes a pending token valid for a different turn", () => {
  const { permissions: p } = permissions();
  const first = p.require(call(), anchor, "https://example.com/")!;
  expect(() =>
    p.consume(approved(call(), first), { ...anchor, turnId: "turn-2" }),
  ).toThrow("identity or page revision");
  expect(p.allows(anchor, "https://example.com/")).toBe(false);
  const second = p.require(call(), anchor, "https://example.com/")!;
  p.turnEnded("thread-1", "turn-1");
  expect(p.pending()).toEqual([]);
  expect(p.consume(approved(call(), second), anchor)).toBe(false);
});

it("a policy revision invalidates issued receipts and pending approvals even without Host cleanup", () => {
  const { policy, permissions: p } = permissions();
  const first = p.require(call(), anchor, "https://example.com/")!;
  p.consume(approved(call(), first), anchor);
  const pendingCall = call("claimTab", { callId: "other-origin" });
  const pending = p.require(pendingCall, anchor, "https://other.example/")!;
  policy.setSettings(settings("turn"));
  expect(p.allows(anchor, "https://example.com/")).toBe(false);
  expect(() => p.consume(approved(pendingCall, pending), anchor)).toThrow(
    "identity or page revision",
  );
});

it.each([
  ["zh-CN", "此会话"],
  ["zh-TW", "此對話"],
  ["en-US", "this conversation"],
  ["ja-JP", "この会話"],
  ["ko-KR", "이 대화"],
])("shows the thread scope in the %s approval reason", (locale, text) => {
  const { permissions: p } = permissions();
  p.setLocale(locale);
  expect(
    p.require(call(), anchor, "https://example.com/")!.approval!.reason,
  ).toContain(text);
});

it.each([
  ["zh-CN", "此回合"],
  ["zh-TW", "此回合"],
  ["en-US", "this turn"],
  ["ja-JP", "このターン"],
  ["ko-KR", "이 턴"],
])("shows a managed turn scope in the %s approval reason", (locale, text) => {
  const policy = new BrowserTabPolicy();
  policy.setSettings(settings("turn"));
  const p = new BrowserPermissions(policy);
  p.setLocale(locale);
  const stage = p.require(call(), anchor, "https://example.com:8443/path")!;
  expect(stage.approval!.reason).toContain(text);
  expect(stage.approval!.reason).toContain("https://example.com:8443");
  expect(stage.approval!.reason).not.toContain("turn-1");
  expect(p.pending()[0].accessApprovalLifetime).toBe("turn");
});

it("a retained native tab releases control at turn end while its thread receipt can authorize a fresh claim", async () => {
  const h = createHarness();
  h.host.setSettings(settings());
  const state = (await mount(h)) as { viewId: string };
  const native = h.views.get(state.viewId)!;
  await h.host.executeTool(approved(call(), await h.host.executeTool(call())));
  await h.host.executeTool(
    call("observe", { callId: "read", arguments: { tabId: "tab-1" } }),
  );
  h.host.turnEnded("thread-1", "turn-1");
  expect(native.webContents.debugger.detach).toHaveBeenCalled();
  const second = call("claimTab", {
    turnId: "turn-2",
    callId: "thread-claim-2",
  });
  await expect(
    h.host.executeTool(
      call("observe", { turnId: "turn-2", arguments: { tabId: "tab-1" } }),
    ),
  ).rejects.toThrow("claimed");
  expect(await h.host.executeTool(second)).toMatchObject({
    status: "completed",
    state: { activeTurnId: "turn-2", controlOwner: "agent" },
  });
});

it.each(["settings", "takeover", "disconnect", "close"] as const)(
  "revokes thread receipts on %s",
  async (lifecycle) => {
    const h = createHarness();
    h.host.setSettings(settings());
    const state = (await mount(h)) as { viewId: string };
    await h.host.executeTool(
      approved(call(), await h.host.executeTool(call())),
    );
    if (lifecycle === "settings")
      h.host.setSettings({ ...settings(), show_full_url: true });
    if (lifecycle === "takeover")
      h.views
        .get(state.viewId)!
        .webContents.emit(
          "before-input-event",
          {},
          { type: "keyDown", key: "a" },
        );
    if (lifecycle === "disconnect") h.host.connectionLost();
    if (lifecycle === "close") {
      await h.host.invoke(h.window as never, "browser_tab_close", {
        tabId: "tab-1",
      });
      await mount(h);
    }
    const retry =
      lifecycle === "settings"
        ? call("observe", { arguments: { tabId: "tab-1" }, callId: "retry" })
        : call("claimTab", {
            turnId: lifecycle === "disconnect" ? "turn-2" : "turn-1",
            callId: "retry",
            arguments: {
              ...call().arguments,
              pageRevision: lifecycle === "takeover" ? 1 : 0,
            },
          });
    expect(await h.host.executeTool(retry)).toMatchObject({
      status: "approval_required",
    });
  },
);

it("turn-end cleanup of an ephemeral Agent tab preserves the thread's approved destination", async () => {
  const h = createHarness();
  h.host.setSettings(settings());
  await mount(h);
  await h.host.executeTool(approved(call(), await h.host.executeTool(call())));
  const open = call("newTab", {
    arguments: { url: "https://other.example/path" },
    callId: "new-agent-1",
  });
  await h.host.executeTool(approved(open, await h.host.executeTool(open)));
  expect(h.views.size).toBe(2);
  h.host.turnEnded("thread-1", "turn-1");
  expect(h.views.size).toBe(1);
  const again = { ...open, callId: "new-agent-2", turnId: "turn-2" };
  expect(await h.host.executeTool(again)).toMatchObject({
    status: "completed",
    state: { tabId: "new-agent-2", activeTurnId: "turn-2" },
  });
});
