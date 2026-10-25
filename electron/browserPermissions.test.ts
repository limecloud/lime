import { describe, expect, it } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import {
  BrowserPermissions,
  browserPermissionOrigin,
  type BrowserPermissionAnchor,
} from "./browserPermissions";
import { BrowserTabPolicy } from "./browserTabPolicy";
import type { BrowserToolCall } from "./browserTabHost";

const anchor: BrowserPermissionAnchor = {
  ownerWebContentsId: 41,
  windowId: 7,
  threadId: "thread-1",
  browserSessionId: "session-1",
  turnId: "turn-1",
  tabId: "tab-1",
  viewId: "view-1",
  webContentsId: 51,
  pageRevision: 3,
};
const call: BrowserToolCall = {
  tool: "observe",
  phase: "preflight",
  callId: "call-1",
  ownerWebContentsId: 41,
  threadId: "thread-1",
  turnId: "turn-1",
  arguments: { tabId: "tab-1" },
};

describe("browser permission origin and policy owner", () => {
  it("preserves tri-state decisions and makes explicit site rules override defaults", () => {
    const policy = new BrowserTabPolicy();
    policy.setSettings(
      effectiveBrowserSettings(
        {
          allowedOrigins: ["https://allowed.example:8443"],
        },
        {
          origins: {
            "https://allowed.example:8443": { access: "allow" },
            "blocked.example": { access: "deny" },
          },
        },
      ),
    );
    expect(policy.decision("browse", "https://default.example/")).toBe("ask");
    expect(policy.allows("browse", "https://default.example/")).toBe(false);
    expect(policy.decision("browse", "https://allowed.example:8443/path")).toBe(
      "allow",
    );
    expect(policy.decision("browse", "https://allowed.example/path")).toBe(
      "ask",
    );
    expect(policy.decision("browse", "https://blocked.example/")).toBe("deny");
    expect(policy.decision("debug", "https://allowed.example:8443/")).toBe(
      "deny",
    );
  });

  it("normalizes default ports and rejects opaque schemes and URL credentials", () => {
    expect(
      browserPermissionOrigin("https://EXAMPLE.com:443/path?q=1#fragment"),
    ).toBe("https://example.com");
    expect(browserPermissionOrigin("http://example.com:8443/path")).toBe(
      "http://example.com:8443",
    );
    for (const value of [
      "about:blank",
      "data:text/plain,content",
      "https://user:pass@example.com",
      "invalid",
    ])
      expect(() => browserPermissionOrigin(value)).toThrow("HTTP(S) origin");
  });

  it("binds grants to every owner/session/turn field and exact protocol plus port", () => {
    const policy = new BrowserTabPolicy();
    policy.setSettings(
      effectiveBrowserSettings({}, null, {
        browserUse: { defaultOriginPolicy: { accessApprovalLifetime: "turn" } },
      }),
    );
    const permissions = new BrowserPermissions(policy);
    const stage = permissions.require(
      call,
      anchor,
      "https://example.com:8443/path",
    )!;
    permissions.consume(
      {
        ...call,
        phase: "approvedExecute",
        approvalToken: stage.approval?.approvalToken,
      },
      anchor,
    );
    expect(permissions.allows(anchor, "https://example.com:8443/next")).toBe(
      true,
    );
    for (const changed of [
      { ownerWebContentsId: 42 },
      { windowId: 8 },
      { threadId: "thread-2" },
      { browserSessionId: "session-2" },
      { turnId: "turn-2" },
    ])
      expect(
        permissions.allows(
          { ...anchor, ...changed },
          "https://example.com:8443/",
        ),
      ).toBe(false);
    for (const value of [
      "https://example.com/",
      "http://example.com:8443/",
      "https://sub.example.com:8443/",
    ])
      expect(permissions.allows(anchor, value)).toBe(false);
  });

  it.each(["pageRevision", "webContentsId", "windowId"] as const)(
    "rejects approvals whose %s changed",
    (key) => {
      const permissions = new BrowserPermissions(new BrowserTabPolicy());
      const stage = permissions.require(call, anchor, "https://example.com/")!;
      expect(() =>
        permissions.consume(
          {
            ...call,
            phase: "approvedExecute",
            approvalToken: stage.approval?.approvalToken,
          },
          { ...anchor, [key]: anchor[key] + 1 },
        ),
      ).toThrow("identity or page revision mismatch");
      expect(permissions.allows(anchor, "https://example.com/")).toBe(false);
    },
  );

  it("does not issue approval or create a grant for an explicit deny", () => {
    const policy = new BrowserTabPolicy();
    policy.setSettings(
      effectiveBrowserSettings(
        {},
        { default_origin_policy: { access: "deny" } },
      ),
    );
    const permissions = new BrowserPermissions(policy);
    expect(() =>
      permissions.require(call, anchor, "https://example.com/"),
    ).toThrow("denied");
    expect(permissions.pending()).toEqual([]);
    expect(permissions.allows(anchor, "https://example.com/")).toBe(false);
  });
});

describe("canonical conversation full access", () => {
  const settings = { approvalPolicy: "never", sandboxPolicy: "danger-full-access" };
  const url = "https://example.com/";
  it("allows browsing only after accepted full access settings for the same owner and thread", () => {
    const permissions = new BrowserPermissions(new BrowserTabPolicy());
    permissions.setThreadAccess(42, anchor.threadId, settings);
    expect(permissions.require(call, anchor, url)?.status).toBe("approval_required");
    permissions.clearPending(() => true);
    permissions.setThreadAccess(anchor.ownerWebContentsId, anchor.threadId, settings);
    expect(permissions.require(call, anchor, url)).toBeNull();
    expect(permissions.allows(anchor, url)).toBe(true);
    expect(permissions.allows({ ...anchor, turnId: "next-turn" }, url)).toBe(false);
    expect(permissions.allows({ ...anchor, browserSessionId: "other-session" }, url)).toBe(false);
    permissions.setThreadAccess(anchor.ownerWebContentsId, anchor.threadId, settings);
    expect(permissions.allows(anchor, url)).toBe(true);
    permissions.turnEnded(anchor.threadId, anchor.turnId);
    expect(permissions.allows(anchor, url)).toBe(false);
  });
  it.each([
    {}, { fullAccess: true }, { approvalPolicy: "never" },
    { approvalPolicy: "on-request", sandboxPolicy: "danger-full-access" },
    { approvalPolicy: "never", sandboxPolicy: "workspace-write" },
  ])("does not infer full access from incomplete settings: %j", (value) => {
    const permissions = new BrowserPermissions(new BrowserTabPolicy());
    permissions.setThreadAccess(anchor.ownerWebContentsId, anchor.threadId, value);
    expect(permissions.require(call, anchor, url)?.status).toBe("approval_required");
  });
  it("revokes automatic grants immediately on downgrade or disconnect", () => {
    const permissions = new BrowserPermissions(new BrowserTabPolicy());
    const enable = () => {
      permissions.setThreadAccess(anchor.ownerWebContentsId, anchor.threadId, settings);
      expect(permissions.require(call, anchor, url)).toBeNull();
    };
    enable();
    permissions.setThreadAccess(anchor.ownerWebContentsId, anchor.threadId, { approvalPolicy: "on-request" });
    expect(permissions.allows(anchor, url)).toBe(false);
    expect(permissions.require(call, anchor, url)?.status).toBe("approval_required");
    permissions.clearPending(() => true);
    enable();
    permissions.clearThreadAccess();
    expect(permissions.allows(anchor, url)).toBe(false);
    expect(permissions.require(call, anchor, url)?.status).toBe("approval_required");
  });
  it.each([
    { defaultOriginPolicy: { persistentApproval: false } },
    { defaultOriginPolicy: { accessApprovalLifetime: "turn" as const } },
    { origins: { "example.com": { persistentApproval: false } } },
  ])("keeps administrator approval requirements above full access: %j", (browserUse) => {
    const policy = new BrowserTabPolicy();
    policy.setSettings(effectiveBrowserSettings({}, null, { browserUse }));
    const permissions = new BrowserPermissions(policy);
    permissions.setThreadAccess(anchor.ownerWebContentsId, anchor.threadId, settings);
    expect(permissions.require(call, anchor, url)?.status).toBe("approval_required");
    expect(permissions.allows(anchor, url)).toBe(false);
  });
  it("keeps explicit deny above full access", () => {
    const policy = new BrowserTabPolicy();
    policy.setSettings(effectiveBrowserSettings({}, { default_origin_policy: { access: "deny" } }));
    const permissions = new BrowserPermissions(policy);
    permissions.setThreadAccess(anchor.ownerWebContentsId, anchor.threadId, settings);
    expect(() => permissions.require(call, anchor, url)).toThrow("denied");
    expect(permissions.pending()).toEqual([]);
  });
});
