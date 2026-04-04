import { describe, expect, it } from "vitest";

import { normalizeLegacyToolSurfaceName } from "./agentTextNormalization";

const REFERENCE_JS_TOOL_SURFACE_MAPPINGS = [
  ["AgentTool", "Agent"],
  ["AskUserQuestionTool", "AskUserQuestion"],
  ["BashTool", "Bash"],
  ["BriefTool", "SendUserMessage"],
  ["ConfigTool", "Config"],
  ["EnterPlanModeTool", "EnterPlanMode"],
  ["EnterWorktreeTool", "EnterWorktree"],
  ["ExitPlanModeTool", "ExitPlanMode"],
  ["ExitWorktreeTool", "ExitWorktree"],
  ["FileEditTool", "Edit"],
  ["FileReadTool", "Read"],
  ["FileWriteTool", "Write"],
  ["GlobTool", "Glob"],
  ["GrepTool", "Grep"],
  ["LSPTool", "LSP"],
  ["ListMcpResourcesTool", "ListMcpResourcesTool"],
  ["NotebookEditTool", "NotebookEdit"],
  ["PowerShellTool", "PowerShell"],
  ["ReadMcpResourceTool", "ReadMcpResourceTool"],
  ["RemoteTriggerTool", "RemoteTrigger"],
  ["ScheduleCronTool", "CronCreate"],
  ["SendMessageTool", "SendMessage"],
  ["SkillTool", "Skill"],
  ["SleepTool", "Sleep"],
  ["SyntheticOutputTool", "StructuredOutput"],
  ["TaskCreateTool", "TaskCreate"],
  ["TaskGetTool", "TaskGet"],
  ["TaskListTool", "TaskList"],
  ["TaskOutputTool", "TaskOutput"],
  ["TaskStopTool", "TaskStop"],
  ["TaskUpdateTool", "TaskUpdate"],
  ["TeamCreateTool", "TeamCreate"],
  ["TeamDeleteTool", "TeamDelete"],
  ["ToolSearchTool", "ToolSearch"],
  ["WebFetchTool", "WebFetch"],
  ["WebSearchTool", "WebSearch"],
] as const;

describe("agentTextNormalization", () => {
  it("应把参考 JS 工具目录名归一化为现役工具面", () => {
    for (const [toolName, expected] of REFERENCE_JS_TOOL_SURFACE_MAPPINGS) {
      expect(normalizeLegacyToolSurfaceName(toolName)).toBe(expected);
    }

    expect(normalizeLegacyToolSurfaceName("RequestUserInputTool")).toBe(
      "AskUserQuestion",
    );
    expect(normalizeLegacyToolSurfaceName("SyntheticOutputTool")).toBe(
      "StructuredOutput",
    );
    expect(normalizeLegacyToolSurfaceName("AgentOutputTool")).toBe("TaskOutput");
    expect(normalizeLegacyToolSurfaceName("BashOutputTool")).toBe("TaskOutput");
  });

  it("对当前无对应现役工具的参考例外保持原样", () => {
    expect(normalizeLegacyToolSurfaceName("MCPTool")).toBe("MCPTool");
    expect(normalizeLegacyToolSurfaceName("McpAuthTool")).toBe("McpAuthTool");
    expect(normalizeLegacyToolSurfaceName("REPLTool")).toBe("REPLTool");
  });
});
