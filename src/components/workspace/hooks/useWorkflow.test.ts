/**
 * @file useWorkflow 步骤定义测试
 * @description 验证统一 general 工作台不再返回旧主题工作流步骤
 * @module components/workspace/hooks/useWorkflow.test
 */

import { describe, expect, it } from "vitest";
import { getWorkflowSteps } from "./useWorkflow";
import { getFileToStepMap } from "@/components/agent/chat/utils/workflowMapping";
import type { CreationMode } from "@/lib/workspace/workflowTypes";

describe("getWorkflowSteps", () => {
  const modes: CreationMode[] = ["guided", "fast", "hybrid", "framework"];

  modes.forEach((mode) => {
    it(`general 在 ${mode} 模式下应返回空步骤`, () => {
      expect(getWorkflowSteps("general", mode)).toEqual([]);
    });
  });
});

describe("getWorkflowSteps 与 getFileToStepMap 一致性", () => {
  it("general 的文件映射最大索引应保持为空", () => {
    expect(getFileToStepMap("general")).toEqual({});
    expect(getWorkflowSteps("general", "guided")).toHaveLength(0);
  });
});
