import { describe, expect, it } from "vitest";
import { getSeededServiceSkillCatalog } from "@/lib/api/serviceSkills";
import { compileCommandCatalogProjection } from "./compat/commandCatalogProjection";
import { createSeededCommandCatalogBaseSetupPackage } from "./seededCommandPackage";
import { SEEDED_SERVICE_SKILL_CATALOG_VERSION } from "./seededServiceSkillPackage";

describe("seededCommandPackage", () => {
  it("应提供 seeded command 的基础设置包事实源", () => {
    const pkg = createSeededCommandCatalogBaseSetupPackage();

    expect(pkg.id).toBe("lime-seeded-command-catalog");
    expect(pkg.version).toBe(SEEDED_SERVICE_SKILL_CATALOG_VERSION);
    expect(pkg.catalogProjections).toHaveLength(32);
    expect(pkg.bindingProfiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining([
        "agent-turn-instant",
        "native-skill-instant",
        "cloud-scene-instant",
      ]),
    );
  });

  it("应把 seeded command 包编译成与当前命令目录一致的 command entries", () => {
    const entries = compileCommandCatalogProjection(
      createSeededCommandCatalogBaseSetupPackage(),
      getSeededServiceSkillCatalog().items,
    );

    expect(entries).toHaveLength(32);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "command:image_generate",
          commandKey: "image_generate",
          binding: {
            skillId: "image_generate",
            executionKind: "task_queue",
          },
          renderContract: expect.objectContaining({
            resultKind: "image_gallery",
            detailKind: "media_detail",
          }),
        }),
        expect.objectContaining({
          id: "command:voice_runtime",
          commandKey: "voice_runtime",
          binding: {
            skillId: "cloud-video-dubbing",
            executionKind: "cloud_scene",
          },
          renderContract: expect.objectContaining({
            resultKind: "tool_timeline",
            detailKind: "scene_detail",
          }),
        }),
        expect.objectContaining({
          id: "command:typesetting",
          commandKey: "typesetting",
          binding: {
            skillId: "typesetting",
            executionKind: "cli",
          },
          renderContract: expect.objectContaining({
            resultKind: "tool_timeline",
            detailKind: "task_detail",
          }),
        }),
      ]),
    );
  });
});
