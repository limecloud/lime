import { describe, expect, it } from "vitest";
import { effectiveBrowserSettings } from "../src/lib/api/browserSettingsTypes";
import { BrowserPermissions, browserPermissionOrigin, type BrowserPermissionAnchor } from "./browserPermissions";
import { BrowserTabPolicy } from "./browserTabPolicy";
import type { BrowserToolCall } from "./browserTabHost";

const anchor: BrowserPermissionAnchor = { ownerWebContentsId: 41, windowId: 7, threadId: "thread-1",
  browserSessionId: "session-1", turnId: "turn-1", tabId: "tab-1", viewId: "view-1", webContentsId: 51, pageRevision: 3 };
const call: BrowserToolCall = { tool: "observe", phase: "preflight", callId: "call-1", ownerWebContentsId: 41,
  threadId: "thread-1", turnId: "turn-1", arguments: { tabId: "tab-1" } };

describe("browser permission origin and policy owner", () => {
  it("preserves tri-state decisions and makes explicit site rules override defaults", () => {
    const settings = effectiveBrowserSettings();
    const policy = new BrowserTabPolicy();
    policy.setSettings({ ...settings, agent_permissions: { ...settings.agent_permissions, sites: [
      { pattern: "https://allowed.example:8443", permissions: { ...settings.agent_permissions.default, browse: "allow" } },
      { pattern: "blocked.example", permissions: { ...settings.agent_permissions.default, browse: "deny" } },
    ] } });
    expect(policy.decision("browse", "https://default.example/")).toBe("ask");
    expect(policy.allows("browse", "https://default.example/")).toBe(false);
    expect(policy.decision("browse", "https://allowed.example:8443/path")).toBe("allow");
    expect(policy.decision("browse", "https://allowed.example/path")).toBe("ask");
    expect(policy.decision("browse", "https://blocked.example/")).toBe("deny");
    expect(policy.decision("debug", "https://allowed.example:8443/")).toBe("deny");
  });

  it("normalizes default ports and rejects opaque schemes and URL credentials", () => {
    expect(browserPermissionOrigin("https://EXAMPLE.com:443/path?q=1#fragment")).toBe("https://example.com");
    expect(browserPermissionOrigin("http://example.com:8443/path")).toBe("http://example.com:8443");
    for (const value of ["about:blank", "data:text/plain,content", "https://user:pass@example.com", "invalid"])
      expect(() => browserPermissionOrigin(value)).toThrow("HTTP(S) origin");
  });

  it("binds grants to every owner/session/turn field and exact protocol plus port", () => {
    const permissions = new BrowserPermissions(new BrowserTabPolicy());
    const stage = permissions.require(call, anchor, "https://example.com:8443/path")!;
    permissions.consume({ ...call, phase: "approvedExecute", approvalToken: stage.approval?.approvalToken }, anchor);
    expect(permissions.allows(anchor, "https://example.com:8443/next")).toBe(true);
    for (const changed of [
      { ownerWebContentsId: 42 }, { windowId: 8 }, { threadId: "thread-2" },
      { browserSessionId: "session-2" }, { turnId: "turn-2" },
    ]) expect(permissions.allows({ ...anchor, ...changed }, "https://example.com:8443/")).toBe(false);
    for (const value of ["https://example.com/", "http://example.com:8443/", "https://sub.example.com:8443/"])
      expect(permissions.allows(anchor, value)).toBe(false);
  });

  it.each(["pageRevision", "webContentsId", "windowId"] as const)("rejects approvals whose %s changed", key => {
    const permissions = new BrowserPermissions(new BrowserTabPolicy());
    const stage = permissions.require(call, anchor, "https://example.com/")!;
    expect(() => permissions.consume({ ...call, phase: "approvedExecute", approvalToken: stage.approval?.approvalToken },
      { ...anchor, [key]: anchor[key] + 1 })).toThrow("identity or page revision mismatch");
    expect(permissions.allows(anchor, "https://example.com/")).toBe(false);
  });

  it("does not issue approval or create a grant for an explicit deny", () => {
    const settings = effectiveBrowserSettings();
    const policy = new BrowserTabPolicy();
    policy.setSettings({ ...settings, agent_permissions: { ...settings.agent_permissions,
      default: { ...settings.agent_permissions.default, browse: "deny" } } });
    const permissions = new BrowserPermissions(policy);
    expect(() => permissions.require(call, anchor, "https://example.com/")).toThrow("denied");
    expect(permissions.pending()).toEqual([]);
    expect(permissions.allows(anchor, "https://example.com/")).toBe(false);
  });
});
