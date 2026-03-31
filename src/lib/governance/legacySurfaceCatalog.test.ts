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

  it("应将旧海报素材命令与 helper 收敛到图库主链", () => {
    expect(agentCommandCatalog.deprecatedCommandReplacements).toMatchObject({
      create_poster_metadata: "create_gallery_material_metadata",
      get_poster_metadata: "get_gallery_material_metadata",
      get_poster_material: "get_gallery_material",
      update_poster_metadata: "update_gallery_material_metadata",
      delete_poster_metadata: "delete_gallery_material_metadata",
      list_by_image_category: "list_gallery_materials_by_image_category",
      list_by_layout_category: "list_gallery_materials_by_layout_category",
      list_by_mood: "list_gallery_materials_by_mood",
    });
    expect(agentCommandCatalog.deprecatedHelperReplacements).toMatchObject({
      getPosterMaterial: "getGalleryMaterial",
      createPosterMetadata: "createGalleryMetadata",
      updatePosterMetadata: "updateGalleryMetadata",
      deletePosterMetadata: "deleteGalleryMetadata",
      listPosterMaterialsByImageCategory: "listGalleryMaterialsByImageCategory",
      listPosterMaterialsByLayoutCategory:
        "listGalleryMaterialsByLayoutCategory",
      listPosterMaterialsByMood: "listGalleryMaterialsByMood",
      usePosterMaterial: "useGalleryMaterial",
    });
  });

  it("应禁止 SkillSelectorPanel 旧面板路径重新回流", () => {
    const legacyPanelPath = `./${"SkillSelectorPanel"}`;
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-skill-selector-panel-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual(
      expect.arrayContaining([
        `from "${legacyPanelPath}"`,
        `import('${legacyPanelPath}')`,
      ]),
    );
  });

  it("应禁止技能入口重新回到扁平 props 透传与扁平契约", () => {
    const parentMonitorIds = [
      "inputbar-composer-flat-skill-parent-props",
      "empty-state-composer-flat-skill-parent-props",
    ];
    const contractMonitorIds = [
      "inputbar-composer-flat-skill-prop-contract",
      "empty-state-composer-flat-skill-prop-contract",
    ];

    for (const monitorId of [...parentMonitorIds, ...contractMonitorIds]) {
      const monitor = legacySurfaceCatalogJson.frontendText.find(
        (entry) => entry.id === monitorId,
      );

      expect(monitor).toBeTruthy();
      expect(monitor?.classification).toBe("dead-candidate");
      expect(monitor?.allowedPaths).toEqual([]);
      expect(
        (monitor?.patterns?.length ?? 0) + (monitor?.regexPatterns?.length ?? 0),
      ).toBeGreaterThan(0);
    }
  });

  it("应禁止运行时代码绕过 useActiveSkill 直接构造 skillSelection", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "skill-selection-direct-construction-runtime-usage",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.patterns).toEqual(["createSkillSelectionProps("]);
    expect(monitor?.allowedPaths).toEqual([
      "src/components/agent/chat/components/Inputbar/components/skillSelectionBindings.ts",
      "src/components/agent/chat/components/Inputbar/hooks/useActiveSkill.ts",
    ]);
  });

  it("应禁止 EmptyState 重新直读本地 activeSkill hook 状态", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-local-active-skill-hook-usage",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.regexPatterns).toEqual([
      "(?<!\\.)\\bactiveSkill\\s*[,}]",
      "(?<!\\.)\\bclearActiveSkill\\s*[,}]",
    ]);
  });

  it("应禁止技能入口旧展示文案重新回到页面层手写", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "skill-selection-legacy-display-copy",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
      "src/components/agent/chat/components/Inputbar/components/SkillSelector.tsx",
    ]);
    expect(monitor?.patterns).toEqual(
      expect.arrayContaining([
        "当前技能 ",
        "当前已启用 ",
        "为当前任务挂载额外能力",
        "按需挂载能力",
        "项技能可用",
      ]),
    );
  });

  it("应禁止旧海报素材入口与 Rust 符号重新回流", () => {
    const importMonitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "gallery-material-legacy-frontend-module",
    );
    const frontendMonitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "gallery-material-legacy-helper-usage",
    );
    const rustMonitor = legacySurfaceCatalogJson.rustText.find(
      (entry) => entry.id === "rust-gallery-material-legacy-symbols",
    );

    expect(importMonitor).toBeTruthy();
    expect(importMonitor?.allowedPaths).toEqual([]);
    expect(importMonitor?.targets).toEqual(
      expect.arrayContaining([
        "src/lib/api/posterMaterials.ts",
        "src/hooks/usePosterMaterial.ts",
        "src/types/poster-material.ts",
      ]),
    );

    expect(frontendMonitor).toBeTruthy();
    expect(frontendMonitor?.classification).toBe("dead-candidate");
    expect(frontendMonitor?.patterns).toEqual(
      expect.arrayContaining([
        "getPosterMaterial(",
        "createPosterMetadata(",
        "usePosterMaterial(",
      ]),
    );

    expect(rustMonitor).toBeTruthy();
    expect(rustMonitor?.allowedPaths).toEqual([
      "src-tauri/crates/core/src/database/schema.rs",
    ]);
    expect(rustMonitor?.patterns).toEqual(
      expect.arrayContaining([
        "PosterMaterialDao",
        "poster_material_metadata",
        "idx_poster_material_metadata_",
      ]),
    );
  });
});
