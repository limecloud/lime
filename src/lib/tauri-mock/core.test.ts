import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeViaHttp: vi.fn(),
  isDevBridgeAvailable: vi.fn(),
  normalizeDevBridgeError: vi.fn((cmd: string, error: unknown) => {
    if (error instanceof Error) {
      return new Error(`[${cmd}] ${error.message}`);
    }
    return new Error(`[${cmd}] ${String(error)}`);
  }),
}));

vi.mock("../dev-bridge/http-client", () => ({
  invokeViaHttp: mocks.invokeViaHttp,
  isDevBridgeAvailable: mocks.isDevBridgeAvailable,
  normalizeDevBridgeError: mocks.normalizeDevBridgeError,
}));

vi.mock("../dev-bridge/mockPriorityCommands", () => ({
  shouldPreferMockInBrowser: vi.fn(() => false),
}));

import { shouldPreferMockInBrowser } from "../dev-bridge/mockPriorityCommands";
import { clearMocks, invoke, invokeMockOnly } from "./core";

describe("tauri-mock/core invoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMocks();
    mocks.isDevBridgeAvailable.mockReturnValue(true);
  });

  it("浏览器模式下 direct invoke 走 HTTP bridge", async () => {
    mocks.invokeViaHttp.mockResolvedValueOnce("/real/backend/root");

    const result = await invoke<string>("workspace_get_projects_root");

    expect(result).toBe("/real/backend/root");
    expect(mocks.invokeViaHttp).toHaveBeenCalledWith(
      "workspace_get_projects_root",
      undefined,
    );
  });

  it("mock 优先命令直接返回默认 mock，不访问 bridge", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("list_plugin_tasks", { taskState: null, limit: 300 }),
    ).resolves.toEqual([]);

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("显式 mock 入口不应再次探测 HTTP bridge", async () => {
    await expect(invokeMockOnly("get_config")).resolves.toEqual(
      expect.objectContaining({
        server: expect.objectContaining({
          port: 8787,
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("默认项目 mock 应返回可规范化的工作区对象", async () => {
    await expect(
      invokeMockOnly("get_or_create_default_project"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "workspace-default",
        workspace_type: "general",
        is_default: true,
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("图层设计工程目录 mock 应支持保存与读取闭环", async () => {
    await expect(
      invokeMockOnly("save_layered_design_project_export", {
        request: {
          projectRootPath: "/mock/workspace",
          documentId: "mock-design",
          title: "Mock 图层设计",
          files: [
            {
              relativePath: "design.json",
              mimeType: "application/json",
              encoding: "utf8",
              content: "{}",
            },
            {
              relativePath: "assets/asset-subject.png",
              mimeType: "image/png",
              encoding: "base64",
              content: "YXNzZXQ=",
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        exportDirectoryRelativePath:
          ".lime/layered-designs/mock-design.layered-design",
        fileCount: 2,
        assetCount: 1,
      }),
    );

    await expect(
      invokeMockOnly("read_layered_design_project_export", {
        request: {
          projectRootPath: "/mock/workspace",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        exportDirectoryRelativePath:
          ".lime/layered-designs/mock-design.layered-design",
        designJson: expect.stringContaining("\"schemaVersion\""),
        fileCount: 4,
        assetCount: 0,
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("图层设计工程目录 mock 应把远程引用资产计入缓存后的文件数", async () => {
    await expect(
      invokeMockOnly("save_layered_design_project_export", {
        request: {
          projectRootPath: "/mock/workspace",
          documentId: "mock-remote-design",
          title: "Mock 远程图层设计",
          files: [
            {
              relativePath: "design.json",
              mimeType: "application/json",
              encoding: "utf8",
              content: "{\"assets\":[{\"id\":\"remote-asset\",\"src\":\"https://example.com/hero.png\"}]}",
            },
            {
              relativePath: "export-manifest.json",
              mimeType: "application/json",
              encoding: "utf8",
              content:
                "{\"assets\":[{\"id\":\"remote-asset\",\"source\":\"reference\",\"originalSrc\":\"https://example.com/hero.png\"}]}",
            },
            {
              relativePath: "preview.png",
              mimeType: "image/png",
              encoding: "base64",
              content: "cHJldmlldy1wbmc=",
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        exportDirectoryRelativePath:
          ".lime/layered-designs/mock-remote-design.layered-design",
        fileCount: 4,
        assetCount: 1,
      }),
    );
  });

  it("知识库 mock 应保持导入后的列表与详情一致", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValue(true);

    await expect(
      invoke("knowledge_list_packs", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        packs: [],
      }),
    );

    await expect(
      invoke("knowledge_import_source", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          packName: "brand-product-demo",
          description: "品牌产品知识包",
          packType: "brand-product",
          sourceFileName: "source.md",
          sourceText: "产品面向内容团队，禁止编造价格。",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        pack: expect.objectContaining({
          metadata: expect.objectContaining({
            name: "brand-product-demo",
            description: "品牌产品知识包",
            status: "needs-review",
          }),
        }),
      }),
    );

    await expect(
      invoke("knowledge_list_packs", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        packs: expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({
              name: "brand-product-demo",
              description: "品牌产品知识包",
            }),
          }),
        ]),
      }),
    );

    await expect(
      invoke("knowledge_get_pack", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          name: "brand-product-demo",
          description: "品牌产品知识包",
        }),
        sources: expect.arrayContaining([
          expect.objectContaining({
            relativePath: "sources/source.md",
            preview: "产品面向内容团队，禁止编造价格。",
          }),
        ]),
      }),
    );

    await expect(
      invoke("knowledge_update_pack_status", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
          status: "ready",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        previousStatus: "needs-review",
        clearedDefault: false,
        pack: expect.objectContaining({
          metadata: expect.objectContaining({
            status: "ready",
            trust: "user-confirmed",
          }),
        }),
      }),
    );

    await expect(
      invoke("knowledge_set_default_pack", {
        request: {
          workingDir: "/tmp/lime-knowledge-e2e",
          name: "brand-product-demo",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        defaultPackName: "brand-product-demo",
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp 自动化命令在浏览器模式下应返回结构化结果", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_create_automation_job", {
        intent: {
          launchIntent: {
            sceneappId: "daily-trend-briefing",
            workspaceId: "workspace-default",
            userInput: "关注 AI Agent 趋势",
          },
          runNow: true,
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sceneappId: "daily-trend-briefing",
        jobId: expect.any(String),
        runNowResult: expect.objectContaining({
          success_count: 1,
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp 运行前规划应返回 adapter plan 草稿", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "x-article-export",
          workspaceId: "workspace-default",
          projectId: "project-research",
          slots: {
            article_url: "https://x.com/openai/article/123",
            target_language: "中文",
          },
          runtimeContext: {
            browserSessionAttached: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 2,
          }),
        }),
        projectPackPlan: expect.objectContaining({
          completionStrategy: "required_parts_complete",
          requiredParts: ["index.md", "meta.json"],
        }),
        plan: expect.objectContaining({
          adapterPlan: expect.objectContaining({
            runtimeAction: "launch_browser_assist",
            targetRef: "x/article-export",
            preferredProfileKey: "general_browser_assist",
            launchPayload: expect.objectContaining({
              adapter_name: "x/article-export",
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp preview 规划不应自动写入 context snapshot", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValue(true);

    const firstPlan = await invoke("sceneapp_plan_launch", {
      intent: {
        sceneappId: "story-video-suite",
        workspaceId: "workspace-default",
        projectId: "project-video",
        userInput: "根据发布会亮点生成 30 秒短视频草稿",
        runtimeContext: {
          directorySessionReadyCompat: true,
        },
      },
    });

    const secondPlan = await invoke("sceneapp_plan_launch", {
      intent: {
        sceneappId: "story-video-suite",
        workspaceId: "workspace-default",
        projectId: "project-video",
        runtimeContext: {
          directorySessionReadyCompat: true,
        },
      },
    });

    expect(firstPlan).toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 1,
          }),
        }),
      }),
    );
    expect(secondPlan).toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            notes: expect.not.arrayContaining([
              expect.stringContaining("已从项目上下文恢复"),
              expect.stringContaining(
                "当前 planning 直接复用了 1 条项目级参考",
              ),
            ]),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp mock 应在同一项目内复用上一次 context snapshot", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValue(true);

    await expect(
      invoke("sceneapp_save_context_baseline", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          userInput: "根据发布会亮点生成 30 秒短视频草稿",
          runtimeContext: {
            directorySessionReadyCompat: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 1,
            notes: expect.arrayContaining([
              expect.stringContaining("已写入项目级 Context Snapshot"),
            ]),
          }),
          snapshot: expect.objectContaining({
            referenceItems: expect.arrayContaining([
              expect.objectContaining({
                usageCount: 1,
              }),
            ]),
          }),
        }),
      }),
    );

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          runtimeContext: {
            directorySessionReadyCompat: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 1,
            notes: expect.arrayContaining([
              expect.stringContaining("已从项目上下文恢复 1 条历史参考"),
              expect.stringContaining(
                "当前 planning 直接复用了 1 条项目级参考",
              ),
              expect.stringContaining("当前已复用项目级 TasteProfile"),
            ]),
          }),
          snapshot: expect.objectContaining({
            tasteProfile: expect.objectContaining({
              summary:
                "当前 TasteProfile 已在项目沉淀基础上，结合 1 条参考输入更新启发式摘要。",
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("legacy cloudSessionReady 输入也应继续产出 current service_scene planner", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          runtimeContext: {
            cloudSessionReady: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        plan: expect.objectContaining({
          bindingFamily: "agent_turn",
          adapterPlan: expect.objectContaining({
            adapterKind: "agent_turn",
            runtimeAction: "open_service_scene_session",
            requestMetadata: expect.objectContaining({
              harness: expect.objectContaining({
                service_scene_launch: expect.objectContaining({
                  kind: "local_service_skill",
                }),
              }),
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("SceneApp mock 应把 referenceMemoryIds 编译成正式参考对象并透传到 adapter 合同", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(
      invoke("sceneapp_plan_launch", {
        intent: {
          sceneappId: "story-video-suite",
          workspaceId: "workspace-default",
          projectId: "project-video",
          userInput: "把这次新品卖点整理成 30 秒短视频方案",
          referenceMemoryIds: ["memory-1", "memory-2"],
          runtimeContext: {
            directorySessionReadyCompat: true,
          },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          compilerPlan: expect.objectContaining({
            referenceCount: 3,
            notes: expect.arrayContaining([
              expect.stringContaining("显式带入 2 条灵感对象"),
            ]),
          }),
          snapshot: expect.objectContaining({
            referenceItems: expect.arrayContaining([
              expect.objectContaining({
                id: "memory:memory-1",
                label: "夏日短视频语气",
                sourceKind: "reference_library",
              }),
              expect.objectContaining({
                id: "memory:memory-2",
                label: "爆款封面参考",
                sourceKind: "reference_library",
              }),
            ]),
            tasteProfile: expect.objectContaining({
              keywords: expect.arrayContaining([
                "夏日短视频语气",
                "爆款封面参考",
              ]),
            }),
          }),
        }),
        plan: expect.objectContaining({
          adapterPlan: expect.objectContaining({
            launchPayload: expect.objectContaining({
              reference_memory_ids: ["memory-1", "memory-2"],
            }),
            requestMetadata: expect.objectContaining({
              sceneapp_reference_memory_ids: ["memory-1", "memory-2"],
              harness: expect.objectContaining({
                sceneapp_launch: expect.objectContaining({
                  reference_memory_ids: ["memory-1", "memory-2"],
                }),
              }),
            }),
          }),
        }),
      }),
    );

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("工具库存 fallback mock 不应再返回空壳清单", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
      const result = await invoke("agent_runtime_get_tool_inventory", {
        request: {
          caller: "assistant",
          browserAssist: true,
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          request: expect.objectContaining({
            caller: "assistant",
            surface: expect.objectContaining({
              browser_assist: true,
            }),
          }),
          default_allowed_tools: expect.arrayContaining([
            "ToolSearch",
            "ListMcpResourcesTool",
            "ReadMcpResourceTool",
            "WebSearch",
            "AskUserQuestion",
            "SendUserMessage",
            "Agent",
            "SendMessage",
            "TeamCreate",
            "TeamDelete",
            "ListPeers",
            "TaskCreate",
            "Workflow",
            "lime_site_recommend",
            "lime_site_run",
          ]),
          counts: expect.objectContaining({
            catalog_total: 46,
            registry_visible_total: expect.any(Number),
            extension_tool_total: 20,
            extension_tool_visible_total: 1,
            mcp_tool_total: 20,
            mcp_tool_visible_total: 1,
          }),
          catalog_tools: expect.arrayContaining([
            expect.objectContaining({ name: "ToolSearch" }),
            expect.objectContaining({ name: "ListMcpResourcesTool" }),
            expect.objectContaining({
              name: "Bash",
              permission_plane: "parameter_restricted",
              workspace_default_allow: false,
            }),
            expect.objectContaining({ name: "WebSearch" }),
            expect.objectContaining({
              name: "WebFetch",
              permission_plane: "parameter_restricted",
              workspace_default_allow: false,
            }),
            expect.objectContaining({ name: "SendUserMessage" }),
            expect.objectContaining({
              name: "StructuredOutput",
              permission_plane: "session_allowlist",
              workspace_default_allow: false,
            }),
            expect.objectContaining({ name: "RemoteTrigger" }),
            expect.objectContaining({ name: "CronCreate" }),
            expect.objectContaining({ name: "lime_site_list" }),
            expect.objectContaining({ name: "lime_site_run" }),
            expect.objectContaining({
              name: "mcp__lime-browser__",
              source: "browser_compatibility",
              permission_plane: "caller_filtered",
              workspace_default_allow: false,
            }),
          ]),
          extension_surfaces: expect.arrayContaining([
            expect.objectContaining({
              extension_name: "mcp__lime-browser",
              available_tools: expect.arrayContaining([
                "navigate",
                "click",
                "read_page",
                "get_page_text",
              ]),
              loaded_tools: ["mcp__lime-browser__navigate"],
              searchable_tools: expect.arrayContaining([
                "mcp__lime-browser__navigate",
                "mcp__lime-browser__click",
              ]),
            }),
          ]),
          registry_tools: expect.arrayContaining([
            expect.objectContaining({ name: "AskUserQuestion" }),
            expect.objectContaining({ name: "SendUserMessage" }),
            expect.objectContaining({ name: "StructuredOutput" }),
            expect.objectContaining({ name: "ReadMcpResourceTool" }),
            expect.objectContaining({ name: "EnterPlanMode" }),
            expect.objectContaining({ name: "SendMessage" }),
            expect.objectContaining({ name: "TeamCreate" }),
            expect.objectContaining({ name: "TeamDelete" }),
            expect.objectContaining({ name: "ListPeers" }),
            expect.objectContaining({ name: "CronList" }),
            expect.objectContaining({ name: "TaskOutput" }),
            expect.objectContaining({ name: "ExitWorktree" }),
            expect.objectContaining({ name: "lime_site_search" }),
          ]),
          extension_tools: expect.arrayContaining([
            expect.objectContaining({
              name: "mcp__lime-browser__navigate",
              status: "loaded",
              visible_in_context: true,
            }),
            expect.objectContaining({
              name: "mcp__lime-browser__click",
              status: "deferred",
              visible_in_context: false,
            }),
          ]),
          mcp_tools: expect.arrayContaining([
            expect.objectContaining({
              name: "mcp__lime-browser__navigate",
              always_visible: true,
              visible_in_context: true,
              tags: ["browser", "write"],
            }),
            expect.objectContaining({
              name: "mcp__lime-browser__click",
              deferred_loading: true,
              visible_in_context: false,
              tags: ["browser", "write"],
            }),
          ]),
        }),
      );
      expect(result.default_allowed_tools).not.toContain("StructuredOutput");
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("review decision mock 应阻止 denied 权限确认保存为 accepted", async () => {
    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "accepted",
          decision_summary: "错误接受被拒绝的权限确认。",
          risk_level: "low",
        },
      }),
    ).rejects.toThrow("真实权限确认已被拒绝");

    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "rejected",
          decision_summary: "权限确认已拒绝，拒绝本次交付。",
          risk_level: "high",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        permission_confirmation_status: "denied",
        decision: expect.objectContaining({
          decision_status: "rejected",
        }),
      }),
    );
  });

  it("review decision mock 应阻止未解决权限确认保存为 accepted", async () => {
    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "accepted",
          decision_summary: "错误接受尚未发起审批的权限确认。",
          risk_level: "low",
          permission_status: "requires_confirmation",
          permission_confirmation_status: "not_requested",
          permission_confirmation_source: "declared_profile_only",
        },
      }),
    ).rejects.toThrow("权限确认尚未解决");

    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "rejected",
          decision_summary: "权限确认未解决，拒绝本次交付。",
          risk_level: "high",
          permission_status: "requires_confirmation",
          permission_confirmation_status: "not_requested",
          permission_confirmation_source: "declared_profile_only",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        permission_confirmation_status: "not_requested",
        permission_confirmation_source: "declared_profile_only",
        decision: expect.objectContaining({
          decision_status: "rejected",
        }),
      }),
    );
  });

  it("review decision mock 应阻止用户锁定能力缺口保存为 accepted", async () => {
    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "accepted",
          decision_summary: "错误接受模型锁定能力缺口。",
          risk_level: "low",
          limit_status: "user_locked_capability_gap",
          capability_gap: "browser_reasoning_candidate_missing",
          permission_status: "not_required",
          permission_confirmation_status: "resolved",
        },
      }),
    ).rejects.toThrow("显式用户模型锁定");

    await expect(
      invokeMockOnly("agent_runtime_save_review_decision", {
        request: {
          session_id: "mock-session",
          decision_status: "rejected",
          decision_summary: "模型锁定能力缺口未解决，拒绝本次交付。",
          risk_level: "high",
          limit_status: "user_locked_capability_gap",
          capability_gap: "browser_reasoning_candidate_missing",
          permission_status: "not_required",
          permission_confirmation_status: "resolved",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        limit_status: "user_locked_capability_gap",
        capability_gap: "browser_reasoning_candidate_missing",
        user_locked_capability_summary: expect.stringContaining(
          "显式用户模型锁定不满足当前 execution profile",
        ),
        decision: expect.objectContaining({
          decision_status: "rejected",
        }),
      }),
    );
  });

  it("工具库存 fallback mock 应按 workbench + browser surface 补齐当前工具面", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
      const result = await invoke("agent_runtime_get_tool_inventory", {
        request: {
          caller: "assistant",
          workbench: true,
          browserAssist: true,
        },
      });

      expect(result.request.surface).toEqual(
        expect.objectContaining({
          workbench: true,
          browser_assist: true,
        }),
      );
      expect(result.counts.catalog_total).toBe(57);
      expect(result.default_allowed_tools).toEqual(
        expect.arrayContaining([
          "social_generate_cover_image",
          "lime_create_image_generation_task",
          "lime_create_transcription_task",
          "lime_run_service_skill",
          "lime_site_recommend",
          "lime_site_run",
        ]),
      );
      expect(result.default_allowed_tools).not.toContain("mcp__lime-browser__");
      expect(result.catalog_tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "social_generate_cover_image" }),
          expect.objectContaining({
            name: "lime_create_image_generation_task",
          }),
          expect.objectContaining({ name: "lime_run_service_skill" }),
          expect.objectContaining({ name: "lime_site_recommend" }),
          expect.objectContaining({ name: "mcp__lime-browser__" }),
        ]),
      );
      expect(result.registry_tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "social_generate_cover_image" }),
          expect.objectContaining({ name: "lime_search_web_images" }),
          expect.objectContaining({ name: "lime_create_typesetting_task" }),
          expect.objectContaining({ name: "lime_site_info" }),
        ]),
      );
      expect(result.counts.mcp_tool_total).toBe(20);
      expect(result.mcp_tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "mcp__lime-browser__navigate" }),
          expect.objectContaining({ name: "mcp__lime-browser__read_page" }),
          expect.objectContaining({ name: "mcp__lime-browser__click" }),
        ]),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("bridge 失败且命令存在 mock 时回退默认 mock 数据", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(invoke("workspace_get_projects_root")).resolves.toBe(
        "/mock/workspace/projects",
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("媒体任务命令在 bridge 失败时应回退统一 task file mock 协议", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(
        invoke("list_media_task_artifacts", {
          request: {
            projectRootPath: "/mock/workspace",
            taskFamily: "image",
            threadId: "thread-image-mock-1",
            turnId: "turn-image-mock-1",
            contentId: "content-image-mock-1",
            model: "gpt-image-1",
            costState: { status: "estimated", estimatedCostClass: "low" },
            limitState: { status: "within_limit" },
            limitEvent: { eventKind: "quota_low" },
          },
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          success: true,
          total: 1,
          modality_runtime_contracts: expect.objectContaining({
            snapshot_count: 1,
            contract_keys: ["image_generation"],
            entry_keys: ["at_image_command"],
            thread_ids: ["thread-image-mock-1"],
            turn_ids: ["turn-image-mock-1"],
            content_ids: ["content-image-mock-1"],
            modalities: ["image"],
            skill_ids: ["image_generate"],
            model_ids: ["gpt-image-1"],
            cost_states: ["estimated"],
            limit_states: ["within_limit"],
            estimated_cost_classes: ["low"],
            limit_event_kinds: ["quota_low"],
            quota_low_count: 1,
            execution_profile_keys: ["image_generation_profile"],
            executor_adapter_keys: ["skill:image_generate"],
            executor_kinds: ["skill"],
            executor_binding_keys: ["image_generate"],
            limecore_policy_refs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_snapshot_count: 1,
            limecore_policy_decisions: ["allow"],
            limecore_policy_decision_sources: ["local_default_policy"],
            limecore_policy_unresolved_refs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_missing_inputs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_pending_hit_refs: [
              "model_catalog",
              "provider_offer",
              "tenant_feature_flags",
            ],
            limecore_policy_value_hit_count: 0,
            snapshots: expect.arrayContaining([
              expect.objectContaining({
                entry_key: "at_image_command",
                thread_id: "thread-image-mock-1",
                turn_id: "turn-image-mock-1",
                content_id: "content-image-mock-1",
                modality: "image",
                skill_id: "image_generate",
                model_id: "gpt-image-1",
                cost_state: "estimated",
                limit_state: "within_limit",
                estimated_cost_class: "low",
                limit_event_kind: "quota_low",
                quota_low: true,
                executor_kind: "skill",
                executor_binding_key: "image_generate",
                limecore_policy_refs: [
                  "model_catalog",
                  "provider_offer",
                  "tenant_feature_flags",
                ],
                limecore_policy_snapshot_status: "local_defaults_evaluated",
                limecore_policy_decision_source: "local_default_policy",
                limecore_policy_missing_inputs: [
                  "model_catalog",
                  "provider_offer",
                  "tenant_feature_flags",
                ],
                limecore_policy_pending_hit_refs: [
                  "model_catalog",
                  "provider_offer",
                  "tenant_feature_flags",
                ],
                limecore_policy_value_hits: [],
                limecore_policy_value_hit_count: 0,
              }),
            ]),
          }),
          tasks: expect.arrayContaining([
            expect.objectContaining({
              task_type: "image_generate",
              task_family: "image",
            }),
          ]),
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("媒体任务 mock 在 taskRef 为绝对 task file 时也应保持稳定 task_id", async () => {
    mocks.isDevBridgeAvailable.mockReturnValue(false);

    const directResult = await invoke("get_media_task_artifact", {
      request: {
        projectRootPath: "/mock/workspace",
        taskRef: "task-image-mock-1",
      },
    });
    const absolutePathResult = await invoke("get_media_task_artifact", {
      request: {
        projectRootPath: "/mock/workspace",
        taskRef:
          "/mock/workspace/.lime/tasks/image_generate/task-image-mock-1.json",
      },
    });

    expect(directResult).toEqual(
      expect.objectContaining({
        task_id: "task-image-mock-1",
        path: ".lime/tasks/image_generate/task-image-mock-1.json",
      }),
    );
    expect(absolutePathResult).toEqual(
      expect.objectContaining({
        task_id: "task-image-mock-1",
        path: ".lime/tasks/image_generate/task-image-mock-1.json",
      }),
    );
  });

  it("音频任务命令在 bridge 失败时应回退 voice_generation task file mock 协议", async () => {
    mocks.isDevBridgeAvailable.mockReturnValue(false);

    await expect(
      invoke("create_audio_generation_task_artifact", {
        request: {
          projectRootPath: "/mock/workspace",
          sourceText: "请生成温暖旁白",
          voice: "warm_narrator",
          modalityContractKey: "voice_generation",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        task_type: "audio_generate",
        task_family: "audio",
        path: ".lime/tasks/audio_generate/task-audio-mock-1.json",
        record: expect.objectContaining({
          payload: expect.objectContaining({
            modality_contract_key: "voice_generation",
            modality: "audio",
            routing_slot: "voice_generation_model",
            audio_output: expect.objectContaining({
              kind: "audio_output",
              status: "pending",
              mime_type: "audio/mpeg",
            }),
          }),
        }),
      }),
    );

    await expect(
      invoke("list_media_task_artifacts", {
        request: {
          projectRootPath: "/mock/workspace",
          taskFamily: "audio",
          taskType: "audio_generate",
          modalityContractKey: "voice_generation",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        modality_runtime_contracts: expect.objectContaining({
          contract_keys: ["voice_generation"],
          execution_profile_keys: ["voice_generation_profile"],
          executor_adapter_keys: ["service_skill:voice_runtime"],
          limecore_policy_refs: [
            "client_scenes",
            "tenant_feature_flags",
            "provider_offer",
          ],
          limecore_policy_snapshot_count: 1,
          audio_output_count: 1,
          audio_output_statuses: [{ status: "pending", count: 1 }],
          snapshots: expect.arrayContaining([
            expect.objectContaining({
              task_type: "audio_generate",
              contract_key: "voice_generation",
              execution_profile_key: "voice_generation_profile",
              executor_adapter_key: "service_skill:voice_runtime",
              executor_kind: "service_skill",
              executor_binding_key: "voice_runtime",
              limecore_policy_refs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_snapshot_status: "local_defaults_evaluated",
              limecore_policy_decision: "allow",
              limecore_policy_decision_source: "local_default_policy",
              limecore_policy_unresolved_refs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_missing_inputs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_pending_hit_refs: [
                "client_scenes",
                "tenant_feature_flags",
                "provider_offer",
              ],
              limecore_policy_value_hits: [],
              limecore_policy_value_hit_count: 0,
              routing_event: "executor_invoked",
              audio_output_status: "pending",
            }),
          ]),
        }),
      }),
    );

    await expect(
      invoke("complete_audio_generation_task_artifact", {
        request: {
          projectRootPath: "/mock/workspace",
          taskRef: "task-audio-mock-1",
          audioPath: ".lime/runtime/audio/task-audio-mock-1.mp3",
          mimeType: "audio/mpeg",
          durationMs: 1800,
          providerId: "limecore",
          model: "voice-pro",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        task_type: "audio_generate",
        task_family: "audio",
        normalized_status: "succeeded",
        record: expect.objectContaining({
          payload: expect.objectContaining({
            audio_path: ".lime/runtime/audio/task-audio-mock-1.mp3",
            audio_output: expect.objectContaining({
              status: "completed",
              audio_path: ".lime/runtime/audio/task-audio-mock-1.mp3",
              duration_ms: 1800,
            }),
          }),
          result: expect.objectContaining({
            status: "completed",
            audio_path: ".lime/runtime/audio/task-audio-mock-1.mp3",
          }),
        }),
      }),
    );
  });

  it("OpenClaw 环境状态命令在 bridge 失败时回退默认 mock", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(invoke("openclaw_get_environment_status")).resolves.toEqual(
        expect.objectContaining({
          recommendedAction: "install_openclaw",
          summary: "运行环境已就绪，可以继续一键安装 OpenClaw。",
          diagnostics: expect.objectContaining({
            npmPath: "/opt/homebrew/bin/npm",
            npmGlobalPrefix: "/opt/homebrew",
          }),
          node: expect.objectContaining({ status: "ok" }),
          git: expect.objectContaining({ status: "ok" }),
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("旧 Agent 命令别名应直接报废弃错误，不再静默返回 mock 成功结果", async () => {
    mocks.isDevBridgeAvailable.mockReturnValue(false);

    await expect(invoke("list_agent_sessions")).rejects.toThrow(
      "命令 list_agent_sessions 已废弃，请迁移到 agent_runtime_list_sessions",
    );
    await expect(invoke("get_agent_process_status")).rejects.toThrow(
      "命令 get_agent_process_status 已废弃，请迁移到 agent_get_process_status",
    );
  });
});
