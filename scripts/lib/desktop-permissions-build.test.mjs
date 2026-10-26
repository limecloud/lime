// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { compileDesktopPermissions } from "./desktop-permissions-build.mjs";

vi.mock("node:fs", () => ({ existsSync: vi.fn(() => false) }));

describe("permission binding cold build", () => {
  it("uses the existing Forge installer for missing official Electron headers and keeps its cache in the repository", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const execute = vi.fn();
    compileDesktopPermissions({
      outputPath: "/fixture/desktop-permissions.node",
      arch: "arm64",
      execFileSyncImpl: execute,
    });
    const [install, compile] = execute.mock.calls;
    expect(install[0]).toBe(process.execPath);
    expect(install[1][0]).toMatch(/@electron\/node-gyp\/bin\/node-gyp\.js$/);
    expect(install[1]).toEqual(
      expect.arrayContaining([
        "install",
        "--dist-url=https://electronjs.org/headers",
        expect.stringMatching(/--devdir=.*lime\/\.lime\/cache\/node-headers$/),
      ]),
    );
    expect(compile[0]).toBe("clang++");
    expect(compile[1]).toEqual(
      expect.arrayContaining([
        "-arch",
        "arm64",
        "UserNotifications",
        "CoreLocation",
        "/fixture/desktop-permissions.node",
      ]),
    );
  });
});
