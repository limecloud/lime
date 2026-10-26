import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "./appConfig";
import {
  allowedComputerApps,
  getComputerUseSettings,
  removeAllowedComputerApp,
  setComputerUseEnabled,
  setupComputerUseAdapter,
} from "./computerUseSettings";

const api = vi.hoisted(() => ({
  snapshot: vi.fn(),
  requirements: vi.fn(),
  status: vi.fn(),
  update: vi.fn(),
  setup: vi.fn(),
}));
vi.mock("./appConfig", () => ({
  getConfigSnapshot: api.snapshot,
  updateConfig: api.update,
}));
vi.mock("./configRequirements", () => ({
  getConfigRequirements: api.requirements,
}));
vi.mock("./computerUse", () => ({
  readComputerUseStatus: api.status,
  setupComputerUse: api.setup,
}));
let config: Config;

beforeEach(() => {
  vi.resetAllMocks();
  api.setup.mockResolvedValue({
    accepted: true,
    status: { adapter: "native", readiness: "ready", epoch: 1 },
  });
  config = {
    default_provider: "local",
    features: { computer_use: false, other: true },
    desktop: { skin: "custom" },
    computer_use: {
      macos: {
        bundle_ids: {
          "com.example.App": "allow",
          "com.example.App.Helper": "allow",
          "com.example.Blocked": "deny",
        },
      },
    },
  } as unknown as Config;
  api.snapshot.mockImplementation(async () => ({
    config,
    origins: {},
    layer: { config },
  }));
  api.requirements.mockResolvedValue(null);
  api.status.mockResolvedValue({
    epoch: 3,
    adapters: [{ adapter: "native", readiness: "disabled", epoch: 3 }],
    grants: [],
  });
  api.update.mockImplementation(async (updater: (value: Config) => Config) => {
    config = updater(config);
    return config;
  });
});

describe("Computer Use settings through existing owners", () => {
  it("reads actual adapter state and preserves unrelated features, theme and provider when enabled", async () => {
    const snapshot = await getComputerUseSettings();
    expect(snapshot.enabled.native).toBe(false);
    expect(snapshot.status.adapters[0].readiness).toBe("disabled");
    await setComputerUseEnabled(true, snapshot.enabled.native);
    expect(config.features).toEqual({ computer_use: true, other: true });
    expect(config.desktop).toEqual({ skin: "custom" });
    expect(config.default_provider).toBe("local");
    expect(config.computer_use?.default_app_access).toBeUndefined();
    expect(api.setup).not.toHaveBeenCalled();
  });

  it("keeps global admin denial and managed configuration read-only", async () => {
    api.requirements.mockResolvedValue({ allowBrowserAndComputerUse: false });
    expect((await getComputerUseSettings()).managed.native).toBe(true);
    api.requirements.mockResolvedValue(null);
    api.snapshot.mockResolvedValue({
      config,
      origins: {
        "features.computer_use": { name: { type: "mdm" } },
        "computer_use.macos.bundle_ids.com.example.App": {
          name: { type: "mdm" },
        },
      },
    });
    const snapshot = await getComputerUseSettings();
    expect(snapshot.managed.native).toBe(true);
    expect(
      snapshot.allowedApps.find((app) => app.key === "com.example.App")
        ?.managed,
    ).toBe(true);
  });

  it("removes exactly the approved bundle and leaves deny rules and similarly named apps intact", async () => {
    const app = allowedComputerApps(config.computer_use).find(
      (entry) => entry.key === "com.example.App",
    )!;
    await removeAllowedComputerApp(app);
    expect(config.computer_use?.macos?.bundle_ids).toEqual({
      "com.example.App.Helper": "allow",
      "com.example.Blocked": "deny",
    });
  });

  it("removes a Windows executable by publisher/product/binary identity", async () => {
    config.computer_use = {
      windows: {
        exes: [
          {
            publisher_name: "A",
            product_name: "Editor",
            binary_name: "edit.exe",
            access: "allow",
          },
          {
            publisher_name: "B",
            product_name: "Editor",
            binary_name: "edit.exe",
            access: "allow",
          },
        ],
      },
    };
    const apps = allowedComputerApps(config.computer_use);
    expect(apps[0].id).not.toBe(apps[1].id);
    await removeAllowedComputerApp(apps[0]);
    expect(config.computer_use.windows?.exes).toHaveLength(1);
    expect(config.computer_use.windows?.exes?.[0].publisher_name).toBe("B");
  });

  it("requires removing broad default approval before a specific app can be revoked", async () => {
    config.computer_use!.default_app_access = "allow";
    const apps = allowedComputerApps(config.computer_use);
    await expect(
      removeAllowedComputerApp(apps.find((app) => app.field === "bundle")!),
    ).rejects.toThrow("default approval");
    await removeAllowedComputerApp(
      apps.find((app) => app.field === "default")!,
    );
    expect(config.computer_use?.default_app_access).toBeUndefined();
  });

  it("rejects stale setting changes and stale or managed app removal", async () => {
    config.features!.computer_use = true;
    await expect(setComputerUseEnabled(false, false)).rejects.toThrow(
      "changed",
    );
    const app = allowedComputerApps(config.computer_use)[0];
    await expect(
      removeAllowedComputerApp({ ...app, managed: true }),
    ).rejects.toThrow("managed");
    delete config.computer_use!.macos!.bundle_ids![app.key];
    await expect(removeAllowedComputerApp(app)).rejects.toThrow("changed");
  });

  it("only requests system setup without selecting or authorizing an arbitrary app", async () => {
    await setupComputerUseAdapter("native");
    expect(api.setup).toHaveBeenCalledWith({
      adapter: "native",
      grantScope: "session",
    });
  });

  it("does not replace unavailable adapter state or a failed status request with ready", async () => {
    api.status.mockRejectedValue(new Error("transport closed"));
    await expect(getComputerUseSettings()).rejects.toThrow("transport closed");
  });

  it("requests persistent setup through the shared RPC and reflects administrator restrictions", async () => {
    const target = { type: "native" as const, appId: "com.example.App" };
    api.setup.mockResolvedValue({
      accepted: true,
      status: { readiness: "ready" },
      grant: { target, scope: "persistent" },
    });
    await setupComputerUseAdapter("native", target, "persistent");
    expect(api.setup).toHaveBeenCalledWith({
      adapter: "native",
      target,
      grantScope: "persistent",
    });
    expect(api.update).not.toHaveBeenCalled();
    expect((await getComputerUseSettings()).persistentApprovalAllowed).toBe(
      true,
    );
    api.requirements.mockResolvedValue({
      computerUse: { allowPersistentApproval: false },
    });
    expect((await getComputerUseSettings()).persistentApprovalAllowed).toBe(
      false,
    );
  });
});

it("preserves independent adapter flags and refuses unconfirmed target approval", async () => {
  await setComputerUseEnabled(true, false, "chrome");
  expect(config.features).toEqual({
    computer_use: false,
    chrome_use: true,
    other: true,
  });
  await setComputerUseEnabled(true, false, "office");
  expect(config.features?.computer_use).toBe(false);
  expect((await getComputerUseSettings()).enabled).toEqual({
    native: false,
    chrome: true,
    office: true,
  });
  const target = {
    type: "office" as const,
    host: "Excel",
    sessionId: "session",
    workbookId: "book",
  };
  api.setup.mockResolvedValue({
    accepted: true,
    status: { readiness: "ready" },
  });
  await expect(setupComputerUseAdapter("office", target)).rejects.toThrow(
    "not approved",
  );
});
