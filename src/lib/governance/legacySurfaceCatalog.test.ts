import { describe, expect, it } from "vitest";

import agentCommandCatalog from "./agentCommandCatalog.json";
import legacySurfaceCatalogJson from "./legacySurfaceCatalog.json";

describe("legacySurfaceCatalog", () => {
  it("应提供完整且无重复的治理扫描目录册", () => {
    const catalog = legacySurfaceCatalogJson;
    const groups = [
      catalog.imports,
      catalog.commands,
      catalog.frontendText,
      catalog.rustText,
      catalog.rustTextCounts,
    ];

    expect(groups.every(Array.isArray)).toBe(true);
    expect(catalog.imports.length).toBeGreaterThan(0);
    expect(catalog.commands.length).toBeGreaterThan(0);
    expect(catalog.frontendText.length).toBeGreaterThan(0);
    expect(catalog.rustText.length).toBeGreaterThan(0);
    expect(catalog.rustTextCounts.length).toBeGreaterThan(0);

    const ids = groups.flat().map((monitor) => monitor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("命令目录册不应继续携带 legacy surface 扫描数据", () => {
    expect("legacyCommandSurfaceMonitors" in agentCommandCatalog).toBe(false);
    expect("legacyHelperSurfaceMonitors" in agentCommandCatalog).toBe(false);
  });
});
