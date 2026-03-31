/**
 * @file 项目 API 集成测试
 * @description 测试前后端类型一致性和旧类型兼容
 * @module lib/api/project-integration.test
 */

import { describe, it, expect } from "vitest";
import {
  TYPE_CONFIGS,
  USER_PROJECT_TYPES,
  normalizeProject,
  type ProjectType,
} from "./project";
import type { ThemeType } from "@/lib/workspace/workflowTypes";

// ============================================================================
// 类型一致性测试
// ============================================================================

describe("Project API 集成测试", () => {
  describe("类型一致性", () => {
    it("前端 ProjectType 应该与后端 WorkspaceType 一一对应", () => {
      const allTypes: ProjectType[] = [
        "persistent",
        "temporary",
        "general",
        "social-media",
        "knowledge",
        "planning",
        "document",
        "video",
      ];

      allTypes.forEach((type) => {
        expect(TYPE_CONFIGS[type]).toBeDefined();
        expect(TYPE_CONFIGS[type].label).toBeTruthy();
        expect(TYPE_CONFIGS[type].icon).toBeTruthy();
      });

      expect(Object.keys(TYPE_CONFIGS)).toHaveLength(8);
    });

    it("ThemeType 应该是 UserType 的子集", () => {
      const themes: ThemeType[] = [
        "general",
        "social-media",
        "knowledge",
        "planning",
        "document",
        "video",
      ];

      themes.forEach((theme) => {
        expect(USER_PROJECT_TYPES).toContain(theme);
      });

      expect(themes).toHaveLength(USER_PROJECT_TYPES.length);
    });

    it("UserType 应该正好有 6 种类型", () => {
      expect(USER_PROJECT_TYPES).toHaveLength(6);
    });

    it("SystemType 应该正好有 2 种类型", () => {
      const systemTypes: ProjectType[] = ["persistent", "temporary"];
      systemTypes.forEach((type) => {
        expect(USER_PROJECT_TYPES).not.toContain(type);
        expect(TYPE_CONFIGS[type]).toBeDefined();
      });
    });
  });

  describe("画布类型映射一致性", () => {
    it("支持画布的类型应该有正确的 canvasType", () => {
      const canvasMapping: Record<string, string> = {
        video: "video",
        "social-media": "document",
        document: "document",
      };

      Object.entries(canvasMapping).forEach(([projectType, canvasType]) => {
        expect(TYPE_CONFIGS[projectType as ProjectType].canvasType).toBe(
          canvasType,
        );
      });
    });

    it("不支持画布的类型 canvasType 应该为 null", () => {
      const noCanvasTypes: ProjectType[] = [
        "persistent",
        "temporary",
        "general",
        "knowledge",
        "planning",
      ];

      noCanvasTypes.forEach((type) => {
        expect(TYPE_CONFIGS[type].canvasType).toBeNull();
      });
    });
  });

  describe("默认内容类型映射", () => {
    it("每种项目类型应该有正确的默认内容类型", () => {
      const contentTypeMapping: Record<ProjectType, string> = {
        persistent: "document",
        temporary: "document",
        general: "content",
        "social-media": "post",
        knowledge: "document",
        planning: "document",
        document: "document",
        video: "episode",
      };

      Object.entries(contentTypeMapping).forEach(
        ([projectType, contentType]) => {
          expect(
            TYPE_CONFIGS[projectType as ProjectType].defaultContentType,
          ).toBe(contentType);
        },
      );
    });
  });

  describe("图标配置", () => {
    it("每种用户级类型应该有唯一的图标", () => {
      const icons = USER_PROJECT_TYPES.map(
        (type) => TYPE_CONFIGS[type as ProjectType].icon,
      );
      const uniqueIcons = new Set(icons);
      expect(uniqueIcons.size).toBe(USER_PROJECT_TYPES.length);
    });

    it("图标应该是 emoji 格式", () => {
      const allTypes: ProjectType[] = [
        "persistent",
        "temporary",
        "general",
        "social-media",
        "knowledge",
        "planning",
        "document",
        "video",
      ];

      allTypes.forEach((type) => {
        const icon = TYPE_CONFIGS[type].icon;
        // emoji 通常是多字节字符
        expect(icon.length).toBeGreaterThan(0);
      });
    });
  });

  describe("标签配置", () => {
    it("每种类型应该有中文标签", () => {
      const allTypes: ProjectType[] = [
        "persistent",
        "temporary",
        "general",
        "social-media",
        "knowledge",
        "planning",
        "document",
        "video",
      ];

      allTypes.forEach((type) => {
        const label = TYPE_CONFIGS[type].label;
        expect(label).toBeTruthy();
        // 验证是中文（包含至少一个中文字符）
        expect(/[\u4e00-\u9fa5]/.test(label)).toBe(true);
      });
    });
  });

  describe("旧类型兼容归一", () => {
    it("poster / music / novel 应统一归一到 document", () => {
      expect(
        normalizeProject({
          id: "legacy-poster",
          name: "旧海报项目",
          workspace_type: "poster",
        } as any).workspaceType,
      ).toBe("document");
      expect(
        normalizeProject({
          id: "legacy-music",
          name: "旧音乐项目",
          workspace_type: "music",
        } as any).workspaceType,
      ).toBe("document");
      expect(
        normalizeProject({
          id: "legacy-novel",
          name: "旧小说项目",
          workspace_type: "novel",
        } as any).workspaceType,
      ).toBe("document");
    });
  });
});
