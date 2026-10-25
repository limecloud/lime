import { describe, expect, it } from "vitest";
import {
  buildWorkspacePluginSurfacesFromThreadItems,
  closeWorkspacePluginSurfaceDescriptor,
  mergeWorkspacePluginSurfaceDescriptors,
  resolveWorkspacePluginSurfaceActiveContainerId,
  resolveWorkspacePluginSurfaceSessionEpoch,
  resolveWorkspacePluginSurfaceThreadId,
  selectWorkspacePluginSurfaceDescriptor,
} from "./workspacePluginSurfaceModel";

describe("workspacePluginSurfaceModel", () => {
  it("应从 canonical MCP tool item 生成可恢复的 MCP App surface", () => {
    const surfaces = buildWorkspacePluginSurfacesFromThreadItems([
      {
        id: "item-mcp-app-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 3,
        status: "completed",
        started_at: "2026-08-04T00:00:00.000Z",
        updated_at: "2026-08-04T00:00:01.000Z",
        completed_at: "2026-08-04T00:00:01.000Z",
        type: "tool_call",
        tool_name: "mcp__plugin__demo__report",
        success: true,
        metadata: {
          canonical_type: "mcpToolCall",
          server: "plugin__demo__server",
          app_context: { connectorId: "connector-demo" },
          plugin_id: "demo-plugin",
          mcp_app_resource_uri: "ui://demo/report.html",
        },
      },
    ]);

    expect(surfaces).toEqual([
      {
        appId: "demo-plugin",
        title: "demo-plugin",
        containerId: "mcp-app-item-mcp-app-1",
        mcpApp: {
          connectorId: "connector-demo",
          resourceUri: "ui://demo/report.html",
          serverName: "plugin__demo__server",
          toolItemId: "item-mcp-app-1",
        },
      },
    ]);
    expect(
      buildWorkspacePluginSurfacesFromThreadItems(
        [
          {
            id: "item-mcp-app-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            sequence: 3,
            status: "completed",
            started_at: "2026-08-04T00:00:00.000Z",
            updated_at: "2026-08-04T00:00:01.000Z",
            type: "tool_call",
            tool_name: "mcp__plugin__demo__report",
            metadata: {
              canonical_type: "mcpToolCall",
              server: "plugin__demo__server",
              plugin_id: "demo-plugin",
              mcp_app_resource_uri: "ui://demo/report.html",
            },
          },
        ],
        ["mcp-app-item-mcp-app-1"],
      ),
    ).toEqual([]);
  });

  it("应从 lime_apps canonical appContext 恢复无 Plugin identity 的资源面板", () => {
    expect(
      buildWorkspacePluginSurfacesFromThreadItems([
        {
          id: "item-app-calendar",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 4,
          status: "completed",
          started_at: "2026-08-04T00:00:00.000Z",
          updated_at: "2026-08-04T00:00:01.000Z",
          completed_at: "2026-08-04T00:00:01.000Z",
          type: "tool_call",
          tool_name: "mcp__lime_apps__calendar_search",
          success: true,
          metadata: {
            canonical_type: "mcpToolCall",
            server: "lime_apps",
            app_context: {
              connectorId: "calendar",
              appName: "Calendar",
            },
            mcp_app_resource_uri: "ui://calendar/event.html",
          },
        },
      ]),
    ).toEqual([
      {
        appId: "calendar",
        title: "Calendar",
        containerId: "mcp-app-item-app-calendar",
        mcpApp: {
          connectorId: "calendar",
          resourceUri: "ui://calendar/event.html",
          serverName: "lime_apps",
          toolItemId: "item-app-calendar",
        },
      },
    ]);
  });

  it("应按 canonical thread identity 过滤旧会话 item", () => {
    const item = {
      id: "item-mcp-app-1",
      thread_id: "thread-old",
      turn_id: "turn-1",
      sequence: 3,
      status: "completed" as const,
      started_at: "2026-08-04T00:00:00.000Z",
      updated_at: "2026-08-04T00:00:01.000Z",
      type: "tool_call" as const,
      tool_name: "mcp__plugin__demo__report",
      metadata: {
        canonical_type: "mcpToolCall",
        server: "plugin__demo__server",
        plugin_id: "demo-plugin",
        mcp_app_resource_uri: "ui://demo/report.html",
      },
    };

    expect(
      buildWorkspacePluginSurfacesFromThreadItems([item], [], "thread-new"),
    ).toEqual([]);
    expect(
      buildWorkspacePluginSurfacesFromThreadItems([item], [], "thread-old")[0]
        ?.containerId,
    ).toBe("mcp-app-item-mcp-app-1");
  });

  it("session 切换期间应屏蔽旧 thread，目标 thread 到达后恢复同一 identity", () => {
    const initial = resolveWorkspacePluginSurfaceSessionEpoch({
      currentSessionId: "session-old",
      currentThreadId: "thread-old",
      previousEpoch: null,
    });
    const switching = resolveWorkspacePluginSurfaceSessionEpoch({
      currentSessionId: "session-new",
      currentThreadId: "thread-old",
      previousEpoch: initial.epoch,
    });
    const restored = resolveWorkspacePluginSurfaceSessionEpoch({
      currentSessionId: "session-new",
      currentThreadId: "thread-new",
      previousEpoch: initial.epoch,
    });

    expect(initial).toEqual({
      epoch: { sessionId: "session-old", threadId: "thread-old" },
      ready: true,
    });
    expect(switching).toEqual({
      epoch: { sessionId: "session-old", threadId: "thread-old" },
      ready: false,
    });
    expect(restored).toEqual({
      epoch: { sessionId: "session-new", threadId: "thread-new" },
      ready: true,
    });
  });

  it("read model 延迟时应从同一 scene items 恢复 thread identity", () => {
    const item = {
      id: "item-mcp-app-1",
      thread_id: "thread-scene",
      turn_id: "turn-1",
      sequence: 1,
      status: "completed" as const,
      started_at: "2026-08-04T00:00:00.000Z",
      updated_at: "2026-08-04T00:00:01.000Z",
      type: "tool_call" as const,
      tool_name: "mcp__plugin__demo__report",
    };

    expect(resolveWorkspacePluginSurfaceThreadId(null, [item])).toBe(
      "thread-scene",
    );
    expect(
      resolveWorkspacePluginSurfaceThreadId("thread-read-model", [item]),
    ).toBe("thread-read-model");
    expect(
      resolveWorkspacePluginSurfaceThreadId(null, [
        item,
        { ...item, id: "item-2", thread_id: "thread-other" },
      ]),
    ).toBeNull();
  });

  it("冷恢复应重建同一 surface identity，用户关闭后不应再次投影", () => {
    const item = {
      id: "item-mcp-app-stable",
      thread_id: "thread-stable",
      turn_id: "turn-stable",
      sequence: 1,
      status: "completed" as const,
      started_at: "2026-08-04T00:00:00.000Z",
      updated_at: "2026-08-04T00:00:01.000Z",
      type: "tool_call" as const,
      tool_name: "mcp__plugin__demo__report",
      metadata: {
        canonical_type: "mcpToolCall",
        server: "plugin__demo__server",
        plugin_id: "demo-plugin",
        mcp_app_resource_uri: "ui://demo/report.html",
      },
    };
    const first = buildWorkspacePluginSurfacesFromThreadItems(
      [item],
      [],
      "thread-stable",
    );
    const restored = buildWorkspacePluginSurfacesFromThreadItems(
      [item],
      [],
      "thread-stable",
    );

    expect(restored).toEqual(first);
    expect(
      buildWorkspacePluginSurfacesFromThreadItems(
        [item],
        [first[0]?.containerId ?? ""],
        "thread-stable",
      ),
    ).toEqual([]);
  });
  it("应合并、聚焦和关闭 Plugin Surface 实例", () => {
    const report = {
      appId: "report-plugin",
      title: "Report",
      containerId: "mcp-app-item-report",
      mcpApp: {
        serverName: "lime_apps",
        connectorId: "report",
        resourceUri: "ui://report/view.html",
        toolItemId: "item-report",
      },
    };
    const calendar = {
      appId: "calendar-plugin",
      title: "Calendar",
      containerId: "mcp-app-item-calendar",
      mcpApp: {
        serverName: "lime_apps",
        connectorId: "calendar",
        resourceUri: "ui://calendar/view.html",
        toolItemId: "item-calendar",
      },
    };
    const merged = mergeWorkspacePluginSurfaceDescriptors([report], [calendar]);

    expect(merged).toEqual([report, calendar]);
    expect(
      resolveWorkspacePluginSurfaceActiveContainerId({
        activeContainerId: report.containerId,
        preferredContainerId: calendar.containerId,
        surfaces: merged,
      }),
    ).toBe(calendar.containerId);
    expect(
      selectWorkspacePluginSurfaceDescriptor(merged, calendar.containerId),
    ).toBe(calendar);
    expect(
      closeWorkspacePluginSurfaceDescriptor({
        activeContainerId: calendar.containerId,
        containerId: calendar.containerId,
        surfaces: merged,
      }),
    ).toEqual({
      activeContainerId: report.containerId,
      surfaces: [report],
    });
  });
});
