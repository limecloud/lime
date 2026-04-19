import { describe, expect, it } from "vitest";
import type { SkillCatalogSceneEntry } from "@/lib/api/skillCatalog";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import {
  matchesRuntimeSceneCommandToServiceSkill,
  matchesRuntimeSceneEntry,
  resolveRuntimeSceneSkillFromEntry,
} from "./runtimeSceneBinding";

function createServiceSkill(
  overrides: Partial<ServiceSkillItem> = {},
): ServiceSkillItem {
  return {
    id: "x-article-export",
    skillKey: "x-article-export",
    title: "X 文章转存",
    summary: "把 X 长文导出成 Markdown。",
    category: "站点采集",
    outputHint: "Markdown 正文 + 图片目录",
    source: "local_custom",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    slotSchema: [],
    version: "seed-v1",
    sceneBinding: {
      sceneKey: "x-article-export",
      commandPrefix: "/x文章转存",
      aliases: ["x文章转存", "x转存"],
    },
    ...overrides,
  };
}

describe("runtimeSceneBinding", () => {
  it("scene entry 匹配应支持 sceneKey、commandPrefix 与 alias", () => {
    const entry = {
      sceneKey: "campaign-launch",
      commandPrefix: "/campaign-launch",
      aliases: ["campaign", "launch"],
    } as SkillCatalogSceneEntry;

    expect(matchesRuntimeSceneEntry(entry, "campaign-launch")).toBe(true);
    expect(matchesRuntimeSceneEntry(entry, "/campaign-launch")).toBe(true);
    expect(matchesRuntimeSceneEntry(entry, "campaign")).toBe(true);
    expect(matchesRuntimeSceneEntry(entry, "other")).toBe(false);
  });

  it("应支持用 scene command token 命中 service skill 的 sceneBinding", () => {
    const skill = createServiceSkill();

    expect(
      matchesRuntimeSceneCommandToServiceSkill(skill, {
        key: "x-article-export",
        commandPrefix: "/x文章转存",
        aliases: ["x转存"],
      }),
    ).toBe(true);
    expect(
      matchesRuntimeSceneCommandToServiceSkill(skill, {
        key: "other-scene",
        commandPrefix: "/other-scene",
        aliases: ["other"],
      }),
    ).toBe(false);
  });

  it("scene entry 缺失 linkedSkillId 时，仍应通过 sceneBinding 回落命中 skill", () => {
    const skill = createServiceSkill({
      id: "site-skill-x-export",
      skillKey: "site-skill-x-export",
    });
    const entry = {
      id: "scene:x-export",
      sceneKey: "x-article-export",
      commandPrefix: "/x文章转存",
      aliases: ["x转存"],
      linkedSkillId: undefined,
    } as SkillCatalogSceneEntry;

    expect(resolveRuntimeSceneSkillFromEntry([skill], entry)).toBe(skill);
  });
});
