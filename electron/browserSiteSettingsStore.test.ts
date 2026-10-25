// @vitest-environment node
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { PersistedAtomFileIO } from "./persistedAtomFile";
import { BrowserSiteSettingsStore } from "./browserSiteSettingsStore";
import { DEFAULT_BROWSER_SITE_SETTINGS } from "../src/lib/api/browserSiteSettingsTypes";

function fixture(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const io: PersistedAtomFileIO = {
    readFile: async (file) => {
      const value = files.get(file);
      if (value === undefined)
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return Buffer.from(value);
    },
    mkdir: vi.fn(async () => undefined),
    writeFile: async (file, value) => {
      files.set(file, value);
    },
    rename: async (from, to) => {
      const value = files.get(from);
      if (value === undefined) throw new Error("missing temp file");
      files.delete(from);
      files.set(to, value);
    },
    removeTemporary: async (file) => {
      files.delete(file);
    },
  };
  return {
    files,
    io,
    create: () => new BrowserSiteSettingsStore("/lime-data", { io }),
  };
}

describe("BrowserSiteSettingsStore", () => {
  it("upgrades v3 in place, preserves existing rules and persists new decisions and inheritance", async () => {
    const f = fixture({
      "/lime-data/browser/site-settings.json": JSON.stringify({
        schemaVersion: 3,
        revision: 9,
        defaults: {
          camera: "ask",
          microphone: "block",
          geolocation: "ask",
          notifications: "ask",
          clipboard: "allow",
          sound: "block",
        },
        sites: [{ origin: "https://example.com", sound: "allow" }],
      }),
    });
    const store = f.create();
    expect((await store.list()).revision).toBe(9);
    expect(store.decision("https://example.com", "sound")).toBe("allow");
    expect(store.decision("https://example.com", "protectedContent")).toBe(
      "block",
    );
    await store.update({
      origin: null,
      permission: "automaticDownloads",
      setting: "block",
    });
    await store.update({
      origin: "https://example.com",
      permission: "automaticDownloads",
      setting: "allow",
    });
    const reloaded = f.create();
    await reloaded.ready;
    expect(reloaded.decision("https://example.com", "automaticDownloads")).toBe(
      "allow",
    );
    expect(
      reloaded.decision("https://other.example", "automaticDownloads"),
    ).toBe("block");
    expect(reloaded.decision("https://example.com", "protectedContent")).toBe(
      "block",
    );
    await reloaded.update({
      origin: "https://example.com",
      permission: "automaticDownloads",
      setting: null,
    });
    expect(reloaded.decision("https://example.com", "automaticDownloads")).toBe(
      "block",
    );
    expect(
      JSON.parse(f.files.get("/lime-data/browser/site-settings.json")!)
        .schemaVersion,
    ).toBe(4);
  });
  it("rejects unavailable protected-content writes without mutating the saved profile", async () => {
    const f = fixture({
      "/lime-data/browser/site-settings.json": JSON.stringify({
        schemaVersion: 4,
        revision: 7,
        defaults: {
          ...DEFAULT_BROWSER_SITE_SETTINGS,
          protectedContent: "allow",
        },
        sites: [],
      }),
    });
    const store = f.create();
    await store.ready;
    const before = await store.list();
    expect(store.decision("https://example.com", "protectedContent")).toBe(
      "block",
    );
    await expect(
      store.invoke("browser_site_settings_update", {
        origin: null,
        permission: "protectedContent",
        setting: "allow",
      }),
    ).rejects.toThrow("unavailable");
    expect(await store.list()).toEqual(before);
    expect(
      JSON.parse(f.files.get("/lime-data/browser/site-settings.json")!)
        .revision,
    ).toBe(7);
  });
  it("persists defaults, site overrides and inherited website entries", async () => {
    const f = fixture();
    const store = f.create();
    await store.update({
      origin: null,
      permission: "camera",
      setting: "block",
    });
    await store.update({
      origin: "https://example.com",
      permission: "microphone",
      setting: "allow",
    });
    await store.update({
      origin: "https://inherited.example",
      permission: "camera",
      setting: null,
    });

    const reloaded = f.create();
    const snapshot = await reloaded.list();
    expect(snapshot.defaults).toEqual({
      ...DEFAULT_BROWSER_SITE_SETTINGS,
      camera: "block",
    });
    expect(snapshot.sites).toEqual([
      {
        origin: "https://example.com",
        camera: null,
        microphone: "allow",
        geolocation: null,
        notifications: null,
        clipboard: null,
        sound: null,
        protectedContent: null,
        automaticDownloads: null,
      },
      {
        origin: "https://inherited.example",
        camera: null,
        microphone: null,
        geolocation: null,
        notifications: null,
        clipboard: null,
        sound: null,
        protectedContent: null,
        automaticDownloads: null,
      },
    ]);
    expect(
      await reloaded.resolveDecision("https://example.com", "camera"),
    ).toBe("block");
    expect(
      await reloaded.resolveDecision("https://example.com", "microphone"),
    ).toBe("allow");
  });

  it("removes one website and clears all saved website settings", async () => {
    const store = fixture().create();
    await store.update({
      origin: "https://example.com",
      permission: "camera",
      setting: "allow",
    });
    await store.update({
      origin: "https://other.example",
      permission: "microphone",
      setting: "block",
    });
    expect((await store.remove("https://example.com")).sites).toHaveLength(1);
    const cleared = await store.clear();
    expect(cleared.sites).toEqual([]);
    expect(cleared.defaults).toEqual(DEFAULT_BROWSER_SITE_SETTINGS);
  });

  it("keeps a website asking independently of an allowed default, until explicitly reset", async () => {
    const f = fixture();
    const store = f.create();
    await store.update({
      origin: null,
      permission: "camera",
      setting: "allow",
    });
    await store.update({
      origin: "https://example.com",
      permission: "camera",
      setting: "ask",
    });
    const reloaded = f.create();
    expect(
      await reloaded.resolveDecision("https://example.com", "camera"),
    ).toBe("ask");
    expect((await reloaded.list()).sites[0].camera).toBe("ask");
    await reloaded.update({
      origin: "https://example.com",
      permission: "camera",
      setting: null,
    });
    expect(
      await reloaded.resolveDecision("https://example.com", "camera"),
    ).toBe("allow");
    expect((await reloaded.list()).sites[0].camera).toBeNull();
    expect(() =>
      reloaded.update({
        origin: null,
        permission: "camera",
        setting: null,
      } as never),
    ).toThrow();
  });

  it("migrates the existing profile and persists independent location and notification rules", async () => {
    const f = fixture({
      "/lime-data/browser/site-settings.json": JSON.stringify({
        schemaVersion: 1,
        revision: 4,
        defaults: { camera: "block", microphone: "ask" },
        sites: [{ origin: "https://example.com", camera: "allow" }],
      }),
    });
    const store = f.create();
    expect(await store.resolveDecision("https://example.com", "camera")).toBe(
      "allow",
    );
    expect(
      await store.resolveDecision("https://example.com", "geolocation"),
    ).toBe("ask");
    await store.update({
      origin: "https://example.com",
      permission: "geolocation",
      setting: "block",
    });
    await store.update({
      origin: "https://example.com",
      permission: "notifications",
      setting: "allow",
    });
    const reloaded = f.create();
    expect(
      await reloaded.resolveDecision("https://example.com", "geolocation"),
    ).toBe("block");
    expect(
      await reloaded.resolveDecision("https://example.com", "notifications"),
    ).toBe("allow");
    expect(
      JSON.parse(f.files.get("/lime-data/browser/site-settings.json")!)
        .schemaVersion,
    ).toBe(4);
  });

  it("fails closed when the persisted file is corrupt", async () => {
    const f = fixture({ "/lime-data/browser/site-settings.json": "{" });
    const store = f.create();
    await expect(store.list()).rejects.toThrow("corrupt");
    expect(store.decision("https://example.com", "camera")).toBe("block");
    await expect(
      store.update({
        origin: "https://example.com",
        permission: "camera",
        setting: "allow",
      }),
    ).rejects.toThrow("corrupt");
  });

  it("upgrades v2 without losing overrides and persists clipboard and sound in the same profile", async () => {
    const f = fixture({
      "/lime-data/browser/site-settings.json": JSON.stringify({
        schemaVersion: 2,
        revision: 7,
        defaults: {
          camera: "block",
          microphone: "ask",
          geolocation: "allow",
          notifications: "block",
        },
        sites: [{ origin: "https://example.com", geolocation: "ask" }],
      }),
    });
    const store = f.create();
    expect((await store.list()).revision).toBe(7);
    expect(store.decision("https://example.com", "geolocation")).toBe("ask");
    expect(store.decision("https://example.com", "clipboard")).toBe("ask");
    expect(store.decision("https://example.com", "sound")).toBe("allow");
    await store.update({ origin: null, permission: "sound", setting: "block" });
    await store.update({
      origin: "https://example.com",
      permission: "sound",
      setting: "allow",
    });
    await store.update({
      origin: "https://example.com",
      permission: "clipboard",
      setting: "block",
    });
    const reloaded = f.create();
    await reloaded.ready;
    expect(reloaded.decision("https://example.com", "sound")).toBe("allow");
    expect(reloaded.decision("https://other.example", "sound")).toBe("block");
    expect(reloaded.decision("https://example.com", "clipboard")).toBe("block");
    await reloaded.update({
      origin: "https://example.com",
      permission: "sound",
      setting: null,
    });
    expect(reloaded.decision("https://example.com", "sound")).toBe("block");
    expect(() =>
      reloaded.update({ origin: null, permission: "sound", setting: "ask" }),
    ).toThrow();
    await reloaded.remove("https://example.com");
    expect(reloaded.decision("https://example.com", "clipboard")).toBe("ask");
    await reloaded.clear();
    expect(reloaded.decision("https://example.com", "sound")).toBe("allow");
  });

  it.each([1, 2, 3])(
    "rejects malformed v%s data rather than relaxing a rule during migration",
    async (schemaVersion) => {
      const defaults =
        schemaVersion === 1
          ? { camera: "allow", microphone: "block" }
          : schemaVersion === 2
            ? {
                camera: "allow",
                microphone: "block",
                geolocation: "ask",
                notifications: "ask",
              }
            : { ...DEFAULT_BROWSER_SITE_SETTINGS, sound: "ask" };
      const f = fixture({
        "/lime-data/browser/site-settings.json": JSON.stringify({
          schemaVersion,
          revision: 2,
          defaults,
          sites: [{ origin: "https://example.com", clipboard: "allow" }],
        }),
      });
      const store = f.create();
      await expect(store.list()).rejects.toThrow("corrupt");
      expect(store.decision("https://example.com", "sound")).toBe("block");
      expect(store.decision("https://example.com", "clipboard")).toBe("block");
    },
  );
});
