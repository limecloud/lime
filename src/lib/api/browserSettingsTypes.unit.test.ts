import { describe, expect, it } from "vitest";
import {
  browserPermissionForUrl,
  effectiveBrowserSettings,
  normalizeBrowserSitePattern,
  browserPreferences,
  DEFAULT_BROWSER_SITE_PERMISSIONS,
  applyBrowserAgentPermissions,
  type BrowserPreferences,
} from "./browserSettingsTypes";

describe("browser_use and native approvals", () => {
  it("separates admission from asking and creates independent snapshots", () => {
    const first = effectiveBrowserSettings();
    expect(first.history_access).toBe("alwaysAsk");
    expect(first.fullCdpAccessEnabled).toBe(false);
    first.allowedOrigins.push("example.com");
    expect(effectiveBrowserSettings().allowedOrigins).toEqual([]);
    const admission = { origins: { "example.com": { access: "allow" } } };
    expect(
      browserPermissionForUrl(
        effectiveBrowserSettings({}, admission),
        "browse",
        "https://example.com",
      ),
    ).toBe("ask");
    expect(
      browserPermissionForUrl(
        effectiveBrowserSettings({ approvalMode: "neverAsk" }, admission),
        "browse",
        "https://example.com",
      ),
    ).toBe("allow");
    expect(browserPreferences(first)).not.toHaveProperty("agent_permissions");
    expect(browserPreferences(first)).not.toHaveProperty("history_access");
  });

  it.each([
    ["https://EXAMPLE.COM/", "https://example.com"],
    ["*.example.com", "*.example.com"],
    ["http://localhost:3000/*", "http://localhost:3000"],
    ["https://*.example.com:8443", "https://*.example.com:8443"],
    ["http://[::1]:3000", "http://[::1]:3000"],
    ["example.com:443", "example.com:443"],
    ["example.com:80/", "example.com:80"],
    ["example.com/path", null],
    ["https://user:secret@example.com", null],
    ["https://example.com?token=secret", null],
    ["https://foo*.example.com", null],
    ["javascript:alert(1)", null],
    ["*", null],
    ["*.localhost", null],
  ])("normalizes site pattern %s without widening it", (input, expected) => {
    expect(normalizeBrowserSitePattern(input)).toBe(expected);
  });

  it("denies if any matching policy denies, regardless of specificity or insertion order", () => {
    for (const origins of [
      {
        "*.example.com": { access: "deny" },
        "https://app.example.com": { access: "allow" },
      },
      {
        "https://app.example.com": { access: "allow" },
        "*.example.com": { access: "deny" },
      },
    ]) {
      const settings = effectiveBrowserSettings(
        { approvalMode: "neverAsk" },
        { origins },
      );
      for (const action of [
        "browse",
        "download",
        "upload",
        "debug",
        "site_tools",
      ] as const)
        expect(
          browserPermissionForUrl(settings, action, "https://app.example.com"),
        ).toBe("deny");
    }
  });

  it("falls back per field, and refuses permissive duplicate canonical aliases", () => {
    const settings = effectiveBrowserSettings(
      { approvalMode: "neverAsk", downloadApprovalMode: "neverAsk" },
      {
        default_origin_policy: { access: "deny", downloads: "deny" },
        origins: {
          "https://EXAMPLE.COM/": { access: "allow" },
          "https://example.com": { access: "allow", downloads: "allow" },
        },
      },
    );
    expect(
      browserPermissionForUrl(settings, "browse", "https://example.com"),
    ).toBe("deny");
    expect(
      browserPermissionForUrl(settings, "download", "https://example.com"),
    ).toBe("deny");
    const unique = effectiveBrowserSettings(
      { approvalMode: "neverAsk" },
      {
        default_origin_policy: { access: "deny", downloads: "deny" },
        origins: { "https://example.com": { access: "allow" } },
      },
    );
    expect(
      browserPermissionForUrl(unique, "browse", "https://example.com"),
    ).toBe("allow");
    expect(
      browserPermissionForUrl(unique, "download", "https://example.com"),
    ).toBe("deny");
  });

  it("keeps disabled native capabilities closed despite remembered site grants", () => {
    const settings = effectiveBrowserSettings(
      {
        fullCdpAccessEnabled: false,
        webMcpEnabled: false,
        allowedFullCdpOrigins: ["example.com"],
        allowedWebMcpOrigins: ["example.com"],
      },
      {
        origins: {
          "example.com": { full_cdp_access: "allow", access: "allow" },
        },
      },
    );
    expect(
      browserPermissionForUrl(settings, "debug", "https://example.com"),
    ).toBe("deny");
    expect(
      browserPermissionForUrl(settings, "site_tools", "https://example.com"),
    ).toBe("deny");
  });

  it("honors native denials over grants and keeps explicit port boundaries", () => {
    const settings = effectiveBrowserSettings({
      allowedOrigins: ["https://example.com", "example.com:80"],
      deniedOrigins: ["https://example.com"],
    });
    expect(
      browserPermissionForUrl(settings, "browse", "https://example.com"),
    ).toBe("deny");
    expect(
      browserPermissionForUrl(settings, "browse", "http://example.com"),
    ).toBe("allow");
    expect(
      browserPermissionForUrl(settings, "browse", "https://example.com:8443"),
    ).toBe("ask");
    expect(
      browserPermissionForUrl(settings, "browse", "file:///etc/passwd"),
    ).toBe("deny");
  });

  it("edits only changed fields, clears native grants for ask, and removes both site stores", () => {
    const settings = effectiveBrowserSettings(
      {
        allowedOrigins: ["example.com"],
        allowedDownloadOrigins: ["example.com"],
      },
      {
        origins: { "example.com": { access: "allow", downloads: "allow" } },
      },
    );
    const next = structuredClone(settings.agent_permissions);
    next.sites[0].permissions.browse = "ask";
    const changed = applyBrowserAgentPermissions(
      browserPreferences(settings),
      settings.browser_use,
      settings.agent_permissions,
      next,
    );
    expect(changed.browser.allowedOrigins).toEqual([]);
    expect(changed.browser.allowedDownloadOrigins).toEqual(["example.com"]);
    expect(changed.browser_use.origins?.["example.com"]).toMatchObject({
      access: "allow",
      downloads: "allow",
    });
    const removed = applyBrowserAgentPermissions(
      changed.browser,
      changed.browser_use,
      next,
      { ...next, sites: [] },
    );
    expect(removed.browser_use.origins).toEqual({});
    expect(removed.browser.allowedDownloadOrigins).toEqual([]);
  });

  it("keeps a new inherited site sparse instead of manufacturing native grants", () => {
    const settings = effectiveBrowserSettings({
      approvalMode: "neverAsk",
      webMcpEnabled: true,
    });
    const next = structuredClone(settings.agent_permissions);
    next.sites = [
      {
        pattern: "example.com",
        permissions: { ...DEFAULT_BROWSER_SITE_PERMISSIONS },
      },
    ];
    const saved = applyBrowserAgentPermissions(
      browserPreferences(settings),
      null,
      settings.agent_permissions,
      next,
    );
    expect(saved.browser_use.origins?.["example.com"]).toEqual({});
    expect(saved.browser.allowedOrigins).toEqual([]);
    expect(saved.browser.allowedWebMcpOrigins).toEqual([]);
  });

  it("restores inheritance without leaving either admission overrides or native grants behind", () => {
    const settings = effectiveBrowserSettings(
      {
        allowedOrigins: ["example.com"],
        deniedDownloadOrigins: ["example.com"],
      },
      {
        origins: {
          "example.com": {
            access: "allow",
            downloads: "deny",
            uploads: "deny",
          },
        },
      },
    );
    const next = structuredClone(settings.agent_permissions);
    next.sites[0].permissions.browse = "default";
    next.sites[0].permissions.download = "default";
    const saved = applyBrowserAgentPermissions(
      browserPreferences(settings),
      settings.browser_use,
      settings.agent_permissions,
      next,
    );
    expect(saved.browser.allowedOrigins).toEqual([]);
    expect(saved.browser.deniedDownloadOrigins).toEqual([]);
    expect(saved.browser_use.origins?.["example.com"]).toMatchObject({
      access: null,
      downloads: null,
      uploads: "deny",
    });
    const restored = effectiveBrowserSettings(saved.browser, saved.browser_use);
    expect(restored.agent_permissions.sites[0].permissions.browse).toBe(
      "default",
    );
    expect(
      browserPermissionForUrl(restored, "browse", "https://example.com"),
    ).toBe("ask");
    expect(
      browserPermissionForUrl(restored, "upload", "https://example.com"),
    ).toBe("deny");
  });

  it("disallows site ask under Always allow and unsupported CDP ask", () => {
    const settings = effectiveBrowserSettings({
      approvalMode: "neverAsk",
      allowedOrigins: ["example.com"],
    });
    const next = structuredClone(settings.agent_permissions);
    next.sites[0].permissions.browse = "ask";
    expect(() =>
      applyBrowserAgentPermissions(
        browserPreferences(settings),
        null,
        settings.agent_permissions,
        next,
      ),
    ).toThrow("Change the default");
    next.sites[0].permissions.browse = "allow";
    next.default.debug = "ask";
    expect(() =>
      applyBrowserAgentPermissions(
        browserPreferences(settings),
        null,
        settings.agent_permissions,
        next,
      ),
    ).toThrow("only supports");
  });

  it.each([
    null,
    false,
    { enabled: "true" },
    { approvalMode: "disabled" },
    { history_access: "neverAsk" },
    { agent_permissions: {} },
    { allowedOrigins: ["https://user:secret@example.com"] },
  ])("rejects corrupt native preferences %j", (value) => {
    expect(() =>
      effectiveBrowserSettings(value as Partial<BrowserPreferences>),
    ).toThrow();
  });
  it.each([
    { allow_history_access: "true" },
    { default_origin_policy: { access: "ask" } },
    { origins: { "example.com/private": { access: "allow" } } },
    { origins: { "example.com": { download: "allow" } } },
    { unrecognized: true },
  ])("rejects corrupt admission policy %j", (value) => {
    expect(() => effectiveBrowserSettings({}, value)).toThrow();
  });
});
