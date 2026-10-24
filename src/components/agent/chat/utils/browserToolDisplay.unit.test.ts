import { afterEach, describe, expect, it } from "vitest";
import { Globe } from "lucide-react";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import type { AgentToolCallState } from "@/lib/api/agentProtocol";
import {
  buildGroupedChildLine,
  buildToolGroupHeadline,
  getToolDisplayInfo,
  resolveToolPrimarySubject,
} from "./toolDisplayInfo";
import { resolveRequiredAgentChatCopy as copy } from "./agentChatCopy";
import {
  resolveAgentThreadToolProcessNarrative,
  resolveToolProcessNarrative,
} from "./toolProcessSummary";
import {
  buildToolGroupPreview,
  resolveToolGroupKey,
  shouldRenderResultAsCodeBlock,
} from "../components/ToolCallDisplayViewModel";
import {
  summarizeStreamingToolBatch,
  summarizeThreadProcessBatch,
} from "./toolBatchGrouping";

const metadata = { canonical_type: "dynamicToolCall", namespace: "browser" };
const tool = (name: string): AgentToolCallState => ({
  id: `browser-${name}`,
  name,
  status: "completed",
  metadata,
  arguments: JSON.stringify({ tabId: "tab-1" }),
  result: { success: true, output: '{"targetId":"private-target"}' },
});

afterEach(async () => changeLimeLocale("zh-CN"));

describe.each(SUPPORTED_LOCALES)("browser tool presentation / %s", (locale) => {
  it("canonical namespace 决定标签、动作、主题及分组，保留原始身份", async () => {
    await changeLimeLocale(locale);
    for (const name of [
      "attachTarget",
      "detachTarget",
      "executeCdpCommand",
      "getTabs",
      "read",
    ]) {
      const call = tool(name);
      const before = JSON.stringify(call);
      const display = getToolDisplayInfo(name, "completed", metadata);
      expect(display.family, name).toBe("browser");
      expect(display.icon, name).toBe(Globe);
      expect(display.label, name).toBe(copy("toolCall.label.browserOperation"));
      expect(display.action, name).not.toContain(name);
      expect(resolveToolPrimarySubject(name, {}, null, metadata), name).toBe(
        copy("toolCall.subject.page"),
      );
      expect(resolveToolGroupKey(call), name).toBe(
        `${display.groupTitle}:completed`,
      );
      expect(buildToolGroupHeadline([call]), name).toBe(
        copy("toolCall.group.browser.completed", { count: 1 }),
      );
      expect(buildGroupedChildLine(call), name).toBe(
        `${display.verb} ${copy("toolCall.subject.page")}`,
      );
      expect(buildToolGroupPreview([call], String), name).toBe(
        copy("toolCall.subject.page"),
      );
      expect(JSON.stringify(call), name).toBe(before);
    }
  });

  it("canonical fill/press 使用页面输入，URL 仍是页面主题", async () => {
    await changeLimeLocale(locale);
    for (const name of ["fill", "press"]) {
      const display = getToolDisplayInfo(name, "running", metadata);
      expect(display.family).toBe("browser");
      expect(display.label).toBe(copy("toolCall.label.pageType"));
    }
    expect(
      resolveToolPrimarySubject(
        "read",
        { url: "https://example.test/" },
        null,
        metadata,
      ),
    ).toBe("https://example.test/");
  });

  it("批量过程摘要在流式与历史下都按 browser 归组", async () => {
    await changeLimeLocale(locale);
    const calls = [
      tool("attachTarget"),
      tool("executeCdpCommand"),
      tool("read"),
    ];
    const batch = summarizeStreamingToolBatch(calls);
    expect(batch?.kind).toBe("browser");
    expect(
      summarizeThreadProcessBatch(
        calls.map((call) => ({
          id: call.id,
          type: "tool_call",
          tool_name: call.name,
          arguments: { tabId: "tab-1" },
          status: "completed",
          output: call.result?.output,
          metadata,
        })),
      ),
    ).toEqual(batch);
    expect(
      summarizeStreamingToolBatch(
        calls.map((call) => ({
          ...call,
          metadata: { ...metadata, namespace: "filesystem" },
        })),
      )?.kind,
    ).not.toBe("browser");
  });

  it("流式与恢复历史消费同一 browser narrative，不泄露 raw target 结果", async () => {
    await changeLimeLocale(locale);
    for (const name of ["attachTarget", "executeCdpCommand", "read"]) {
      const call = tool(name);
      const completed = resolveToolProcessNarrative(call);
      const running = resolveToolProcessNarrative({
        ...call,
        status: "running",
      });
      const history = resolveAgentThreadToolProcessNarrative({
        id: call.id,
        type: "tool_call",
        tool_name: name,
        arguments: { tabId: "tab-1" },
        status: "completed",
        output: call.result?.output,
        metadata,
      });
      expect(completed.postSummary, name).toBe(
        copy("toolCall.processSummary.browser.operationCompleted"),
      );
      expect(running.preSummary, name).toBe(
        copy("toolCall.processSummary.browser.viewPageState"),
      );
      expect(history, name).toEqual(completed);
      expect(completed.summary).not.toContain("private-target");
    }
  });
});

it("其他 namespace、非 dynamic metadata 和缺失 metadata 不改变原有分类", () => {
  for (const candidate of [
    undefined,
    null,
    [],
    "browser",
    { namespace: "browser" },
    { ...metadata, canonical_type: "mcpToolCall" },
    { ...metadata, namespace: "filesystem" },
  ]) {
    expect(getToolDisplayInfo("read", "completed", candidate).family).toBe(
      "read",
    );
    expect(
      getToolDisplayInfo("attachTarget", "completed", candidate).family,
    ).not.toBe("browser");
  }
  expect(
    getToolDisplayInfo("mcp__filesystem__read_file", "completed", metadata)
      .family,
  ).toBe("read");
});

it("browser 结果不按终端格式化，其他 MCP execute 仍保留原代码详情", () => {
  expect(
    shouldRenderResultAsCodeBlock({
      toolCall: tool("executeCdpCommand"),
      content: "one line",
    }),
  ).toBe(false);
  expect(
    shouldRenderResultAsCodeBlock({
      toolCall: { ...tool("mcp__custom__execute_task"), metadata: undefined },
      content: "one line",
    }),
  ).toBe(true);
});
