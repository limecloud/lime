/**
 * @file 工作流文件映射测试
 * @description 测试 getFileToStepMap 及相关工具函数
 * @module components/agent/chat/utils/workflowMapping.test
 */

import { describe, it, expect } from "vitest";
import {
  getFileToStepMap,
  getSupportedFilenames,
  getStepIndexForFile,
  isWorkflowFile,
} from "./workflowMapping";
import type { ThemeType } from "@/lib/workspace/workflowTypes";

describe("getFileToStepMap", () => {
  it("应该返回 social-media 的文件映射", () => {
    const map = getFileToStepMap("social-media");
    expect(map).toEqual({
      "brief.md": 0,
      "draft.md": 1,
      "article.md": 2,
      "adapted.md": 3,
    });
  });

  it("应该返回 video 的文件映射", () => {
    const map = getFileToStepMap("video");
    expect(map).toEqual({
      "brief.md": 0,
      "outline.md": 1,
      "storyboard.md": 2,
      "script.md": 3,
      "script-final.md": 4,
    });
  });

  it("应该返回 document 的文件映射", () => {
    const map = getFileToStepMap("document");
    expect(map).toEqual({
      "brief.md": 0,
      "outline.md": 1,
      "draft.md": 2,
      "article.md": 3,
    });
  });

  it("无工作流主题应返回空映射", () => {
    expect(getFileToStepMap("general")).toEqual({});
    expect(getFileToStepMap("knowledge")).toEqual({});
    expect(getFileToStepMap("planning")).toEqual({});
  });

  it("应该覆盖所有 ThemeType", () => {
    const allThemes: ThemeType[] = [
      "general",
      "social-media",
      "knowledge",
      "planning",
      "document",
      "video",
    ];

    allThemes.forEach((theme) => {
      expect(() => getFileToStepMap(theme)).not.toThrow();
    });
  });
});

describe("workflowMapping helpers", () => {
  it("应该返回支持的文件名列表", () => {
    expect(getSupportedFilenames("document")).toEqual([
      "brief.md",
      "outline.md",
      "draft.md",
      "article.md",
    ]);
  });

  it("应该识别工作流文件", () => {
    expect(isWorkflowFile("video", "script.md")).toBe(true);
    expect(isWorkflowFile("video", "draft.md")).toBe(false);
  });

  it("应该返回文件对应的步骤索引", () => {
    expect(getStepIndexForFile("social-media", "article.md")).toBe(2);
    expect(getStepIndexForFile("document", "article.md")).toBe(3);
    expect(getStepIndexForFile("planning", "article.md")).toBeUndefined();
  });
});
