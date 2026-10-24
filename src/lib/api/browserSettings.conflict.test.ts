import { beforeEach, expect, it, vi } from "vitest";
import { invalidateAppConfigCache } from "./appConfig";
import { AppServerRpcError } from "./appServerResponse";
import {
  effectiveBrowserSettings,
  browserSettingsFromConfig,
  browserPreferences,
  getBrowserSettings,
  updateBrowserSetting,
  type BrowserPreferences,
  type BrowserUse,
} from "./browserSettings";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));

let stored: BrowserPreferences;
let policy: BrowserUse | null;
const projection = () =>
  browserSettingsFromConfig({ browser: stored, browser_use: policy });
let version: number;
let writes: number;
beforeEach(() => {
  invalidateAppConfigCache();
  window.localStorage.clear();
  stored = browserPreferences(effectiveBrowserSettings());
  policy = null;
  version = 1;
  writes = 0;
  request.mockReset().mockImplementation(async (method, params) => {
    if (method === "config/read")
      return {
        result: {
          config: {
            browser: structuredClone(stored),
            browser_use: structuredClone(policy),
            language: "en-US",
            default_provider: "openai",
          },
          layers: [
            {
              name: { type: "user", file: "/fixture", profile: null },
              version: `v${version}`,
              config: {
                browser: structuredClone(stored),
                browser_use: structuredClone(policy),
                language: "en-US",
                default_provider: "openai",
              },
            },
          ],
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
      expect(["browser", "browser_use"]).toContain(edit.keyPath);
      if (edit.keyPath === "browser") stored = structuredClone(edit.value);
      else policy = structuredClone(edit.value);
    }
    version += 1;
    return {
      result: { status: "ok", version: `v${version}`, filePath: "/fixture" },
    };
  });
});

it("rejects a stale matrix even when the config cache has already read the newer version", async () => {
  const old = await getBrowserSettings();
  policy = {
    default_origin_policy: {
      access: "deny",
      downloads: null,
      uploads: null,
      full_cdp_access: null,
    },
  };
  version += 1;
  await getBrowserSettings({ forceRefresh: true });
  const attempted = structuredClone(old.agent_permissions);
  attempted.default.download = "allow";
  await expect(
    updateBrowserSetting("agent_permissions", attempted, old.agent_permissions),
  ).rejects.toMatchObject({ name: "BrowserSettingsConflictError" });
  expect(writes).toBe(0);
  expect(projection().agent_permissions.default.browse).toBe("deny");
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
  expect(projection().agent_permissions.default.browse).toBe("deny");
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
    iabHistoryApprovalMode: "alwaysAsk",
  });
  expect(policy?.allow_history_access).toBe(false);
  expect(writes).toBe(2);
});

it("surfaces an unread remote CAS conflict without automatically replaying the grant", async () => {
  const old = await getBrowserSettings();
  policy = {
    default_origin_policy: {
      access: "deny",
      downloads: null,
      uploads: null,
      full_cdp_access: null,
    },
  };
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
  expect(projection().agent_permissions.default.browse).toBe("ask");
  expect(projection().agent_permissions.sites[0].pattern).toBe(
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

it("writes admission and native grants atomically and keeps history approval on disable/re-enable", async () => {
  stored.iabHistoryApprovalMode = "neverAsk";
  const old = await getBrowserSettings();
  const next = structuredClone(old.agent_permissions);
  next.sites = [
    {
      pattern: "example.com",
      permissions: { ...next.default, browse: "allow" },
    },
  ];
  const saved = await updateBrowserSetting(
    "agent_permissions",
    next,
    old.agent_permissions,
  );
  const edits = request.mock.calls.find(
    ([method]) => method === "config/batchWrite",
  )![1].edits;
  expect(edits.map((edit: { keyPath: string }) => edit.keyPath).sort()).toEqual(
    ["browser", "browser_use"],
  );
  expect(saved.allowedOrigins).toEqual(["example.com"]);
  expect(policy?.origins?.["example.com"]?.access).toBe("allow");
  expect(stored).not.toHaveProperty("agent_permissions");
  await updateBrowserSetting("history_access", "disabled", "neverAsk");
  expect(stored.iabHistoryApprovalMode).toBe("neverAsk");
  expect(policy?.allow_history_access).toBe(false);
  await updateBrowserSetting("history_access", "neverAsk", "disabled");
  expect(policy?.allow_history_access).toBe(true);
  expect(stored.iabHistoryApprovalMode).toBe("neverAsk");
});
