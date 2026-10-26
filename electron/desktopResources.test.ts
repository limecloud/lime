// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDesktopResourcesRoot } from "./desktopResources";

describe("desktop native resource ownership", () => {
  it("uses the current app source for a branded default-app host regardless of isPackaged or cwd", () => {
    expect(
      resolveDesktopResourcesRoot({
        isPackaged: true,
        defaultApp: true,
        resourcesPath: "/dev/Lime.app/Contents/Resources",
        appPath: "/source/lime",
      }),
    ).toBe(path.resolve("/source/lime/dist-electron"));
  });
  it("keeps packaged resources in the signed bundle and never falls back to source", () => {
    expect(
      resolveDesktopResourcesRoot({
        isPackaged: true,
        resourcesPath: "/Applications/Lime.app/Contents/Resources",
        appPath: "/source/lime",
      }),
    ).toBe(path.resolve("/Applications/Lime.app/Contents/Resources"));
    expect(
      resolveDesktopResourcesRoot({
        isPackaged: true,
        appPath: "/source/lime",
      }),
    ).toBeNull();
  });
});
