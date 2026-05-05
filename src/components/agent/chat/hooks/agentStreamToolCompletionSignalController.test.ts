import { describe, expect, it } from "vitest";
import { hasMeaningfulAgentStreamToolCompletionSignal } from "./agentStreamToolCompletionSignalController";

describe("agentStreamToolCompletionSignalController", () => {
  it("应把站点保存 metadata 视为有意义完成信号", () => {
    expect(
      hasMeaningfulAgentStreamToolCompletionSignal({
        toolId: "site-tool",
        toolName: "lime_site_run",
        normalizedResult: {
          metadata: {
            saved_project_id: "project-a",
          },
        },
      }),
    ).toBe(true);
  });

  it("应把图片任务 metadata 视为有意义完成信号", () => {
    expect(
      hasMeaningfulAgentStreamToolCompletionSignal({
        toolId: "image-tool",
        toolName: "lime_create_image_generation_task",
        normalizedResult: {
          metadata: {
            task_id: "task-a",
            task_type: "image_generate",
            status: "running",
          },
        },
      }),
    ).toBe(true);
  });

  it("普通空结果不应视为有意义完成信号", () => {
    expect(
      hasMeaningfulAgentStreamToolCompletionSignal({
        toolId: "plain-tool",
        toolName: "plain_tool",
        normalizedResult: {
          metadata: {
            status: "ok",
          },
        },
      }),
    ).toBe(false);
    expect(
      hasMeaningfulAgentStreamToolCompletionSignal({
        toolId: "plain-tool",
        toolName: "plain_tool",
        normalizedResult: undefined,
      }),
    ).toBe(false);
  });
});
