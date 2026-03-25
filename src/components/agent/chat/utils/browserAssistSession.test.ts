import { describe, expect, it } from "vitest";

import type { Message } from "../types";
import {
  createBrowserAssistSessionState,
  extractBrowserAssistSessionFromToolCall,
  extractBrowserAssistSessionFromArtifact,
  findLatestBrowserAssistSessionInMessages,
  mergeBrowserAssistSessionStates,
  resolveBrowserAssistSessionScopeKey,
  resolveBrowserAssistSessionStorageKey,
} from "./browserAssistSession";

describe("browserAssistSession", () => {
  it("应从消息中的浏览器工具调用提取最新会话", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-14T10:00:00.000Z"),
        toolCalls: [
          {
            id: "tool-1",
            name: "mcp__lime-browser__browser_navigate",
            arguments: JSON.stringify({
              profile_key: "general_browser_assist",
              url: "https://example.com",
            }),
            status: "completed",
            startTime: new Date("2026-03-14T10:00:01.000Z"),
            endTime: new Date("2026-03-14T10:00:02.000Z"),
            result: {
              success: true,
              output: "ok",
              metadata: {
                tool_family: "browser",
                browser_session: {
                  session_id: "browser-session-1",
                  target_id: "target-1",
                  transport_kind: "cdp_frames",
                  lifecycle_state: "live",
                },
              },
            },
          },
        ],
      },
    ];

    expect(findLatestBrowserAssistSessionInMessages(messages)).toEqual(
      expect.objectContaining({
        sessionId: "browser-session-1",
        profileKey: "general_browser_assist",
        url: "https://example.com",
        targetId: "target-1",
        transportKind: "cdp_frames",
        lifecycleState: "live",
        source: "tool_call",
      }),
    );
  });

  it("合并状态时应保留已知会话信息并吸收新字段", () => {
    const current = createBrowserAssistSessionState({
      sessionId: "browser-session-1",
      profileKey: "general_browser_assist",
      url: "https://example.com",
      title: "示例站点",
      source: "tool_call",
      updatedAt: 10,
    });
    const incoming = createBrowserAssistSessionState({
      profileKey: "general_browser_assist",
      transportKind: "cdp_frames",
      controlMode: "agent",
      source: "runtime_launch",
      updatedAt: 20,
    });

    expect(mergeBrowserAssistSessionStates(current, incoming)).toEqual(
      expect.objectContaining({
        sessionId: "browser-session-1",
        transportKind: "cdp_frames",
        controlMode: "agent",
        source: "runtime_launch",
        updatedAt: 20,
      }),
    );
  });

  it("旧状态回放时不应覆盖更新后的页面 URL", () => {
    const current = createBrowserAssistSessionState({
      sessionId: "browser-session-1",
      profileKey: "general_browser_assist",
      url: "https://news.baidu.com",
      title: "百度新闻",
      source: "runtime_launch",
      updatedAt: 30,
    });
    const incoming = createBrowserAssistSessionState({
      sessionId: "browser-session-1",
      profileKey: "general_browser_assist",
      url: "https://www.rokid.com",
      title: "Rokid",
      source: "tool_call",
      updatedAt: 10,
    });

    expect(mergeBrowserAssistSessionStates(current, incoming)).toEqual(
      expect.objectContaining({
        url: "https://news.baidu.com",
        title: "百度新闻",
        source: "runtime_launch",
        updatedAt: 30,
      }),
    );
  });

  it("应从 artifact 恢复浏览器会话状态", () => {
    const artifact = {
      id: "browser-assist:general",
      type: "browser_assist",
      title: "账户中心",
      content: "",
      status: "complete",
      meta: {
        sessionId: "browser-session-2",
        profileKey: "general_browser_assist",
        url: "https://accounts.example.com",
      },
      position: { start: 0, end: 0 },
      createdAt: 1,
      updatedAt: 2,
    } as const;

    expect(extractBrowserAssistSessionFromArtifact(artifact as any)).toEqual(
      expect.objectContaining({
        sessionId: "browser-session-2",
        profileKey: "general_browser_assist",
        url: "https://accounts.example.com",
        title: "账户中心",
        source: "artifact_restore",
      }),
    );
  });

  it("应生成稳定的 session scoped storage key", () => {
    expect(resolveBrowserAssistSessionScopeKey("project-a", "session-a")).toBe(
      "session-a::project-a",
    );
    expect(resolveBrowserAssistSessionScopeKey("project-a", null)).toBe(
      "active::project-a",
    );
    expect(
      resolveBrowserAssistSessionStorageKey("project-a", "session-a"),
    ).toBe("aster_browser_assist_session_session-a_project-a");
    expect(resolveBrowserAssistSessionStorageKey("project-a", null)).toBe(
      "aster_browser_assist_session_active_project-a",
    );
  });

  it("应从顶层 metadata.page_info 解析页面标题", () => {
    expect(
      extractBrowserAssistSessionFromToolCall({
        id: "tool-page-info-1",
        name: "browser_navigate",
        arguments: JSON.stringify({
          url: "https://example.com/publish",
        }),
        status: "completed",
        startTime: new Date("2026-03-14T10:00:01.000Z"),
        endTime: new Date("2026-03-14T10:00:02.000Z"),
        result: {
          success: true,
          output: "ok",
          metadata: {
            tool_family: "browser",
            browser_session: {
              session_id: "browser-session-2",
              profile_key: "general_browser_assist",
            },
            page_info: {
              title: "发布页",
              url: "https://example.com/publish",
            },
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        sessionId: "browser-session-2",
        url: "https://example.com/publish",
        title: "发布页",
      }),
    );
  });
});
