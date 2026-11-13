import { accountFixture, seedCloudAccount } from "@/test/cloudAccountFixture";
import { describe, expect, it, vi } from "vitest";
import {
  getCloudAccount,
  subscribeCloudAccount,
  readCloudAccount,
  logoutCloudAccount,
  cloudAccountIdentityVersion,
  startCloudAuthorization,
  getCloudAccountState,
} from "./cloudAccount";
const open = vi.hoisted(() => vi.fn());
vi.mock("./api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser: open,
}));
vi.mock("./api/appServerEventBus", () => ({
  subscribeAppServerNotifications: () => () => {},
}));

describe("native cloud account projection", () => {
  it("uses native service metadata for signed-out Desktop and terminal accounts", async () => {
    accountFixture.serviceUrl = "https://native-core.example.test";
    await readCloudAccount();
    expect(getCloudAccountState().serviceUrl).toBe("https://native-core.example.test");
    await startCloudAuthorization({ language: "en-US" });
    expect(accountFixture.login).toHaveBeenLastCalledWith({ type: "cloud", language: "en-US" });
    expect(accountFixture.login.mock.calls[0]?.[0]).not.toHaveProperty("baseUrl");
  });
  it("tracks identity lifetimes and ignores profile-only changes", async () => {
    await seedCloudAccount();
    const initial = cloudAccountIdentityVersion();
    await seedCloudAccount({ displayName: "Updated" });
    expect(cloudAccountIdentityVersion()).toBe(initial);
    await seedCloudAccount({ userId: "other" });
    await seedCloudAccount();
    expect(cloudAccountIdentityVersion()).toBe(initial + 2);
    await seedCloudAccount({ generation: "new-login" });
    expect(cloudAccountIdentityVersion()).toBe(initial + 3);
  });
  it("passes resource authorization to native RPC and opens only its public URL", async () => {
    await seedCloudAccount();
    await startCloudAuthorization({ language: "zh-CN", resource: "market" });
    expect(accountFixture.login).toHaveBeenCalledWith({
      type: "cloud",
      resource: "market",
      language: "zh-CN",
    });
    expect(open).toHaveBeenCalledWith(
      "https://identity.example.test/authorize?state=public-state",
    );
    expect(accountFixture.login.mock.calls[0]?.[0]).not.toHaveProperty(
      "accessToken",
    );
  });
  it("does not restore an old read after logout or erase the account on a failed logout", async () => {
    await seedCloudAccount();
    accountFixture.logout.mockRejectedValueOnce(new Error("unavailable"));
    await expect(logoutCloudAccount()).rejects.toThrow("unavailable");
    expect(getCloudAccount()).not.toBeNull();
    const old = accountFixture.account;
    let finish!: (value: unknown) => void;
    accountFixture.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = readCloudAccount();
    await logoutCloudAccount();
    finish({ account: old, authorizations: [] });
    await pending;
    expect(getCloudAccount()).toBeNull();
  });
  it("publishes stable metadata without browser persistence", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await seedCloudAccount();
    const listener = vi.fn();
    const dispose = subscribeCloudAccount(listener);
    await readCloudAccount();
    await readCloudAccount();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
    dispose();
    storage.mockRestore();
  });
});
