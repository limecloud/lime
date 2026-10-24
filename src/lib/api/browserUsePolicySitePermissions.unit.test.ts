import { describe, expect, it } from "vitest";
import { effectiveBrowserSettings } from "./browserSettingsTypes";
import {
  browserSitePatternCovers,
  browserSitePatternsOverlap,
} from "./browserUseConfig";
import {
  browserPermissionRowManaged,
  browserSitePermissionCell,
  type BrowserPermissionContext,
} from "./browserUsePolicySitePermissions";

describe("complete browser origin sets", () => {
  it.each([
    ["*.example.com", "https://app.example.com", true, true],
    ["*.example.com", "example.com", false, false],
    ["*.example.com", "*.nested.example.com", true, true],
    ["*.nested.example.com", "*.example.com", false, true],
    ["https://example.com", "example.com", false, true],
    ["example.com", "https://example.com:8443", true, true],
    ["example.com:443", "https://example.com", true, true],
    ["https://example.com", "http://example.com", false, false],
    ["https://*.example.com:8443", "https://a.example.com", false, false],
    ["http://[::1]:3000", "http://[::1]:3000", true, true],
    ["https://app.example.com", "*.example.com", false, true],
    ["*.example.com", "https://notexample.com", false, false],
  ])("compares %s with %s", (outer, inner, covers, overlaps) => {
    expect(browserSitePatternCovers(outer, inner)).toBe(covers);
    expect(browserSitePatternsOverlap(outer, inner)).toBe(overlaps);
    expect(browserSitePatternsOverlap(inner, outer)).toBe(overlaps);
  });
});

describe("saved choices and effective browser site permissions", () => {
  it("applies the default access denial to every default resource without changing saved preferences", () => {
    const settings = effectiveBrowserSettings(
      { fullCdpAccessEnabled: true },
      { default_origin_policy: { access: "deny" } },
    );
    expect(settings.agent_permissions.default.site_tools).toBe("allow");
    for (const action of [
      "browse",
      "download",
      "upload",
      "debug",
      "site_tools",
    ] as const)
      expect(
        browserSitePermissionCell(settings, null, action, "").effectiveValue,
      ).toBe("deny");
  });
  it("retains an explicit allow while projecting a covering access denial to every resource", () => {
    const settings = effectiveBrowserSettings(
      {
        fullCdpAccessEnabled: true,
        allowedOrigins: ["https://app.example.com"],
      },
      {
        origins: {
          "*.example.com": { access: "deny" },
          "https://app.example.com": { access: "allow" },
        },
      },
    );
    expect(
      settings.agent_permissions.sites.find(
        (site) => site.pattern === "https://app.example.com",
      )!.permissions.browse,
    ).toBe("allow");
    for (const action of [
      "browse",
      "download",
      "upload",
      "debug",
      "site_tools",
    ] as const)
      expect(
        browserSitePermissionCell(
          settings,
          null,
          action,
          "https://app.example.com",
        ),
      ).toMatchObject({
        effectiveValue: "deny",
        blockingPattern: "*.example.com",
        inheritedRestriction: "user",
      });
  });

  it("shows inherited approval and native grants without persisting them as site overrides", () => {
    const settings = effectiveBrowserSettings(
      { allowedDownloadOrigins: ["*.example.com"] },
      {
        origins: { "https://app.example.com": {} },
      },
    );
    expect(
      browserSitePermissionCell(
        settings,
        null,
        "browse",
        "https://app.example.com",
      ),
    ).toMatchObject({ effectiveValue: "ask", inherited: true });
    expect(
      browserSitePermissionCell(
        settings,
        null,
        "download",
        "https://app.example.com",
      ),
    ).toMatchObject({ effectiveValue: "allow", inherited: true });
  });

  it("marks a broad wildcard mixed when only a real subdomain is blocked", () => {
    const settings = effectiveBrowserSettings(
      { approvalMode: "neverAsk" },
      {
        origins: {
          "*.example.com": {},
          "https://private.example.com": { access: "deny" },
        },
      },
    );
    expect(
      browserSitePermissionCell(settings, null, "browse", "*.example.com"),
    ).toMatchObject({
      effectiveValue: "mixed",
      blockingPattern: "https://private.example.com",
    });
    expect(
      browserSitePermissionCell(
        settings,
        null,
        "browse",
        "https://private.example.com",
      ).effectiveValue,
    ).toBe("deny");
  });

  it("preserves scheme/port differences instead of manufacturing an effective URL", () => {
    const settings = effectiveBrowserSettings(
      { approvalMode: "neverAsk" },
      {
        default_origin_policy: { access: "deny" },
        origins: {
          "example.com": {},
          "https://example.com": { access: "allow" },
          "http://elsewhere.com": { access: "allow" },
        },
      },
    );
    expect(
      browserSitePermissionCell(settings, null, "browse", "example.com")
        .effectiveValue,
    ).toBe("mixed");
    expect(
      browserSitePermissionCell(settings, null, "browse", "https://example.com")
        .effectiveValue,
    ).toBe("allow");
    expect(
      browserSitePermissionCell(
        settings,
        null,
        "browse",
        "https://example.com:8443",
      ).effectiveValue,
    ).toBe("deny");
  });

  it("does not turn duplicate canonical aliases into a grant", () => {
    const settings = effectiveBrowserSettings(
      { approvalMode: "neverAsk" },
      {
        default_origin_policy: { access: "deny" },
        origins: {
          "https://EXAMPLE.COM/": { access: "allow" },
          "https://example.com": { access: "allow" },
        },
      },
    );
    expect(
      browserSitePermissionCell(settings, null, "browse", "https://example.com")
        .effectiveValue,
    ).toBe("deny");
  });

  it("shows partial native denials and grants, with a full denial taking precedence", () => {
    const settings = effectiveBrowserSettings(
      {
        deniedDownloadOrigins: ["https://private.example.com"],
        allowedUploadOrigins: ["https://upload.example.com"],
      },
      { origins: { "*.example.com": {} } },
    );
    expect(
      browserSitePermissionCell(settings, null, "download", "*.example.com")
        .effectiveValue,
    ).toBe("mixed");
    expect(
      browserSitePermissionCell(settings, null, "upload", "*.example.com")
        .effectiveValue,
    ).toBe("mixed");
    settings.browser_use = { default_origin_policy: { uploads: "deny" } };
    expect(
      browserSitePermissionCell(settings, null, "upload", "*.example.com")
        .effectiveValue,
    ).toBe("deny");
  });

  it("uses managed origin metadata for locks and blocking provenance without an enterprise policy store", () => {
    const settings = effectiveBrowserSettings(
      {},
      {
        origins: {
          "*.example.com": { access: "deny" },
          "https://app.example.com": { access: "allow" },
        },
      },
    );
    const context: BrowserPermissionContext = {
      origins: {
        "browser_use.origins.*.example.com.access": {
          name: { type: "mdm", domain: "fixture", key: "config" },
          version: "managed-v1",
        },
      },
      userPermissions: effectiveBrowserSettings().agent_permissions,
    };
    expect(
      browserSitePermissionCell(settings, context, "browse", "*.example.com"),
    ).toMatchObject({ managed: true, disabledReason: "managed" });
    expect(
      browserPermissionRowManaged(settings, context, "*.example.com"),
    ).toBe(true);
    expect(
      browserSitePermissionCell(
        settings,
        context,
        "browse",
        "https://app.example.com",
      ),
    ).toMatchObject({
      managed: false,
      disabledReason: "managed",
      effectiveValue: "deny",
      inheritedRestriction: "organization",
    });
  });

  it("keeps remembered grants ineffective and uneditable while the browser capability is closed", () => {
    const settings = effectiveBrowserSettings({
      webMcpEnabled: false,
      allowedWebMcpOrigins: ["example.com"],
    });
    expect(
      browserSitePermissionCell(settings, null, "site_tools", "example.com"),
    ).toMatchObject({
      effectiveValue: "deny",
      disabledReason: "capabilityUnavailable",
    });
    settings.enabled = false;
    expect(
      browserSitePermissionCell(settings, null, "browse", "example.com"),
    ).toMatchObject({
      effectiveValue: "deny",
      disabledReason: "browserUnavailable",
    });
  });
});
