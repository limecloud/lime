import { describe, expect, it } from "vitest";
import {
  buildSceneAppLaunchIntentFromAutomationContext,
  resolveSceneAppAutomationContext,
  resolveSceneAppAutomationContextFromMetadataRecord,
} from "./automation";

describe("sceneapp automation helpers", () => {
  it("应从自动化 payload 里解析 sceneapp 上下文", () => {
    const context = resolveSceneAppAutomationContext({
      kind: "agent_turn",
      prompt: "请执行 SceneApp 自动化任务。",
      system_prompt: null,
      web_search: false,
      content_id: null,
      request_metadata: {
        sceneapp: {
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
          sceneapp_type: "local_durable",
          delivery_contract: "project_pack",
        },
        harness: {
          sceneapp_id: "daily-trend-briefing",
          entry_source: "sceneapp_detail_preview",
          workspace_id: "workspace-default",
          project_id: "workspace-default",
          sceneapp_launch: {
            sceneapp_id: "daily-trend-briefing",
            entry_source: "sceneapp_detail_preview",
            workspace_id: "workspace-default",
            project_id: "workspace-default",
            reference_memory_ids: ["memory-1", "memory-2"],
          },
        },
        sceneapp_reference_memory_ids: ["memory-2", "memory-3"],
        sceneapp_slots: {
          platform: "X / Twitter",
          tone: "daily",
        },
      },
    });

    expect(context).toEqual({
      sceneappId: "daily-trend-briefing",
      title: "每日趋势摘要",
      sceneappType: "local_durable",
      deliveryContract: "project_pack",
      entrySource: "sceneapp_detail_preview",
      workspaceId: "workspace-default",
      projectId: "workspace-default",
      referenceMemoryIds: ["memory-2", "memory-3"],
      slots: {
        platform: "X / Twitter",
        tone: "daily",
      },
    });
  });

  it("应从嵌套 request_metadata 里解析 sceneapp 上下文", () => {
    const context = resolveSceneAppAutomationContextFromMetadataRecord({
      request_metadata: {
        sceneapp: {
          id: "story-video-suite",
          title: "故事短视频套件",
        },
        harness: {
          sceneapp_launch: {
            sceneapp_id: "story-video-suite",
            entry_source: "sceneapp_card",
            workspace_id: "project-story",
            project_id: "project-story",
          },
        },
      },
    });

    expect(context).toEqual({
      sceneappId: "story-video-suite",
      title: "故事短视频套件",
      entrySource: "sceneapp_card",
      workspaceId: "project-story",
      projectId: "project-story",
    });
  });

  it("应把自动化上下文回编译成 planning intent", () => {
    expect(
      buildSceneAppLaunchIntentFromAutomationContext({
        sceneappId: "x-article-export",
        entrySource: "sceneapp_detail_preview",
        workspaceId: "workspace-1",
        referenceMemoryIds: ["memory-1"],
        slots: {
          article_url: "https://example.com/post",
        },
      }),
    ).toEqual({
      sceneappId: "x-article-export",
      entrySource: "sceneapp_detail_preview",
      workspaceId: "workspace-1",
      projectId: "workspace-1",
      referenceMemoryIds: ["memory-1"],
      slots: {
        article_url: "https://example.com/post",
      },
    });
  });
});
