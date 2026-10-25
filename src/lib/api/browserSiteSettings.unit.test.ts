import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserSiteSettings,
  removeBrowserSiteSettings,
  updateBrowserSiteSetting,
} from "./browserSiteSettings";
import {
  assertBrowserSiteSettingsSnapshot,
  parseBrowserSiteOrigin,
  parseBrowserSiteSettingsUpdate,
  DEFAULT_BROWSER_SITE_SETTINGS,
} from "./browserSiteSettingsTypes";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

const snapshot = {
  revision: 1,
  defaults: { ...DEFAULT_BROWSER_SITE_SETTINGS },
  sites: [],
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(snapshot);
});

describe("Browser site settings typed gateway", () => {
  it("uses the canonical Host commands and validates snapshots", async () => {
    expect(await getBrowserSiteSettings()).toEqual(snapshot);
    expect(invoke).toHaveBeenLastCalledWith("browser_site_settings_list", {});
    await updateBrowserSiteSetting({
      origin: "https://example.com",
      permission: "camera",
      setting: "allow",
    });
    expect(invoke).toHaveBeenLastCalledWith("browser_site_settings_update", {
      origin: "https://example.com",
      permission: "camera",
      setting: "allow",
    });
    await updateBrowserSiteSetting({
      origin: "https://example.com",
      permission: "geolocation",
      setting: null,
    });
    expect(invoke).toHaveBeenLastCalledWith("browser_site_settings_update", {
      origin: "https://example.com",
      permission: "geolocation",
      setting: null,
    });
    await removeBrowserSiteSettings("https://example.com");
    expect(invoke).toHaveBeenLastCalledWith("browser_site_settings_remove", {
      origin: "https://example.com",
    });
    invoke.mockResolvedValue({ ...snapshot, extra: true });
    await expect(getBrowserSiteSettings()).rejects.toThrow();
  });

  it("rejects malformed origins and updates before invoking the Host", () => {
    for (const origin of [
      "http://user:secret@example.com",
      "https://example.com/path",
      "file:///tmp/site",
      " https://example.com",
    ])
      expect(() => parseBrowserSiteOrigin(origin)).toThrow();
    for (const value of [
      {
        origin: "https://example.com/path",
        permission: "camera",
        setting: "allow",
      },
      { origin: null, permission: "unknown", setting: "allow" },
      { origin: null, permission: "camera", setting: null },
      { origin: null, permission: "camera", setting: "prompt" },
      { origin: null, permission: "sound", setting: "ask" },
      { origin: "https://example.com", permission: "sound", setting: "ask" },
    ])
      expect(() => parseBrowserSiteSettingsUpdate(value)).toThrow();
    expect(() =>
      assertBrowserSiteSettingsSnapshot({ ...snapshot, extra: true }),
    ).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
