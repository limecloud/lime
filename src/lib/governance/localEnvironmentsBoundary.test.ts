import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "./legacySurfaceCatalog.json";

describe("Local Environments current boundary", () => {
  it("retires the process preview UI and capability aggregate without wrappers", () => {
    const retired = catalog.imports.find(
      ({ id }) => id === "retired-environment-preview",
    );
    expect(retired?.classification).toBe("dead");
    expect(retired?.allowedPaths).toEqual([]);
    expect(retired?.targets.length).toBeGreaterThan(0);
    for (const target of retired?.targets ?? []) {
      expect(existsSync(path.resolve(target)), target).toBe(false);
    }
    for (const file of [
      "src/lib/api/appConfig.ts",
      "src/lib/api/appConfigTypes.ts",
      "electron/systemUtilityHost.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /getEnvironmentPreview|EnvironmentPreview|DesktopCapabilities|DesktopCapability/,
      );
    }
  });
});
