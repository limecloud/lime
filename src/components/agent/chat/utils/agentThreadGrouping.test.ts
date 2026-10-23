import { beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";

import type { AgentThreadItem } from "../types";
import { buildAgentThreadDisplayModel } from "./agentThreadGrouping";

function at(second: number): string {
  return `2026-03-15T09:00:${String(second).padStart(2, "0")}Z`;
}

function createBaseItem(
  id: string,
  sequence: number,
): Pick<
  AgentThreadItem,
  | "id"
  | "thread_id"
  | "turn_id"
  | "sequence"
  | "status"
  | "started_at"
  | "completed_at"
  | "updated_at"
> {
  const timestamp = at(sequence);
  return {
    id,
    thread_id: "thread-1",
    turn_id: "turn-1",
    sequence,
    status: "completed",
    started_at: timestamp,
    completed_at: timestamp,
    updated_at: timestamp,
  };
}

describe("agentThreadGrouping", () => {
  beforeEach(async () => {
    await changeLimeLocale("zh-CN");
  });

  it("应按真实时序把连续执行项收成一个过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("browser-2", 2),
        type: "tool_call",
        tool_name: "browser_click",
        arguments: { selector: "#submit" },
      },
      {
        ...createBaseItem("search-1", 3),
        type: "web_search",
        action: "web_search",
        query: "Lime CDP 并行渲染",
      },
      {
        ...createBaseItem("browser-3", 4),
        type: "tool_call",
        tool_name: "browser_snapshot",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.groups[0]?.items).toHaveLength(4);
    expect(model.groups[0]?.previewLines).toContain(
      "打开了 https://example.com",
    );
    expect(model.groups[0]?.previewLines).toContain("点了 #submit");
    expect(model.groups[0]?.previewLines).toContain("搜了 Lime CDP 并行渲染");
    expect(model.summaryChips).toEqual([
      { kind: "process", label: "执行过程", count: 4 },
    ]);
  });

  it("应保留产物块，并把前后执行项收成过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("plan-1", 1),
        type: "plan",
        text: "1. 打开页面\n2. 写入文件",
      },
      {
        ...createBaseItem("file-1", 2),
        type: "file_artifact",
        path: "articles/wechat-draft.md",
        source: "tool_result",
        content: "# 草稿",
      },
      {
        ...createBaseItem("cmd-1", 3),
        type: "command_execution",
        command: "npm test -- AgentThreadTimeline",
        cwd: "/workspace",
        aggregated_output: "ok",
      },
      {
        ...createBaseItem("summary-1", 4),
        type: "turn_summary",
        text: "已完成 CDP 页面检查\n后续可以继续发布。",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.summaryText).toBe("已完成 CDP 页面检查");
    expect(model.groups.map((group) => group.kind)).toEqual([
      "process",
      "artifact",
      "process",
    ]);
    expect(model.groups[1]?.previewLines).toEqual(["生成了 wechat-draft.md"]);
    expect(model.groups[2]?.previewLines).toContain(
      "运行了 npm test -- AgentThreadTimeline",
    );
    expect(model.summaryChips).toEqual([
      { kind: "process", label: "执行过程", count: 3 },
      { kind: "artifact", label: "文件和产物", count: 1 },
    ]);
  });

  it("应通过 artifact protocol 识别嵌套参数中的文件路径", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("tool-file-1", 1),
        type: "tool_call",
        tool_name: "write_file",
        arguments: {
          payload: {
            filePath: "articles/nested-draft.md",
          },
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.groups[0]?.previewLines).toEqual(["保存了 nested-draft.md"]);
  });

  it("应通过 filesystem event protocol 识别目录与输出文件位置线索", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("tool-dir-1", 1),
        type: "tool_call",
        tool_name: "list_directory",
        arguments: {
          directory: "workspace\\reports",
        },
      },
      {
        ...createBaseItem("tool-output-1", 2),
        type: "tool_call",
        tool_name: "bash",
        metadata: {
          output_file: "workspace\\logs\\run.log",
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.groups[0]?.previewLines).toEqual([
      "查看了 reports",
      "处理了 run.log",
    ]);
  });

  it("思考与工具步骤应保持原始时序并收进同一个过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://mp.weixin.qq.com" },
      },
      {
        ...createBaseItem("summary-1", 2),
        type: "turn_summary",
        text: "已打开公众号后台",
      },
      {
        ...createBaseItem("search-1", 3),
        type: "web_search",
        action: "web_search",
        query: "微信公众号 封面尺寸",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks.map((block) => block.kind)).toEqual(["process"]);
    expect(model.groups.map((group) => group.kind)).toEqual(["process"]);
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "打开了 https://mp.weixin.qq.com",
      "已打开公众号后台",
      "搜了 微信公众号 封面尺寸",
    ]);
  });

  it("reasoning 与工具混排时不应被工具批量摘要覆盖", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: "先确认用户要的是今天国际新闻。",
      },
      {
        ...createBaseItem("search-1", 2),
        type: "web_search",
        action: "web_search",
        query: "today world news Reuters",
      },
      {
        ...createBaseItem("reasoning-2", 3),
        type: "reasoning",
        text: "再按地区和影响力筛选来源。",
      },
      {
        ...createBaseItem("browser-1", 4),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://apnews.com/hub/world-news" },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks).toHaveLength(1);
    expect(model.orderedBlocks[0]?.title).toBe("执行过程");
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "先确认用户要的是今天国际新闻。",
      "搜了 today world news Reuters",
      "再按地区和影响力筛选来源。",
    ]);
  });

  it("同一 turn 内过程预览应按 sequence 排序而不是按完成时间排序", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("search-2", 2),
        started_at: at(1),
        completed_at: at(1),
        updated_at: at(1),
        type: "web_search",
        action: "web_search",
        query: "第二步资料",
      },
      {
        ...createBaseItem("browser-1", 1),
        started_at: at(10),
        completed_at: at(10),
        updated_at: at(10),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com/first" },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "打开了 https://example.com/first",
      "搜了 第二步资料",
    ]);
  });

  it("reasoning 预览应压平碎片化过程文本", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: ["The", "", "I", "", "Now"].join("\n"),
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.summaryText).toBe("The I Now");
    expect(model.orderedBlocks[0]?.previewLines).toEqual(["The I Now"]);
  });

  it("结构化问答摘要不应回退为原始 a2ui 代码块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: [
          "请先确认以下选项：",
          "",
          "```a2ui",
          '{"type":"form","title":"确认","fields":[]}',
          "```",
        ].join("\n"),
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.summaryText).toBe("请先确认以下选项：");
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "请先确认以下选项：",
    ]);
  });

  it("ToolSearch 结果预览应优先展示过程结论，而不是退回通用动词模板", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("tool-search-1", 1),
        type: "tool_call",
        tool_name: "ToolSearch",
        arguments: {
          query: "select:Read,Write",
        },
        output: JSON.stringify({
          query: "select:Read,Write",
          count: 2,
          tools: [{ name: "Read" }, { name: "Write" }],
        }),
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups[0]?.previewLines).toEqual([
      "已确认可用工具 2 个 · 查看文件 · 保存文件",
    ]);
  });

  it("连续探索类工具应折叠成项目探索摘要", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("grep-1", 1),
        type: "tool_call",
        tool_name: "Grep",
        arguments: {
          pattern: "tool_use_summary",
          path: "/workspace/src",
        },
      },
      {
        ...createBaseItem("read-1", 2),
        type: "tool_call",
        tool_name: "Read",
        arguments: {
          file_path: "/workspace/src/query.ts",
        },
      },
      {
        ...createBaseItem("read-2", 3),
        type: "tool_call",
        tool_name: "Read",
        arguments: {
          file_path:
            "/workspace/src/components/messages/CollapsedReadSearchContent.tsx",
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks).toHaveLength(1);
    expect(model.orderedBlocks[0]?.title).toBe("已探索项目");
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "查看了 2 个文件，搜索 1 次",
      "最新线索：CollapsedReadSearchContent.tsx",
    ]);
    expect(model.orderedBlocks[0]?.countLabel).toBe("读 2 / 搜 1");
    expect(model.orderedBlocks[0]?.rawDetailLabel).toBe("展开查看探索明细");
  });

  it("连续 WebSearch 线程项应按调用边界拆成独立搜索过程", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("search-1", 1),
        type: "web_search",
        action: "search",
        query: "today world news Reuters",
      },
      {
        ...createBaseItem("search-2", 2),
        type: "web_search",
        action: "openPage",
        query: "https://apnews.com/hub/world-news",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks).toHaveLength(2);
    expect(model.orderedBlocks[0]?.title).toBe(
      "已搜索网页：today world news Reuters",
    );
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "today world news Reuters",
    ]);
    expect(model.orderedBlocks[0]?.countLabel).toBe("1 次");
    expect(model.orderedBlocks[0]?.rawDetailLabel).toBe("展开查看搜索来源");
    expect(model.orderedBlocks[1]?.title).toBe(
      "已搜索网页：https://apnews.com/hub/world-news",
    );
    expect(model.orderedBlocks[1]?.previewLines).toEqual([
      "https://apnews.com/hub/world-news",
    ]);
    expect(model.orderedBlocks[1]?.countLabel).toBe("1 次");
    expect(model.orderedBlocks[1]?.rawDetailLabel).toBe("展开查看搜索来源");
  });

  it("WebSearch 读取页面后遇到下一次 WebSearch 应新开过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("search-1", 1),
        type: "web_search",
        action: "search",
        query: "today world news Reuters",
      },
      {
        ...createBaseItem("fetch-1", 2),
        type: "tool_call",
        tool_name: "WebFetch",
        arguments: { url: "https://www.reuters.com/world/" },
      },
      {
        ...createBaseItem("search-2", 3),
        type: "web_search",
        action: "search",
        query: "global headlines AP",
      },
      {
        ...createBaseItem("fetch-2", 4),
        type: "tool_call",
        tool_name: "WebFetch",
        arguments: { url: "https://apnews.com/hub/world-news" },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks).toHaveLength(2);
    expect(model.orderedBlocks[0]?.title).toBe(
      "已搜索网页 1 次，读取网页 1 次",
    );
    expect(model.orderedBlocks[0]?.previewLines).toEqual([
      "today world news Reuters",
      "reuters.com/world",
    ]);
    expect(model.orderedBlocks[0]?.countLabel).toBe("搜 1 / 读 1");
    expect(model.orderedBlocks[1]?.title).toBe(
      "已搜索网页 1 次，读取网页 1 次",
    );
    expect(model.orderedBlocks[1]?.previewLines).toEqual([
      "global headlines AP",
      "apnews.com/hub/world-news",
    ]);
    expect(model.orderedBlocks[1]?.countLabel).toBe("搜 1 / 读 1");
  });

  it("运行中的 WebSearch 线程项应折叠成搜索进行态摘要", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("search-running-1", 1),
        status: "in_progress",
        completed_at: undefined,
        type: "web_search",
        action: "search",
        query: "today AI news",
      },
      {
        ...createBaseItem("fetch-running-1", 2),
        status: "in_progress",
        completed_at: undefined,
        type: "tool_call",
        tool_name: "WebFetch",
        arguments: {
          url: "https://www.reuters.com/technology/artificial-intelligence/",
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks).toHaveLength(1);
    expect(model.orderedBlocks[0]?.title).toBe(
      "正在搜索网页 1 次，读取网页 1 次",
    );
    expect(model.orderedBlocks[0]?.previewLines[0]).toBe("today AI news");
    expect(model.orderedBlocks[0]?.previewLines[1]).toBe(
      "reuters.com/technology/artificial-intelligen…",
    );
    expect(model.orderedBlocks[0]?.previewLines[1]).not.toContain(
      "https://www.reuters.com/",
    );
    expect(model.orderedBlocks[0]?.countLabel).toBe("搜 1 / 读 1");
    expect(model.orderedBlocks[0]?.rawDetailLabel).toBe(
      "展开查看搜索与读取进度",
    );
  });

  it("workspace patch 宿主工具 WebSearch 也应按调用边界拆分", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("content-factory-search-1", 1),
        type: "web_search",
        query: "golang 学习路径",
        output: "检索到 3 条资料",
        metadata: {
          source: "workspace_patch_host_tool_requests",
          workflowKey: "content_article_workflow",
        },
      },
      {
        ...createBaseItem("content-factory-search-2", 2),
        type: "web_search",
        query: "golang 并发实践",
        output: "检索到 2 条资料",
        metadata: {
          source: "legacy_tool_event",
          workflow_key: "content_article_workflow",
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks).toHaveLength(2);
    expect(model.orderedBlocks[0]?.kind).toBe("process");
    expect(model.orderedBlocks[0]?.status).toBe("completed");
    expect(model.orderedBlocks[0]?.defaultExpanded).toBe(false);
    expect(model.orderedBlocks[0]?.title).toBe("已搜索网页：golang 学习路径");
    expect(model.orderedBlocks[1]?.kind).toBe("process");
    expect(model.orderedBlocks[1]?.status).toBe("completed");
    expect(model.orderedBlocks[1]?.defaultExpanded).toBe(false);
    expect(model.orderedBlocks[1]?.title).toBe("已搜索网页：golang 并发实践");
  });

  it("混合推理与工具后出现补丁时应保留独立文件变更块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("assistant-canonical-progress", 1),
        type: "agent_message",
        text: "我会先运行测试并检查失败。",
      },
      {
        ...createBaseItem("reasoning-canonical", 2),
        type: "reasoning",
        text: "需要先确认测试失败点。",
      },
      {
        ...createBaseItem("cmd-canonical", 3),
        type: "command_execution",
        command: "npm test",
        cwd: "/workspace/canonical-codex",
        aggregated_output: "ok",
      },
      {
        ...createBaseItem("search-canonical", 5),
        type: "web_search",
        action: "search_query",
        output: '"search_query"',
      },
      {
        ...createBaseItem("patch-canonical", 6),
        type: "patch",
        text: "Patch changed /workspace/canonical-codex/src/lib.rs",
        paths: ["/workspace/canonical-codex/src/lib.rs"],
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks.map((block) => block.kind)).toEqual([
      "process",
      "artifact",
    ]);
    expect(model.orderedBlocks[0]?.title).toBe("执行过程");
    expect(model.orderedBlocks[0]?.defaultExpanded).toBe(false);
    expect(model.orderedBlocks[0]?.forceExpanded).toBeUndefined();
    expect(JSON.stringify(model.orderedBlocks[0])).toContain("npm test");
    expect(JSON.stringify(model.orderedBlocks[0])).toContain(
      "需要先确认测试失败点",
    );
  });

  it("交互与任务结果预览应使用更直白的用户文案", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("question-1", 1),
        type: "tool_call",
        tool_name: "request_user_input",
        arguments: { question: "需要继续吗？" },
      },
      {
        ...createBaseItem("task-output-1", 2),
        type: "tool_call",
        tool_name: "TaskOutput",
        arguments: { task_id: "video-task-1" },
      },
      {
        ...createBaseItem("list-peers-1", 3),
        type: "tool_call",
        tool_name: "ListPeers",
        arguments: { team_name: "当前子代理组" },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups[0]?.previewLines).toEqual([
      "等你确认：需要继续吗？",
      "已查看结果 video-task-1",
      "已查看 当前子代理组",
    ]);
  });

  it("协作任务控制预览应直接表达查看、继续与暂停动作", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("wait-agent-1", 1),
        type: "tool_call",
        tool_name: "WaitAgent",
        arguments: { id: "agent-1" },
      },
      {
        ...createBaseItem("resume-agent-1", 2),
        type: "tool_call",
        tool_name: "ResumeAgent",
        arguments: { id: "agent-1" },
      },
      {
        ...createBaseItem("close-agent-1", 3),
        type: "tool_call",
        tool_name: "CloseAgent",
        arguments: { id: "agent-1" },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.groups[0]?.previewLines).toEqual([
      "已查看 agent-1",
      "已继续 agent-1",
      "已暂停 agent-1",
    ]);
  });

  it("runtime status turn_summary 不应抢占整轮摘要", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: "runtime status should not become the turn summary",
        metadata: {
          sourceType: "runtime_status",
          surface: "runtime_status",
          visibility: "diagnostics",
        },
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.summaryText).toBeNull();
    expect(model.orderedBlocks[0]?.previewLines).toEqual([]);
  });

  it("Provider 402 alert 摘要应显示用户友好提示", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("provider-error-1", 1),
        type: "error",
        status: "failed",
        message:
          "Agent provider execution failed: Request failed with status 402 Payment Required: Insufficient Balance",
      },
    ];

    const model = buildAgentThreadDisplayModel(items);

    expect(model.orderedBlocks[0]?.previewLines[0]).toMatch(
      /计费或额度类错误|billing or quota error/,
    );
    expect(model.orderedBlocks[0]?.previewLines[0]).not.toContain(
      "Payment Required",
    );
    expect(model.orderedBlocks[0]?.previewLines[0]).not.toContain(
      "Insufficient Balance",
    );
  });
});
