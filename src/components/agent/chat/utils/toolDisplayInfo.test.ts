import { describe, expect, it } from "vitest";

import {
  extractSearchQueryLabel,
  normalizeToolNameKey,
  resolveToolDisplayLabel,
} from "./toolDisplayInfo";

const REFERENCE_JS_TOOL_NAME_MAPPINGS = [
  ["AgentTool", "agent"],
  ["AskUserQuestionTool", "askuserquestion"],
  ["BashTool", "bash"],
  ["BriefTool", "sendusermessage"],
  ["ConfigTool", "config"],
  ["EnterPlanModeTool", "enterplanmode"],
  ["EnterWorktreeTool", "enterworktree"],
  ["ExitPlanModeTool", "exitplanmode"],
  ["ExitWorktreeTool", "exitworktree"],
  ["FileEditTool", "edit"],
  ["FileReadTool", "read"],
  ["FileWriteTool", "write"],
  ["GlobTool", "glob"],
  ["GrepTool", "grep"],
  ["LSPTool", "lsp"],
  ["ListMcpResourcesTool", "listmcpresources"],
  ["NotebookEditTool", "notebookedit"],
  ["PowerShellTool", "powershell"],
  ["ReadMcpResourceTool", "readmcpresource"],
  ["RemoteTriggerTool", "remotetrigger"],
  ["ScheduleCronTool", "croncreate"],
  ["SendMessageTool", "sendmessage"],
  ["SkillTool", "skill"],
  ["SleepTool", "sleep"],
  ["SyntheticOutputTool", "structuredoutput"],
  ["TaskCreateTool", "taskcreate"],
  ["TaskGetTool", "taskget"],
  ["TaskListTool", "tasklist"],
  ["TaskOutputTool", "taskoutput"],
  ["TaskStopTool", "taskstop"],
  ["TaskUpdateTool", "taskupdate"],
  ["TeamCreateTool", "teamcreate"],
  ["TeamDeleteTool", "teamdelete"],
  ["ToolSearchTool", "toolsearch"],
  ["WebFetchTool", "webfetch"],
  ["WebSearchTool", "websearch"],
] as const;

describe("toolDisplayInfo", () => {
  it("应把参考 JS 工具目录名归一化为现役展示键", () => {
    for (const [toolName, expected] of REFERENCE_JS_TOOL_NAME_MAPPINGS) {
      expect(normalizeToolNameKey(toolName)).toBe(expected);
    }

    expect(normalizeToolNameKey("RequestUserInputTool")).toBe(
      "askuserquestion",
    );
    expect(normalizeToolNameKey("AgentOutputTool")).toBe("taskoutput");
    expect(normalizeToolNameKey("BashOutputTool")).toBe("taskoutput");
  });

  it("应为参考 JS 工具目录名解析出当前展示文案", () => {
    expect(resolveToolDisplayLabel("AskUserQuestionTool")).toBe("用户确认");
    expect(resolveToolDisplayLabel("BriefTool")).toBe("用户消息");
    expect(resolveToolDisplayLabel("FileReadTool")).toBe("文件读取");
    expect(resolveToolDisplayLabel("lime_search_web_images")).toBe("联网搜图");
    expect(resolveToolDisplayLabel("AgentTool")).toBe("创建子任务");
    expect(resolveToolDisplayLabel("SendMessageTool")).toBe("补充说明");
    expect(resolveToolDisplayLabel("TeamCreateTool")).toBe("创建团队");
    expect(resolveToolDisplayLabel("TeamDeleteTool")).toBe("删除团队");
    expect(resolveToolDisplayLabel("ScheduleCronTool")).toBe("定时触发器");
    expect(resolveToolDisplayLabel("SyntheticOutputTool")).toBe("最终答复");
    expect(resolveToolDisplayLabel("AgentOutputTool")).toBe("任务输出");
    expect(resolveToolDisplayLabel("BashOutputTool")).toBe("任务输出");
  });

  it("应隐藏 ToolSearch 中的内部协议查询词", () => {
    expect(
      extractSearchQueryLabel({
        id: "tool-1",
        name: "ToolSearch",
        arguments: JSON.stringify({ query: "select:StructuredOutput" }),
        status: "completed",
        startTime: new Date("2026-04-09T00:00:00.000Z"),
      }),
    ).toBe("内部流程");
  });
});
