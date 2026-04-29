import { describe, expect, it } from "vitest";

import type { AgentToolCallState } from "@/lib/api/agentProtocol";

import { resolveToolProcessNarrative } from "./toolProcessSummary";

function createToolCall(
  overrides: Partial<AgentToolCallState>,
): AgentToolCallState {
  return {
    id: "tool-1",
    name: "ConfigTool",
    status: "completed",
    startTime: new Date("2026-04-14T00:00:00.000Z"),
    ...overrides,
  };
}

describe("toolProcessSummary", () => {
  it("应为工作树切换提供明确过程文案", () => {
    const enterNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "EnterWorktreeTool",
        status: "running",
      }),
    );
    const exitNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "ExitWorktreeTool",
        status: "completed",
      }),
    );

    expect(enterNarrative.preSummary).toBe("先进入隔离工作树");
    expect(enterNarrative.summary).toBe("先进入隔离工作树");
    expect(exitNarrative.postSummary).toBe("已回到主工作区");
    expect(exitNarrative.summary).toBe("已回到主工作区");
  });

  it("应为配置与工作流工具提供稳定文案", () => {
    const configNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "ConfigTool",
        status: "completed",
      }),
    );
    const workflowNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "WorkflowTool",
        status: "completed",
      }),
    );

    expect(configNarrative.preSummary).toBe("先查看或调整运行配置");
    expect(configNarrative.postSummary).toBe("已更新运行配置");
    expect(workflowNarrative.preSummary).toBe("先执行预设工作流");
    expect(workflowNarrative.postSummary).toBe("已执行工作流");
  });

  it("应为等待工具提供显式完成文案", () => {
    const narrative = resolveToolProcessNarrative(
      createToolCall({
        name: "SleepTool",
        status: "completed",
      }),
    );

    expect(narrative.preSummary).toBe("先等待一段时间再继续");
    expect(narrative.postSummary).toBe("已完成等待");
    expect(narrative.summary).toBe("已完成等待");
  });

  it("应为计划模式与最终答复提供专用文案", () => {
    const enterPlanNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "EnterPlanModeTool",
        status: "running",
      }),
    );
    const exitPlanNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "ExitPlanModeTool",
        status: "completed",
      }),
    );
    const finalNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "SyntheticOutputTool",
        status: "completed",
      }),
    );

    expect(enterPlanNarrative.preSummary).toBe("先进入计划模式拆解方案");
    expect(exitPlanNarrative.postSummary).toBe("已退出计划模式");
    expect(finalNarrative.preSummary).toBe("先整理最终答复");
    expect(finalNarrative.postSummary).toBe("已整理最终答复");
    expect(finalNarrative.summary).toBe("已整理最终答复");
  });

  it("应区分不同任务与计划工具的过程文案", () => {
    const taskCreateNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "TaskCreateTool",
        status: "completed",
        arguments: JSON.stringify({ title: "每日趋势摘要" }),
      }),
    );
    const taskListNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "TaskListTool",
        status: "completed",
      }),
    );
    const taskOutputNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "TaskOutputTool",
        status: "completed",
      }),
    );
    const taskStopNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "TaskStopTool",
        status: "completed",
        arguments: JSON.stringify({ task_id: "task-123" }),
      }),
    );
    const cronListNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "CronListTool",
        status: "completed",
      }),
    );

    expect(taskCreateNarrative.preSummary).toBe("先开始 每日趋势摘要");
    expect(taskCreateNarrative.postSummary).toBe("已开始 每日趋势摘要");
    expect(taskListNarrative.preSummary).toBe("先查看任务列表");
    expect(taskListNarrative.postSummary).toBe("已查看任务列表");
    expect(taskOutputNarrative.preSummary).toBe("先查看任务结果");
    expect(taskOutputNarrative.postSummary).toBe("已查看任务结果");
    expect(taskStopNarrative.preSummary).toBe("先终止任务 task-123");
    expect(taskStopNarrative.postSummary).toBe("已终止任务 task-123");
    expect(cronListNarrative.postSummary).toBe("已查看定时触发器");
  });

  it("应为 MCP 搜索与读取工具生成可读过程文案", () => {
    const searchNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "mcp__github__search_code",
        status: "running",
        arguments: JSON.stringify({ query: "repo:lime tool runtime" }),
      }),
    );
    const readNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "mcp__github__get_file_contents",
        status: "completed",
        arguments: JSON.stringify({ path: "docs/guide.md" }),
      }),
    );

    expect(searchNarrative.preSummary).toBe("先搜索 repo:lime tool runtime");
    expect(searchNarrative.summary).toBe("先搜索 repo:lime tool runtime");
    expect(readNarrative.preSummary).toBe("先查看 guide.md");
    expect(readNarrative.postSummary).toBe("已查看 guide.md");
    expect(readNarrative.summary).toBe("已查看 guide.md");
  });

  it("应为站点目录、搜索、详情与执行工具生成站点语义文案", () => {
    const siteListNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_site_list",
        status: "completed",
      }),
    );
    const siteSearchNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_site_search",
        status: "running",
        arguments: JSON.stringify({ query: "GitHub issue 搜索" }),
      }),
    );
    const siteInfoNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_site_info",
        status: "completed",
        arguments: JSON.stringify({ adapter_name: "github/search" }),
      }),
    );
    const siteRunNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_site_run",
        status: "running",
        arguments: JSON.stringify({ adapter_name: "github/search" }),
      }),
    );

    expect(siteListNarrative.preSummary).toBe("先查看可用站点能力");
    expect(siteListNarrative.postSummary).toBe("已查看可用站点能力");
    expect(siteSearchNarrative.preSummary).toBe(
      "先搜索 GitHub issue 搜索 相关站点能力",
    );
    expect(siteSearchNarrative.summary).toBe(
      "先搜索 GitHub issue 搜索 相关站点能力",
    );
    expect(siteInfoNarrative.postSummary).toBe(
      "已确认 github/search 的参数与登录要求",
    );
    expect(siteRunNarrative.preSummary).toBe("先执行站点能力 github/search");
    expect(siteRunNarrative.summary).toBe("先执行站点能力 github/search");
  });

  it("应为服务技能与站点推荐工具生成专用过程文案", () => {
    const serviceSkillNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_run_service_skill",
        status: "running",
        arguments: JSON.stringify({ skill_title: "渠道预览" }),
      }),
    );
    const siteRecommendNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_site_recommend",
        status: "completed",
        arguments: JSON.stringify({ query: "GitHub issue 搜索" }),
      }),
    );

    expect(serviceSkillNarrative.preSummary).toBe(
      "先走服务技能兼容执行 渠道预览",
    );
    expect(serviceSkillNarrative.summary).toBe("先走服务技能兼容执行 渠道预览");
    expect(siteRecommendNarrative.preSummary).toBe(
      "先推荐适合 GitHub issue 搜索 的站点能力",
    );
    expect(siteRecommendNarrative.postSummary).toBe(
      "已推荐适合 GitHub issue 搜索 的站点能力",
    );
  });

  it("应为新补齐的任务工具生成更贴近当前前台的发起文案", () => {
    const transcriptionNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_create_transcription_task",
        status: "completed",
        arguments: JSON.stringify({ sourcePath: "/tmp/interview.mp4" }),
      }),
    );
    const resourceNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_create_modal_resource_search_task",
        status: "running",
        arguments: JSON.stringify({ query: "科技播客 BGM" }),
      }),
    );
    const urlParseNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_create_url_parse_task",
        status: "completed",
        arguments: JSON.stringify({ url: "https://example.com/report" }),
      }),
    );
    const typesettingNarrative = resolveToolProcessNarrative(
      createToolCall({
        name: "lime_create_typesetting_task",
        status: "running",
        arguments: JSON.stringify({ targetPlatform: "小红书" }),
      }),
    );

    expect(transcriptionNarrative.preSummary).toBe(
      "先发起 /tmp/interview.mp4 的转写",
    );
    expect(transcriptionNarrative.postSummary).toBe(
      "已发起 /tmp/interview.mp4 的转写",
    );
    expect(resourceNarrative.preSummary).toBe("先发起 科技播客 BGM 的素材检索");
    expect(resourceNarrative.summary).toBe("先发起 科技播客 BGM 的素材检索");
    expect(urlParseNarrative.postSummary).toBe(
      "已发起 https://example.com/report 的链接解析",
    );
    expect(typesettingNarrative.preSummary).toBe("先发起 小红书 的排版");
  });

  it("应把 WebSearch 协议错误翻译成可操作提示", () => {
    const narrative = resolveToolProcessNarrative(
      createToolCall({
        name: "WebSearch",
        status: "failed",
        result: {
          success: false,
          error: "-32603: -32002: WebSearch",
          output: "",
        },
      }),
    );

    expect(narrative.postSummary).toBe(
      "执行失败：当前联网搜索链路未接通，请检查 Runtime 是否接通 WebSearch，或关闭联网搜索后重试。",
    );
    expect(narrative.summary).toBe(
      "执行失败：当前联网搜索链路未接通，请检查 Runtime 是否接通 WebSearch，或关闭联网搜索后重试。",
    );
  });
});
