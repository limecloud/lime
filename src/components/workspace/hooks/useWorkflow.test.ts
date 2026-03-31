/**
 * @file useWorkflow 步骤定义测试
 * @description 测试工作流步骤定义与文件映射的一致性
 * @module components/workspace/hooks/useWorkflow.test
 */

import { describe, it, expect } from "vitest";
import { getWorkflowSteps } from "./useWorkflow";
import { getFileToStepMap } from "@/components/agent/chat/utils/workflowMapping";
import type { CreationMode, ThemeType } from "@/lib/workspace/workflowTypes";

describe("getWorkflowSteps", () => {
  describe("social-media 主题", () => {
    it("guided 模式应该返回 4 个步骤", () => {
      expect(getWorkflowSteps("social-media", "guided")).toHaveLength(4);
    });

    it("fast 模式应该返回 3 个步骤", () => {
      expect(getWorkflowSteps("social-media", "fast")).toHaveLength(3);
    });
  });

  describe("video 主题", () => {
    it("guided 模式应该返回 5 个步骤", () => {
      expect(getWorkflowSteps("video", "guided")).toHaveLength(5);
    });

    it("fast 模式应该返回 3 个步骤", () => {
      expect(getWorkflowSteps("video", "fast")).toHaveLength(3);
    });
  });

  describe("document 主题", () => {
    it("guided 模式应该返回 4 个步骤", () => {
      expect(getWorkflowSteps("document", "guided")).toHaveLength(4);
    });

    it("fast 模式应该返回 3 个步骤", () => {
      expect(getWorkflowSteps("document", "fast")).toHaveLength(3);
    });
  });

  describe("无工作流主题", () => {
    const themesWithoutWorkflow: ThemeType[] = [
      "general",
      "knowledge",
      "planning",
    ];

    themesWithoutWorkflow.forEach((theme) => {
      it(`${theme} 应该返回空数组`, () => {
        expect(getWorkflowSteps(theme, "guided")).toEqual([]);
      });
    });
  });
});

describe("getWorkflowSteps 与 getFileToStepMap 一致性", () => {
  const themesWithWorkflow: ThemeType[] = [
    "social-media",
    "video",
    "document",
  ];
  const modes: CreationMode[] = ["guided", "fast"];

  themesWithWorkflow.forEach((theme) => {
    modes.forEach((mode) => {
      it(`${theme} (${mode}) 的文件映射最大索引应该 < guided 步骤数量`, () => {
        const guidedSteps = getWorkflowSteps(theme, "guided");
        const fileMap = getFileToStepMap(theme);
        const maxFileIndex = Math.max(...Object.values(fileMap), -1);
        expect(maxFileIndex).toBeLessThan(guidedSteps.length);
      });
    });
  });
});

describe("步骤属性", () => {
  const themesWithWorkflow: ThemeType[] = [
    "social-media",
    "video",
    "document",
  ];

  themesWithWorkflow.forEach((theme) => {
    it(`${theme} 的第一步应该不可跳过`, () => {
      const steps = getWorkflowSteps(theme, "guided");
      expect(steps[0]?.behavior.skippable).toBe(false);
    });
  });
});
