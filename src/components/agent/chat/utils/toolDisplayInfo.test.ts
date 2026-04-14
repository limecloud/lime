import { describe, expect, it } from "vitest";

import {
  buildToolHeadline,
  buildToolGroupHeadline,
  extractSearchQueryLabel,
  getToolDisplayInfo,
  normalizeToolNameKey,
  resolveToolPrimarySubject,
  resolveUserFacingToolDisplayLabel,
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
  ["MCPTool", "mcp"],
  ["McpAuthTool", "mcpauth"],
  ["NotebookEditTool", "notebookedit"],
  ["PowerShellTool", "powershell"],
  ["ReadMcpResourceTool", "readmcpresource"],
  ["REPLTool", "repl"],
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
    expect(resolveToolDisplayLabel("ConfigTool")).toBe("运行配置");
    expect(resolveToolDisplayLabel("PowerShellTool")).toBe("PowerShell");
    expect(resolveToolDisplayLabel("WorkflowTool")).toBe("工作流执行");
    expect(resolveToolDisplayLabel("MCPTool")).toBe("MCP 工具");
    expect(resolveToolDisplayLabel("McpAuthTool")).toBe("MCP 授权");
    expect(resolveToolDisplayLabel("REPLTool")).toBe("REPL 执行");
    expect(resolveToolDisplayLabel("EnterWorktreeTool")).toBe("进入工作树");
    expect(resolveToolDisplayLabel("ExitWorktreeTool")).toBe("退出工作树");
    expect(resolveToolDisplayLabel("lime_search_web_images")).toBe("联网搜图");
    expect(resolveToolDisplayLabel("AgentTool")).toBe("创建子任务");
    expect(resolveToolDisplayLabel("SendMessageTool")).toBe("补充说明");
    expect(resolveToolDisplayLabel("TeamCreateTool")).toBe("创建团队");
    expect(resolveToolDisplayLabel("TeamDeleteTool")).toBe("删除团队");
    expect(resolveToolDisplayLabel("ScheduleCronTool")).toBe("定时触发器");
    expect(resolveToolDisplayLabel("SyntheticOutputTool")).toBe("最终答复");
    expect(resolveToolDisplayLabel("AgentOutputTool")).toBe("任务输出");
    expect(resolveToolDisplayLabel("BashOutputTool")).toBe("任务输出");
    expect(resolveToolDisplayLabel("lime_create_transcription_task")).toBe(
      "转写任务",
    );
    expect(
      resolveToolDisplayLabel("lime_create_modal_resource_search_task"),
    ).toBe("素材检索任务");
    expect(resolveToolDisplayLabel("lime_run_service_skill")).toBe(
      "服务技能执行",
    );
    expect(resolveToolDisplayLabel("lime_site_recommend")).toBe(
      "站点能力推荐",
    );
    expect(resolveToolDisplayLabel("mcp__github__search_code")).toBe(
      "MCP 搜索",
    );
    expect(resolveToolDisplayLabel("mcp__github__get_file_contents")).toBe(
      "MCP 读取",
    );
  });

  it("应为用户可见场景提供更自然的工具标签", () => {
    expect(resolveUserFacingToolDisplayLabel("FileReadTool")).toBe("查看文件");
    expect(resolveUserFacingToolDisplayLabel("write_file")).toBe("保存文件");
    expect(resolveUserFacingToolDisplayLabel("LSPTool")).toBe("分析代码");
    expect(resolveUserFacingToolDisplayLabel("ConfigTool")).toBe("查看配置");
    expect(resolveUserFacingToolDisplayLabel("PowerShellTool")).toBe(
      "运行命令",
    );
    expect(resolveUserFacingToolDisplayLabel("WorkflowTool")).toBe(
      "运行工作流",
    );
    expect(resolveUserFacingToolDisplayLabel("MCPTool")).toBe("调用 MCP 工具");
    expect(resolveUserFacingToolDisplayLabel("McpAuthTool")).toBe(
      "完成 MCP 授权",
    );
    expect(resolveUserFacingToolDisplayLabel("REPLTool")).toBe("运行命令");
    expect(
      resolveUserFacingToolDisplayLabel("lime_run_service_skill"),
    ).toBe("运行服务技能");
    expect(resolveUserFacingToolDisplayLabel("lime_site_recommend")).toBe(
      "推荐站点能力",
    );
    expect(resolveUserFacingToolDisplayLabel("mcp__github__search_code")).toBe(
      "搜索内容",
    );
    expect(
      resolveUserFacingToolDisplayLabel("mcp__github__get_file_contents"),
    ).toBe("查看内容");
    expect(resolveUserFacingToolDisplayLabel("EnterWorktreeTool")).toBe(
      "进入工作树",
    );
    expect(resolveUserFacingToolDisplayLabel("TaskOutput")).toBe(
      "查看任务结果",
    );
    expect(
      resolveUserFacingToolDisplayLabel("mcp__playwright__browser_click"),
    ).toBe("页面点击");
  });

  it("应为站点与任务工具提取更贴近主链的主体对象", () => {
    expect(
      resolveToolPrimarySubject(
        "lime_create_transcription_task",
        { sourceUrl: "https://example.com/interview.mp4" },
        null,
      ),
    ).toBe("https://example.com/interview.mp4");
    expect(
      resolveToolPrimarySubject(
        "lime_create_modal_resource_search_task",
        { query: "科技播客 BGM" },
        null,
      ),
    ).toBe("科技播客 BGM");
    expect(resolveToolPrimarySubject("lime_site_list", {}, null)).toBe(
      "站点能力目录",
    );
    expect(getToolDisplayInfo("lime_create_typesetting_task", "running").family).toBe(
      "task",
    );
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

  it("无主体对象时应直接展示动作句，避免重复拼接工具类别", () => {
    expect(
      buildToolHeadline({
        toolDisplay: getToolDisplayInfo("TaskList", "completed"),
        toolName: "TaskList",
      }),
    ).toBe("已获取任务列表");

    expect(
      buildToolHeadline({
        toolDisplay: getToolDisplayInfo("ListSkills", "completed"),
        toolName: "ListSkills",
      }),
    ).toBe("已获取技能列表");
  });

  it("应为查看类与计划类批次生成更自然的标题", () => {
    expect(
      buildToolGroupHeadline([
        {
          id: "tool-read-1",
          name: "Read",
          arguments: JSON.stringify({ file_path: "docs/guide.md" }),
          status: "completed",
          result: { success: true, output: "ok" },
          startTime: new Date("2026-04-13T00:00:00.000Z"),
          endTime: new Date("2026-04-13T00:00:01.000Z"),
        },
        {
          id: "tool-glob-1",
          name: "glob",
          arguments: JSON.stringify({ pattern: "src/**/*.tsx" }),
          status: "completed",
          result: { success: true, output: "ok" },
          startTime: new Date("2026-04-13T00:00:02.000Z"),
          endTime: new Date("2026-04-13T00:00:03.000Z"),
        },
      ]),
    ).toBe("已查看");

    expect(
      buildToolGroupHeadline([
        {
          id: "tool-task-list-1",
          name: "TaskList",
          arguments: JSON.stringify({}),
          status: "completed",
          result: { success: true, output: "[]" },
          startTime: new Date("2026-04-13T00:00:04.000Z"),
          endTime: new Date("2026-04-13T00:00:05.000Z"),
        },
        {
          id: "tool-task-update-1",
          name: "TaskUpdate",
          arguments: JSON.stringify({ task_id: "task-1" }),
          status: "completed",
          result: { success: true, output: "{}" },
          startTime: new Date("2026-04-13T00:00:06.000Z"),
          endTime: new Date("2026-04-13T00:00:07.000Z"),
        },
      ]),
    ).toBe("已处理 2 项安排");
  });
});
