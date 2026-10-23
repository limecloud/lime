import { beforeEach, expect, it, vi } from "vitest";
import { invalidateAppConfigCache } from "./appConfig";
import { AppServerRpcError } from "./appServerResponse";
import {
  effectiveBrowserSettings,
  getBrowserSettings,
  updateBrowserSetting,
  type BrowserSettings,
} from "./browserSettings";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));

let stored: BrowserSettings;
let version: number;
let writes: number;
beforeEach(() => {
  invalidateAppConfigCache();
  window.localStorage.clear();
  stored = effectiveBrowserSettings();
  version = 1;
  writes = 0;
  request.mockReset().mockImplementation(async (method, params) => {
    if (method === "config/read")
      return {
        result: {
          config: {
            browser: structuredClone(stored),
            language: "en-US",
            default_provider: "openai",
          },
          layers: [{ version: `v${version}` }],
        },
      };
    expect(method).toBe("config/batchWrite");
    writes += 1;
    if (params.expectedVersion !== `v${version}`)
      throw new AppServerRpcError({
        id: 1,
        error: {
          code: -32600,
          message: "Configuration was modified since last read.",
          data: { config_write_error_code: "configVersionConflict" },
        },
      });
    for (const edit of params.edits) {
      expect(edit.keyPath).toBe("browser");
      stored = structuredClone(edit.value);
    }
    version += 1;
    return {
      result: { status: "ok", version: `v${version}`, filePath: "/fixture" },
    };
  });
});

it("rejects a stale matrix even when the config cache has already read the newer version", async () => {
  const old = await getBrowserSettings();
  stored.agent_permissions.default.browse = "deny";
  version += 1;
  await getBrowserSettings({ forceRefresh: true });
  const attempted = structuredClone(old.agent_permissions);
  attempted.default.download = "allow";
  await expect(
    updateBrowserSetting("agent_permissions", attempted, old.agent_permissions),
  ).rejects.toMatchObject({ name: "BrowserSettingsConflictError" });
  expect(writes).toBe(0);
  expect(stored.agent_permissions.default.browse).toBe("deny");
});

it("checks the expected field inside the shared mutation queue", async () => {
  const old = await getBrowserSettings();
  const denied = structuredClone(old.agent_permissions);
  denied.default.browse = "deny";
  const allowed = structuredClone(old.agent_permissions);
  allowed.default.browse = "allow";
  const results = await Promise.allSettled([
    updateBrowserSetting("agent_permissions", denied, old.agent_permissions),
    updateBrowserSetting("agent_permissions", allowed, old.agent_permissions),
  ]);
  expect(results[0].status).toBe("fulfilled");
  expect(results[1]).toMatchObject({
    status: "rejected",
    reason: { name: "BrowserSettingsConflictError" },
  });
  expect(stored.agent_permissions.default.browse).toBe("deny");
  expect(writes).toBe(1);
});

it("preserves independent preference edits from the same UI snapshot", async () => {
  const old = await getBrowserSettings();
  await Promise.all([
    updateBrowserSetting("show_full_url", true, old.show_full_url),
    updateBrowserSetting("history_access", "disabled", old.history_access),
  ]);
  expect(stored).toMatchObject({
    show_full_url: true,
    history_access: "disabled",
  });
  expect(writes).toBe(2);
});

it("surfaces an unread remote CAS conflict without automatically replaying the grant", async () => {
  const old = await getBrowserSettings();
  stored.agent_permissions.default.browse = "deny";
  version += 1;
  const allowed = structuredClone(old.agent_permissions);
  allowed.default.browse = "allow";
  await expect(
    updateBrowserSetting("agent_permissions", allowed, old.agent_permissions),
  ).rejects.toMatchObject({ name: "BrowserSettingsConflictError" });
  expect(writes).toBe(1);
  expect((await getBrowserSettings()).agent_permissions.default.browse).toBe(
    "deny",
  );
});

it("snapshots and normalizes the caller's values before a queued write", async () => {
  const old = await getBrowserSettings();
  const next = structuredClone(old.agent_permissions);
  next.sites = [
    { pattern: "HTTPS://*.EXAMPLE.COM/", permissions: { ...next.default } },
  ];
  const saving = updateBrowserSetting(
    "agent_permissions",
    next,
    old.agent_permissions,
  );
  next.default.browse = "allow";
  await saving;
  expect(stored.agent_permissions.default.browse).toBe("ask");
  expect(stored.agent_permissions.sites[0].pattern).toBe(
    "https://*.example.com",
  );
});

it("keeps non-conflict persistence errors distinct", async () => {
  const old = await getBrowserSettings();
  const failure = new Error("disk unavailable");
  request.mockRejectedValueOnce(failure);
  await expect(
    updateBrowserSetting("enabled", false, old.enabled),
  ).rejects.toBe(failure);
});
