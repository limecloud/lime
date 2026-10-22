import { describe, expect, it } from "vitest";
import {
  browserPermissionForUrl,
  effectiveBrowserSettings,
  normalizeBrowserSitePattern,
  type BrowserPermissions,
  type BrowserSettings,
} from "./browserSettingsTypes";

function permissions(browse: BrowserPermissions["browse"]): BrowserPermissions {
  return {
    browse,
    download: "ask",
    upload: "ask",
    debug: "ask",
    site_tools: "ask",
  };
}

describe("browser settings policy", () => {
  it("uses safe defaults and creates independent policy snapshots", () => {
    const first = effectiveBrowserSettings();
    expect(first).toMatchObject({
      enabled: true,
      show_full_url: false,
      annotation_screenshot: "always",
      download_directory: null,
      ask_download_location: false,
      history_access: "alwaysAsk",
      site_tools_enabled: true,
      full_cdp_access: false,
      agent_permissions: { default: permissions("ask"), sites: [] },
    });
    first.agent_permissions.default.browse = "allow";
    expect(effectiveBrowserSettings().agent_permissions.default.browse).toBe(
      "ask",
    );
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

  it("uses the most specific site rule and respects origin ports and wildcard boundaries", () => {
    const settings = effectiveBrowserSettings({
      agent_permissions: {
        default: permissions("deny"),
        sites: [
          { pattern: "*.example.com", permissions: permissions("allow") },
          { pattern: "app.example.com", permissions: permissions("ask") },
          {
            pattern: "https://app.example.com:8443",
            permissions: permissions("deny"),
          },
          {
            pattern: "https://*.example.com",
            permissions: permissions("allow"),
          },
        ],
      },
    });
    expect(
      browserPermissionForUrl(settings, "browse", "https://docs.example.com/a"),
    ).toBe("allow");
    expect(
      browserPermissionForUrl(settings, "browse", "https://example.com/a"),
    ).toBe("deny");
    expect(
      browserPermissionForUrl(settings, "browse", "https://evilexample.com"),
    ).toBe("deny");
    expect(
      browserPermissionForUrl(settings, "browse", "https://app.example.com"),
    ).toBe("ask");
    expect(
      browserPermissionForUrl(
        settings,
        "browse",
        "https://app.example.com:8443",
      ),
    ).toBe("deny");
    expect(
      browserPermissionForUrl(
        settings,
        "browse",
        "http://app.example.com:8443",
      ),
    ).toBe("ask");
    expect(
      browserPermissionForUrl(settings, "browse", "file:///etc/passwd"),
    ).toBe("deny");
  });

  it("does not apply an origin's default port rule to a different service", () => {
    const settings = effectiveBrowserSettings({
      agent_permissions: {
        default: permissions("ask"),
        sites: [
          { pattern: "https://example.com", permissions: permissions("allow") },
        ],
      },
    });
    expect(
      browserPermissionForUrl(settings, "browse", "https://example.com:443"),
    ).toBe("allow");
    expect(
      browserPermissionForUrl(settings, "browse", "https://example.com:8443"),
    ).toBe("ask");
  });

  it("keeps explicit hostname ports effective across HTTP and HTTPS default-port normalization", () => {
    for (const [pattern, accepted, rejected] of [
      ["example.com:443", "https://example.com", "http://example.com"],
      ["example.com:80", "http://example.com", "https://example.com"],
    ]) {
      const settings = effectiveBrowserSettings({
        agent_permissions: {
          default: permissions("ask"),
          sites: [{ pattern, permissions: permissions("allow") }],
        },
      });
      expect(browserPermissionForUrl(settings, "browse", accepted)).toBe(
        "allow",
      );
      expect(browserPermissionForUrl(settings, "browse", rejected)).toBe("ask");
    }
  });

  it.each([
    null,
    false,
    { enabled: "true" },
    { full_cdp_access: null },
    { history_access: "allow" },
    { unsafe_debug: true },
    { agent_permissions: null },
    { agent_permissions: { default: { browse: "always" }, sites: [] } },
    {
      agent_permissions: {
        default: permissions("ask"),
        sites: [
          { pattern: "EXAMPLE.COM/", permissions: permissions("allow") },
          { pattern: "example.com", permissions: permissions("deny") },
        ],
      },
    },
  ])("rejects corrupt policy without silently granting access: %j", (value) => {
    expect(() =>
      effectiveBrowserSettings(value as Partial<BrowserSettings>),
    ).toThrow();
  });
});
