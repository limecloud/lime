// @vitest-environment node
/* global process */
import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  const storage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().slice(10)),
  };
  return {
    app: {
      name: "Lime",
      commandLine: {
        getSwitchValue: vi.fn(() => ""),
        appendSwitch: vi.fn(),
      },
    },
    storage,
    readStorage: vi.fn(() => storage),
  };
});

vi.mock("node:module", () => ({
  createRequire: () => (name: string) => {
    if (name !== "electron") throw new Error(`Unexpected module: ${name}`);
    return {
      app: native.app,
      get safeStorage() {
        return native.readStorage();
      },
    };
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  native.app.commandLine.getSwitchValue.mockReturnValue("");
});

afterEach(() => vi.unstubAllGlobals());

describe("Electron runtime safe storage", () => {
  it("importing the host does not initialize native safe storage", async () => {
    const { app } = await import("./electronRuntime");
    expect(app).toBe(native.app);
    expect(native.readStorage).not.toHaveBeenCalled();
  });

  it("macOS disables the unused native keychain provider while preserving other feature flags", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    native.app.commandLine.getSwitchValue.mockReturnValue(
      "OtherFeature,UseKeychainKeyProvider",
    );

    await import("./electronRuntime");

    expect(native.app.commandLine.appendSwitch).toHaveBeenCalledExactlyOnceWith(
      "disable-features",
      "OtherFeature,UseKeychainKeyProvider",
    );
    expect(native.readStorage).not.toHaveBeenCalled();
  });

  it.each(["win32", "linux"])(
    "%s retains its native encryption configuration",
    async (platform) => {
      vi.stubGlobal("process", { ...process, platform });

      await import("./electronRuntime");

      expect(native.app.commandLine.appendSwitch).not.toHaveBeenCalled();
    },
  );

  it("delegates explicit encryption requests to the native backend", async () => {
    const { safeStorage } = await import("./electronRuntime");
    expect(native.readStorage).not.toHaveBeenCalled();
    expect(safeStorage.isEncryptionAvailable()).toBe(true);
    const encrypted = safeStorage.encryptString("synthetic-secret");
    expect(safeStorage.decryptString(encrypted)).toBe("synthetic-secret");
    expect(native.readStorage).toHaveBeenCalledTimes(3);
    expect(native.storage.isEncryptionAvailable).toHaveBeenCalledOnce();
    expect(native.storage.encryptString).toHaveBeenCalledWith(
      "synthetic-secret",
    );
    expect(native.storage.decryptString).toHaveBeenCalledWith(encrypted);
  });
});
