/**
 * @file 工作流文件映射测试
 * @description 验证统一 general 工作台不再维护旧主题文件映射
 * @module components/agent/chat/utils/workflowMapping.test
 */

import { describe, expect, it } from "vitest";
import {
  getFileToStepMap,
  getStepIndexForFile,
  getSupportedFilenames,
  isWorkflowFile,
} from "./workflowMapping";

describe("workflowMapping", () => {
  it("general 主题应返回空映射", () => {
    expect(getFileToStepMap("general")).toEqual({});
  });

  it("不应再暴露旧工作流文件名", () => {
    expect(getSupportedFilenames("general")).toEqual([]);
  });

  it("任意文件都不应再被识别为旧主题工作流文件", () => {
    expect(isWorkflowFile("general", "brief.md")).toBe(false);
    expect(isWorkflowFile("general", "article.md")).toBe(false);
  });

  it("任意文件都不应再返回旧步骤索引", () => {
    expect(getStepIndexForFile("general", "brief.md")).toBeUndefined();
    expect(getStepIndexForFile("general", "article.md")).toBeUndefined();
  });
});
