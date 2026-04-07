/**
 * @file 项目 API 集成测试
 * @description 验证项目类型已收口到 current 主路径 general
 * @module lib/api/project-integration.test
 */

import { describe, expect, it } from "vitest";
import {
  TYPE_CONFIGS,
  USER_PROJECT_TYPES,
  normalizeProject,
  type ProjectType,
} from "./project";
import type { ThemeType } from "@/lib/workspace/workbenchContract";

describe("Project API 集成测试", () => {
  it("ProjectType 当前只保留 persistent / temporary / general", () => {
    const allTypes: ProjectType[] = ["persistent", "temporary", "general"];

    allTypes.forEach((type) => {
      expect(TYPE_CONFIGS[type]).toBeDefined();
      expect(TYPE_CONFIGS[type].label).toBeTruthy();
      expect(TYPE_CONFIGS[type].icon).toBeTruthy();
    });

    expect(Object.keys(TYPE_CONFIGS)).toHaveLength(3);
  });

  it("ThemeType 与 USER_PROJECT_TYPES 应统一收口为 general", () => {
    const themes: ThemeType[] = ["general"];
    expect(USER_PROJECT_TYPES).toEqual(["general"]);
    themes.forEach((theme) => {
      expect(USER_PROJECT_TYPES).toContain(theme);
    });
  });

  it("general 应保持无专用画布、默认内容类型为 content", () => {
    expect(TYPE_CONFIGS.general.canvasType).toBeNull();
    expect(TYPE_CONFIGS.general.defaultContentType).toBe("content");
  });

  it("历史或未知工作台类型应在前端边界统一回退为 general", () => {
    [
      "legacy-marketing",
      "legacy-research",
      "poster",
      "music",
      "script",
    ].forEach((workspaceType) => {
      expect(
        normalizeProject({
          id: `legacy-${workspaceType}`,
          name: "旧项目",
          workspace_type: workspaceType,
        } as any).workspaceType,
      ).toBe("general");
    });
  });
});
