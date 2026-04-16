import { describe, expect, it } from "vitest";

import agentCommandCatalog from "./agentCommandCatalog.json";
import legacySurfaceCatalogJson from "./legacySurfaceCatalog.json";

describe("legacySurfaceCatalog", () => {
  it("应提供完整且无重复的治理扫描目录册", () => {
    const catalog = legacySurfaceCatalogJson;
    const groups = [
      catalog.imports,
      catalog.commands,
      catalog.frontendText,
      catalog.rustText,
      catalog.rustTextCounts,
    ];

    expect(groups.every(Array.isArray)).toBe(true);
    expect(catalog.imports.length).toBeGreaterThan(0);
    expect(catalog.commands.length).toBeGreaterThan(0);
    expect(catalog.frontendText.length).toBeGreaterThan(0);
    expect(catalog.rustText.length).toBeGreaterThan(0);
    expect(catalog.rustTextCounts.length).toBeGreaterThan(0);

    const ids = groups.flat().map((monitor) => monitor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("命令目录册不应继续携带 legacy surface 扫描数据", () => {
    expect("legacyCommandSurfaceMonitors" in agentCommandCatalog).toBe(false);
    expect("legacyHelperSurfaceMonitors" in agentCommandCatalog).toBe(false);
  });

  it("应将旧海报素材命令与 helper 收敛到图库主链", () => {
    expect(agentCommandCatalog.deprecatedCommandReplacements).toMatchObject({
      create_poster_metadata: "create_gallery_material_metadata",
      get_poster_metadata: "get_gallery_material_metadata",
      get_poster_material: "get_gallery_material",
      update_poster_metadata: "update_gallery_material_metadata",
      delete_poster_metadata: "delete_gallery_material_metadata",
      list_by_image_category: "list_gallery_materials_by_image_category",
      list_by_layout_category: "list_gallery_materials_by_layout_category",
      list_by_mood: "list_gallery_materials_by_mood",
    });
    expect(agentCommandCatalog.deprecatedHelperReplacements).toMatchObject({
      getPosterMaterial: "getGalleryMaterial",
      createPosterMetadata: "createGalleryMetadata",
      updatePosterMetadata: "updateGalleryMetadata",
      deletePosterMetadata: "deleteGalleryMetadata",
      listPosterMaterialsByImageCategory: "listGalleryMaterialsByImageCategory",
      listPosterMaterialsByLayoutCategory:
        "listGalleryMaterialsByLayoutCategory",
      listPosterMaterialsByMood: "listGalleryMaterialsByMood",
      usePosterMaterial: "useGalleryMaterial",
    });
  });

  it("应记录已删除的旧 SubAgent scheduler Rust 模块路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "team-subagent-scheduler-rust-modules",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src-tauri/src/commands/subagent_cmd.rs",
      "src-tauri/src/agent/subagent_scheduler.rs",
    ]);
  });

  it("应将旧 SubAgent scheduler 命令与事件总线标记为已删除 surface", () => {
    const commandMonitor = legacySurfaceCatalogJson.commands.find(
      (entry) => entry.id === "team-subagent-scheduler-commands",
    );
    const frontendEventMonitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "frontend-subagent-scheduler-event-bus",
    );
    const rustEventMonitor = legacySurfaceCatalogJson.rustText.find(
      (entry) => entry.id === "rust-subagent-scheduler-event-bus",
    );

    expect(commandMonitor).toBeTruthy();
    expect(commandMonitor?.classification).toBe("dead-candidate");
    expect(commandMonitor?.allowedPaths).toEqual([]);
    expect(commandMonitor?.commands).toEqual([
      "init_subagent_scheduler",
      "execute_subagent_tasks",
      "cancel_subagent_tasks",
    ]);

    expect(frontendEventMonitor).toBeTruthy();
    expect(frontendEventMonitor?.classification).toBe("dead-candidate");
    expect(frontendEventMonitor?.allowedPaths).toEqual([]);

    expect(rustEventMonitor).toBeTruthy();
    expect(rustEventMonitor?.classification).toBe("dead-candidate");
    expect(rustEventMonitor?.allowedPaths).toEqual([]);
  });

  it("应禁止 SkillSelectorPanel 旧面板路径重新回流", () => {
    const legacyPanelPath = `./${"SkillSelectorPanel"}`;
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-skill-selector-panel-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual(
      expect.arrayContaining([
        `from "${legacyPanelPath}"`,
        `import('${legacyPanelPath}')`,
      ]),
    );
  });

  it("应记录 Inputbar 已删除的 A2UI 浮层桥接入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "inputbar-a2ui-overlay-bridge-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(
      expect.arrayContaining([
        "src/components/agent/chat/components/Inputbar/components/A2UIFloatingForm.tsx",
        "src/components/agent/chat/components/Inputbar/hooks/useInputbarDisplayState.ts",
      ]),
    );
  });

  it("应记录已删除的 WorkspacePendingA2UIDialog 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "workspace-pending-a2ui-dialog-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(
      expect.arrayContaining([
        "src/components/agent/chat/workspace/WorkspacePendingA2UIDialog.tsx",
        "src/components/agent/chat/workspace/WorkspacePendingA2UIDialog.test.tsx",
      ]),
    );
  });

  it("应记录已删除的工作区创建确认策略 helper 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "workspace-create-confirmation-policy-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/workspace/utils/createConfirmationPolicy.ts",
    ]);
  });

  it("应记录已迁出 Inputbar 的 A2UI 提示 helper", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "inputbar-a2ui-dialog-helper-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(
      expect.arrayContaining([
        "src/components/agent/chat/components/Inputbar/components/A2UISubmissionNotice.tsx",
        "src/components/agent/chat/components/Inputbar/hooks/useA2UISubmissionNotice.ts",
        "src/components/agent/chat/components/Inputbar/hooks/useStickyA2UIForm.ts",
      ]),
    );
  });

  it("应记录已迁出 Inputbar 的工作流输入状态 helper", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "inputbar-workflow-input-state-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(
      expect.arrayContaining([
        "src/components/agent/chat/components/Inputbar/hooks/useThemeWorkbenchInputState.ts",
        "src/components/agent/chat/components/Inputbar/hooks/useThemeWorkbenchInputState.test.ts",
      ]),
    );
  });

  it("应记录已删除的旧工作区 runtime 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "workspace-theme-workbench-runtime-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchRuntime.ts",
    ]);
  });

  it("应记录已删除的旧工作流布局 helper 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "workflow-layout-legacy-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/utils/themeWorkbenchLayout.ts",
      "src/components/agent/chat/utils/themeWorkbenchLayout.test.ts",
    ]);
  });

  it("应记录已删除的旧工作区主题工作台 runtime 壳文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "workspace-theme-workbench-runtime-shell-entries",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchSidebarRuntime.ts",
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchSidebarRuntime.test.tsx",
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchScaffoldRuntime.ts",
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchScaffoldRuntime.test.tsx",
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchVersionStatusRuntime.ts",
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchDocumentPersistenceRuntime.ts",
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchShellRuntime.tsx",
    ]);
  });

  it("应记录已删除的旧工作区主题工作台 helper 与 sidebar 壳文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) =>
        entry.id ===
        "workspace-theme-workbench-helper-and-sidebar-shell-entries",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/workspace/themeWorkbenchHelpers.ts",
      "src/components/agent/chat/workspace/themeWorkbenchHelpers.test.ts",
      "src/components/agent/chat/workspace/ThemeWorkbenchSidebarSection.tsx",
      "src/components/agent/chat/workspace/useThemeWorkbenchSidebarPresentation.tsx",
    ]);
  });

  it("应记录已删除的 general workbench entry hooks 旧文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "general-workbench-entry-hook-legacy-paths",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/hooks/useThemeWorkbenchEntryPrompt.ts",
      "src/components/agent/chat/hooks/useThemeWorkbenchEntryPrompt.test.tsx",
      "src/components/agent/chat/hooks/useThemeWorkbenchEntryPromptActions.ts",
      "src/components/agent/chat/hooks/useThemeWorkbenchEntryPromptActions.test.tsx",
      "src/components/agent/chat/hooks/useThemeWorkbenchSendBoundary.ts",
      "src/components/agent/chat/hooks/useThemeWorkbenchSendBoundary.test.tsx",
    ]);
  });

  it("应记录已删除的 general workbench entry prompt accessory 旧文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) =>
        entry.id === "general-workbench-entry-prompt-accessory-legacy-paths",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/components/ThemeWorkbenchEntryPromptAccessory.tsx",
      "src/components/agent/chat/components/ThemeWorkbenchEntryPromptAccessory.test.tsx",
    ]);
  });

  it("应记录已删除的 general workbench sidebar 壳旧文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "general-workbench-sidebar-shell-legacy-paths",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/components/ThemeWorkbenchHarnessCard.tsx",
      "src/components/agent/chat/workspace/WorkspaceThemeSidebar.tsx",
    ]);
  });

  it("应记录已删除的 general workbench sidebar 展示壳旧文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "general-workbench-sidebar-display-legacy-paths",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/components/ThemeWorkbenchSidebar.tsx",
      "src/components/agent/chat/components/ThemeWorkbenchSidebar.test.tsx",
      "src/components/agent/chat/components/ThemeWorkbenchSidebarShell.tsx",
      "src/components/agent/chat/components/ThemeWorkbenchSidebarPanels.tsx",
    ]);
  });

  it("应记录已删除的 general workbench sidebar 支撑层旧文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "general-workbench-sidebar-support-legacy-paths",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/components/ThemeWorkbenchContextPanel.tsx",
      "src/components/agent/chat/components/ThemeWorkbenchExecLog.tsx",
      "src/components/agent/chat/components/ThemeWorkbenchWorkflowPanel.tsx",
      "src/components/agent/chat/components/buildThemeWorkbenchContextPanelProps.ts",
      "src/components/agent/chat/components/buildThemeWorkbenchExecLogProps.ts",
      "src/components/agent/chat/components/buildThemeWorkbenchWorkflowPanelProps.ts",
      "src/components/agent/chat/components/buildThemeWorkbenchSidebarOrchestrationSource.ts",
      "src/components/agent/chat/components/themeWorkbenchContextData.ts",
      "src/components/agent/chat/components/themeWorkbenchExecLogData.ts",
      "src/components/agent/chat/components/themeWorkbenchWorkflowData.ts",
      "src/components/agent/chat/components/themeWorkbenchWorkflowData.test.ts",
      "src/components/agent/chat/components/themeWorkbenchSidebarComparator.ts",
      "src/components/agent/chat/components/themeWorkbenchSidebarContentContract.ts",
      "src/components/agent/chat/components/themeWorkbenchSidebarContract.ts",
      "src/components/agent/chat/components/themeWorkbenchSidebarOrchestrationContract.ts",
      "src/components/agent/chat/components/themeWorkbenchSidebarShared.ts",
      "src/components/agent/chat/components/useThemeWorkbenchArtifactActions.ts",
      "src/components/agent/chat/components/useThemeWorkbenchContextPanelState.ts",
      "src/components/agent/chat/components/useThemeWorkbenchExecLogState.ts",
      "src/components/agent/chat/components/useThemeWorkbenchSidebarOrchestration.ts",
      "src/components/agent/chat/components/useThemeWorkbenchSidebarTelemetry.ts",
      "src/components/agent/chat/components/useThemeWorkbenchWorkflowPanelState.ts",
    ]);
  });

  it("应记录已删除的 ThemeWorkbenchSkillsPanel 孤岛组件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "theme-workbench-skills-panel-legacy-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/components/ThemeWorkbenchSkillsPanel.tsx",
      "src/components/agent/chat/components/ThemeWorkbenchSkillsPanel.test.tsx",
    ]);
  });

  it("应记录已删除的 WorkspaceSelector 旧入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "workspace-selector-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/workspace/WorkspaceSelector.tsx",
    ]);
  });

  it("应记录已删除的 LegacyChannelsWorkbench 旧路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "channels-legacy-debug-workbench-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/system/channels/LegacyChannelsWorkbench.tsx",
      "src/components/settings-v2/system/channels/LegacyChannelsWorkbench.test.tsx",
    ]);
  });

  it("应记录已删除的 API compatibility 旧前端网关", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "api-compatibility-gateway-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/api/apiCompatibility.ts",
      "src/lib/api/apiCompatibility.test.ts",
    ]);
  });

  it("应记录已删除的 provider-pool 旧模型库页面簇", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "provider-pool-model-registry-tabs",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/provider-pool/EnhancedModelsTab.tsx",
      "src/components/provider-pool/ModelRegistryTab.tsx",
    ]);
  });

  it("应记录已删除的 provider-pool 独立凭证表单与 barrel 入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "provider-pool-standalone-credential-forms",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/provider-pool/credential-forms/AntigravityFormStandalone.tsx",
      "src/components/provider-pool/credential-forms/ClaudeFormStandalone.tsx",
      "src/components/provider-pool/credential-forms/GeminiFormStandalone.tsx",
      "src/components/provider-pool/credential-forms/KiroFormStandalone.tsx",
      "src/components/provider-pool/credential-forms/index.ts",
    ]);
  });

  it("应记录已删除的 Agent Chat 固定后端 compat 配置壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "agent-chat-fixed-backend-config-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/components/agent/chat/config.ts"]);
  });

  it("应记录已删除的稳定处理中提示组件与 Hook", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "stable-processing-notice-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/components/StableProcessingNotice.tsx",
      "src/components/agent/chat/hooks/useStableProcessingNotice.ts",
    ]);
  });

  it("应记录已删除的零入口 RadioGroup UI primitive", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "ui-radio-group-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/components/ui/radio-group.tsx"]);
  });

  it("应记录已删除的零入口 Separator UI primitive", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "ui-separator-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/components/ui/separator.tsx"]);
  });

  it("应记录已删除的前端 plugin-ui 渲染链", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "plugin-ui-frontend-runtime-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(
      expect.arrayContaining([
        "src/lib/plugin-ui/ComponentRegistry.ts",
        "src/lib/plugin-ui/DataStore.ts",
        "src/lib/plugin-ui/PluginUIContainer.tsx",
        "src/lib/plugin-ui/PluginUIRenderer.tsx",
        "src/lib/plugin-ui/SurfaceManager.ts",
        "src/lib/plugin-ui/index.ts",
        "src/lib/plugin-ui/usePluginUI.ts",
      ]),
    );
  });

  it("应记录已删除的零入口 Alert UI primitive", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "ui-alert-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/components/ui/alert.tsx"]);
  });

  it("应记录已删除的旧块系统与独立 workspace store", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "blocks-workspace-legacy-runtime-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/blocks/BlockFrame.tsx",
      "src/components/blocks/PreviewBlock.tsx",
      "src/components/blocks/TerminalBlock.tsx",
      "src/components/blocks/WebBlock.tsx",
      "src/components/preview/ImagePreview.tsx",
      "src/lib/blocks/blockStore.ts",
      "src/lib/blocks/index.ts",
      "src/lib/blocks/registry.ts",
      "src/lib/blocks/types.ts",
      "src/lib/workspace/types.ts",
      "src/lib/workspace/workspaceStore.ts",
    ]);
  });

  it("应记录已删除的零入口 barrel 导出文件", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "zero-entry-barrel-export-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/hooks/index.ts",
      "src/lib/artifact/index.ts",
      "src/types/index.ts",
    ]);
  });

  it("应记录已删除的 writeFile 旧解析模块", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "write-file-legacy-module",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/writeFile/index.ts",
      "src/lib/writeFile/parser.ts",
      "src/lib/writeFile/README.md",
    ]);
  });

  it("应记录已删除的零引用前端工具模块", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "unused-frontend-utility-modules",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/notifications.ts",
      "src/lib/tauri-event.ts",
      "src/lib/tauri-event.test.ts",
      "src/lib/utils/syntaxHighlight.ts",
    ]);
  });

  it("应记录已删除的独立 API Key 格式校验 helper", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "api-key-validation-helper-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/utils/apiKeyValidation.ts",
      "src/lib/utils/apiKeyValidation.test.ts",
    ]);
  });

  it("应记录已删除的零入口前端 persona / auto-fix / sysinfo API 包装壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "isolated-frontend-api-wrapper-shells",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/api/personas.ts",
      "src/lib/api/personas.test.ts",
      "src/lib/api/autoFix.ts",
      "src/lib/api/autoFix.test.ts",
      "src/lib/api/sysinfo.ts",
      "src/lib/api/sysinfo.test.ts",
    ]);
  });

  it("应记录已删除的旧 WebSocket 状态组件入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "websocket-status-widget-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/websocket/WebSocketStatus.tsx",
    ]);
  });

  it("应记录已删除的旧 SubAgent 展示壳入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "subagent-progress-display-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/subagent/SubAgentProgress.tsx",
      "src/components/subagent/index.ts",
    ]);
  });

  it("应记录已删除的 OpenClaw Dashboard 内嵌 frame 旧入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "openclaw-dashboard-frame-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/openclaw/OpenClawDashboardFrame.tsx",
    ]);
  });

  it("应记录已删除的电商差评回复旧前端页面与 API 网关", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "ecommerce-review-reply-frontend-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/solutions/ecommerce-review-reply/GuideStep.tsx",
      "src/solutions/ecommerce-review-reply/Results.tsx",
      "src/solutions/ecommerce-review-reply/Tasks.tsx",
      "src/solutions/ecommerce-review-reply/index.tsx",
      "src/lib/api/ecommerce-review-reply.ts",
    ]);
  });

  it("应记录已删除的记忆反馈旧前端侧链", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "memory-feedback-frontend-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/memory/MemoryFeedback.tsx",
      "src/components/memory/FeedbackStats.tsx",
      "src/lib/api/memoryFeedback.ts",
      "src/lib/api/memoryFeedback.test.ts",
    ]);
  });

  it("应记录已删除的思考模型切换推导 helper", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "thinking-model-resolver-helper-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/model/thinkingModelResolver.ts",
      "src/lib/model/thinkingModelResolver.test.ts",
    ]);
  });

  it("应记录已删除的桌宠快动作与对话 helper 侧链", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "companion-pet-quick-actions-helper-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/companion/petQuickActions.ts",
      "src/lib/companion/petQuickActions.test.ts",
    ]);
  });

  it("应记录已删除的零入口工作区 helper 与 prompt cache 提示壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "isolated-workspace-helper-notice-surfaces",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/memory/memoryEntryCreationSeed.ts",
      "src/components/memory/memoryEntryCreationSeed.test.ts",
      "src/components/agent/chat/utils/styleRuntime.ts",
      "src/components/agent/chat/utils/styleRuntime.test.ts",
      "src/components/agent/chat/components/Inputbar/components/InputbarPromptCacheNotice.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarPromptCacheNotice.test.tsx",
    ]);
  });

  it("应记录已删除的旧问卷 A2UI 模块命名入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "legacy-questionnaire-a2ui-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/utils/legacyQuestionnaireA2UI.ts",
      "src/components/agent/chat/utils/legacyQuestionnaireA2UI.test.ts",
    ]);
  });

  it("应记录已删除的 settings-v2 旧聊天外观兼容页入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "settings-chat-appearance-page-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/general/chat-appearance/index.tsx",
    ]);
  });

  it("应记录已删除的 settings-v2 旧渠道包装页入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "settings-channels-wrapper-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/system/channels/index.tsx",
      "src/components/settings-v2/system/channels/index.test.tsx",
    ]);
  });

  it("应记录已删除的 settings-v2 旧渠道列表页与弹窗组件簇", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "settings-channels-legacy-list-surfaces",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/system/channels/AIChannelsList.tsx",
      "src/components/settings-v2/system/channels/NotificationChannelsList.tsx",
      "src/components/settings-v2/system/channels/ConnectionTestButton.tsx",
      "src/components/settings-v2/system/channels/SendTestMessageButton.tsx",
      "src/components/settings-v2/system/channels/DeleteChannelDialog.tsx",
      "src/components/settings-v2/system/channels/AIChannelFormModal.tsx",
      "src/components/settings-v2/system/channels/NotificationChannelFormModal.tsx",
    ]);
  });

  it("应记录已删除的 settings-v2 执行轨迹独立页面壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "settings-execution-tracker-page-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/system/execution-tracker/index.tsx",
      "src/components/settings-v2/system/execution-tracker/index.test.tsx",
    ]);
  });

  it("应记录已删除的 settings-v2 旧代理配置页入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "settings-proxy-page-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/system/proxy/index.tsx",
    ]);
  });

  it("应记录已删除的 settings-v2 旧通用页头组件入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "settings-header-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/features/SettingHeader.tsx",
    ]);
  });

  it("应记录已删除的 settings-v2 旧共享语言选择器入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "settings-language-selector-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/settings-v2/shared/language/LanguageSelector.tsx",
    ]);
  });

  it("应记录已删除的 ExperimentalBanner 旧提示组件入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "experimental-banner-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/ui/ExperimentalBanner.tsx",
    ]);
  });

  it("应记录已删除的 PanelLayout 旧分屏布局入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "panel-layout-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/components/layout/PanelLayout.tsx"]);
  });

  it("应记录已删除的旧 SubAgent scheduler Hook 路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "team-subagent-scheduler-hook",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应记录已删除的旧 SubAgent scheduler 前端 API 路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "team-subagent-scheduler-api",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.targets).toEqual(["src/lib/api/subAgentScheduler.ts"]);
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应记录已删除的旧项目与工作区通用 Hook 壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "project-workspace-legacy-hooks",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/hooks/useProject.ts",
      "src/hooks/useWorkspace.ts",
    ]);
  });

  it("应记录已删除的旧项目上下文前端壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "project-context-legacy-frontend-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/hooks/useProjectContext.ts",
      "src/lib/api/projectContext.ts",
      "src/types/context.ts",
    ]);
  });

  it("应记录已删除的零入口通用 Hook 包装壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "unused-frontend-generic-hook-wrappers",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/hooks/useErrorHandler.ts",
      "src/hooks/useAutoFix.ts",
      "src/hooks/useConfigEvents.ts",
      "src/hooks/useFileMonitoring.ts",
      "src/hooks/usePersonas.ts",
      "src/hooks/useProviderState.ts",
    ]);
  });

  it("应记录已删除的零入口任务运行态胶囊卡壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "agent-task-runtime-card-shell",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/components/AgentTaskRuntimeCard.tsx",
    ]);
  });

  it("应记录已删除的零入口 sonner Hook 包装壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "unused-toast-hook-wrapper",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/hooks/use-toast.ts"]);
  });

  it("应记录已删除的统一 chat 类型壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "legacy-chat-shared-type-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/types/chat.ts"]);
  });

  it("应记录已删除的统一 platform 类型壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "legacy-platform-shared-type-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/types/platform.ts"]);
  });

  it("应记录已删除的统一 persona 类型壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "legacy-persona-shared-type-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/types/persona.ts"]);
  });

  it("应记录已删除的零入口 layout 样式表壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "legacy-layout-stylesheet-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/components/layout/layout.css"]);
  });

  it("应记录已删除的零入口连接管理前端网关壳", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "connection-management-legacy-frontend-gateway",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/lib/connection-api.ts"]);
  });

  it("应记录已删除的 i18n 动态模板与 barrel 旧入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "i18n-dynamic-template-legacy-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/i18n/index.ts",
      "src/i18n/dynamic-translation.ts",
    ]);
  });

  it("应记录已删除的 compat subagent runtime 桥路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "team-subagent-runtime-compat-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/hooks/useCompatSubagentRuntime.ts",
      "src/components/agent/chat/utils/compatSubagentRuntime.ts",
    ]);
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应记录已删除的旧问卷转 A2UI compat 桥路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "legacy-questionnaire-a2ui-compat-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/utils/compatQuestionnaireA2UI.ts",
    ]);
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应记录已删除的首页 entry task prompt composer 入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "empty-state-entry-task-prompt-composer-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(
      expect.arrayContaining([
        "src/components/agent/chat/utils/entryPromptComposer.ts",
        "src/components/agent/chat/utils/entryPromptComposer.test.ts",
      ]),
    );
  });

  it("应禁止技能入口重新回到扁平 props 透传与扁平契约", () => {
    const parentMonitorIds = [
      "inputbar-composer-flat-skill-parent-props",
      "empty-state-composer-flat-skill-parent-props",
    ];
    const contractMonitorIds = [
      "inputbar-composer-flat-skill-prop-contract",
      "empty-state-composer-flat-skill-prop-contract",
    ];

    for (const monitorId of [...parentMonitorIds, ...contractMonitorIds]) {
      const monitor = legacySurfaceCatalogJson.frontendText.find(
        (entry) => entry.id === monitorId,
      );

      expect(monitor).toBeTruthy();
      expect(monitor?.classification).toBe("dead-candidate");
      expect(monitor?.allowedPaths).toEqual([]);
      expect(
        (monitor?.patterns?.length ?? 0) +
          (monitor?.regexPatterns?.length ?? 0),
      ).toBeGreaterThan(0);
    }
  });

  it("应禁止 settings-v2 恢复旧 chat-appearance 与 channels compat tab", () => {
    const monitorIds = [
      "settings-chat-appearance-legacy-tab",
      "settings-channels-legacy-tab",
    ];

    for (const monitorId of monitorIds) {
      const monitor = legacySurfaceCatalogJson.frontendText.find(
        (entry) => entry.id === monitorId,
      );

      expect(monitor).toBeTruthy();
      expect(monitor?.classification).toBe("dead-candidate");
      expect(monitor?.allowedPaths).toEqual([]);
      expect(
        (monitor?.patterns?.length ?? 0) +
          (monitor?.regexPatterns?.length ?? 0),
      ).toBeGreaterThan(0);
    }
  });

  it("应禁止实验设置恢复旧 UpdateNotification compat 空导出", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "settings-update-notification-compat-export",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(
      (monitor?.patterns?.length ?? 0) + (monitor?.regexPatterns?.length ?? 0),
    ).toBeGreaterThan(0);
  });

  it("应禁止设置中心恢复旧共享 LanguageSelector 组件表面", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "settings-language-selector-legacy-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(
      (monitor?.patterns?.length ?? 0) + (monitor?.regexPatterns?.length ?? 0),
    ).toBeGreaterThan(0);
  });

  it("应禁止 ChannelsDebugWorkbench 恢复旧表单重连预留数组", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "channels-debug-workbench-legacy-form-reserve",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(
      (monitor?.patterns?.length ?? 0) + (monitor?.regexPatterns?.length ?? 0),
    ).toBeGreaterThan(0);
  });

  it("应禁止 ChannelsDebugWorkbench 恢复已零调用的旧内联渠道表单壳", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "channels-debug-workbench-legacy-inline-forms",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(
      (monitor?.patterns?.length ?? 0) + (monitor?.regexPatterns?.length ?? 0),
    ).toBeGreaterThan(0);
  });

  it("应禁止 Inputbar 恢复 A2UI 浮层 props 透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-a2ui-panel-prop-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/index.tsx",
    ]);
    expect(monitor?.regexPatterns).toEqual([
      "\\bpendingA2UIForm\\s*\\?:",
      "\\bonA2UISubmit\\s*\\?:",
      "\\ba2uiSubmissionNotice\\s*\\?:",
    ]);
  });

  it("应禁止 WorkspacePendingA2UIPanel 回流到 Inputbar A2UI panel helper 路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "workspace-pending-a2ui-panel-inputbar-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/workspace/WorkspacePendingA2UIPanel.tsx",
      "src/components/agent/chat/workspace/WorkspacePendingA2UIPanel.test.tsx",
    ]);
    expect(monitor?.patterns).toEqual([
      "../components/Inputbar/components/A2UISubmissionNotice",
      "../components/Inputbar/hooks/useA2UISubmissionNotice",
      "../components/Inputbar/hooks/useStickyA2UIForm",
    ]);
  });

  it("应禁止工作流输入状态 helper 回流到 Inputbar hooks 路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "workflow-input-state-inputbar-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarController.ts",
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarWorkflowStatusPanel.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
      "src/components/agent/chat/workspace/useWorkspaceGeneralWorkbenchRuntime.ts",
      "src/components/agent/chat/utils/workflowLayout.ts",
    ]);
    expect(monitor?.patterns).toEqual([
      "../components/Inputbar/hooks/useThemeWorkbenchInputState",
      "./hooks/useThemeWorkbenchInputState",
      "../hooks/useThemeWorkbenchInputState",
    ]);
  });

  it("应禁止 general workbench entry hooks 回流到旧 themeWorkbench 路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "general-workbench-entry-hook-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/AgentChatWorkspace.tsx",
      "src/components/agent/chat/components/GeneralWorkbenchEntryPromptAccessory.tsx",
      "src/components/agent/chat/components/GeneralWorkbenchEntryPromptAccessory.test.tsx",
      "src/components/agent/chat/hooks/useGeneralWorkbenchEntryPrompt.test.tsx",
      "src/components/agent/chat/hooks/useGeneralWorkbenchEntryPromptActions.ts",
      "src/components/agent/chat/hooks/useGeneralWorkbenchEntryPromptActions.test.tsx",
      "src/components/agent/chat/hooks/useGeneralWorkbenchSendBoundary.test.tsx",
      "src/components/agent/chat/workspace/useWorkspaceAutoGuideRuntime.ts",
      "src/components/agent/chat/workspace/useWorkspaceSendActions.ts",
    ]);
    expect(monitor?.patterns).toEqual([
      "./hooks/useThemeWorkbenchEntryPrompt",
      "./hooks/useThemeWorkbenchEntryPromptActions",
      "./hooks/useThemeWorkbenchSendBoundary",
      "./useThemeWorkbenchEntryPrompt",
      "./useThemeWorkbenchEntryPromptActions",
      "./useThemeWorkbenchSendBoundary",
      "../hooks/useThemeWorkbenchEntryPrompt",
      "../hooks/useThemeWorkbenchEntryPromptActions",
      "../hooks/useThemeWorkbenchSendBoundary",
    ]);
  });

  it("应禁止 general workbench entry prompt accessory 回流到旧 ThemeWorkbench 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) =>
        entry.id === "general-workbench-entry-prompt-accessory-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/workspace/useWorkspaceInputbarPresentation.tsx",
      "src/components/agent/chat/components/GeneralWorkbenchEntryPromptAccessory.test.tsx",
    ]);
    expect(monitor?.patterns).toEqual([
      "../components/ThemeWorkbenchEntryPromptAccessory",
      "./ThemeWorkbenchEntryPromptAccessory",
    ]);
  });

  it("应禁止 general workbench sidebar 壳回流到旧 ThemeWorkbenchHarnessCard / WorkspaceThemeSidebar 路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "general-workbench-sidebar-shell-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/workspace/WorkspaceGeneralWorkbenchSidebar.tsx",
      "src/components/agent/chat/workspace/useGeneralWorkbenchSidebarPresentation.tsx",
    ]);
    expect(monitor?.patterns).toEqual([
      "../components/ThemeWorkbenchHarnessCard",
      "./WorkspaceThemeSidebar",
    ]);
  });

  it("应禁止 general workbench sidebar 展示壳回流到旧 ThemeWorkbenchSidebar / Shell / Panels 路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "general-workbench-sidebar-display-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/index.test.tsx",
      "src/components/agent/chat/components/GeneralWorkbenchSidebar.tsx",
      "src/components/agent/chat/components/GeneralWorkbenchSidebar.test.tsx",
      "src/components/agent/chat/components/useGeneralWorkbenchSidebarOrchestration.ts",
      "src/components/agent/chat/components/useGeneralWorkbenchSidebarTelemetry.ts",
      "src/components/agent/chat/workspace/GeneralWorkbenchSidebarSection.tsx",
    ]);
    expect(monitor?.patterns).toEqual([
      "./components/ThemeWorkbenchSidebar",
      "../components/ThemeWorkbenchSidebar",
      "./ThemeWorkbenchSidebar",
      "./ThemeWorkbenchSidebarShell",
      "./ThemeWorkbenchSidebarPanels",
    ]);
  });

  it("应禁止 general workbench sidebar 支撑层回流到旧 ThemeWorkbench 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "general-workbench-sidebar-support-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components",
      "src/components/agent/chat/workspace/GeneralWorkbenchSidebarSection.tsx",
      "src/components/agent/chat/workspace/useWorkspaceGeneralWorkbenchScaffoldRuntime.ts",
    ]);
    expect(monitor?.patterns).toEqual([
      "./ThemeWorkbenchContextPanel",
      "./ThemeWorkbenchExecLog",
      "./ThemeWorkbenchWorkflowPanel",
      "./buildThemeWorkbenchContextPanelProps",
      "./buildThemeWorkbenchExecLogProps",
      "./buildThemeWorkbenchWorkflowPanelProps",
      "./buildThemeWorkbenchSidebarOrchestrationSource",
      "./themeWorkbenchContextData",
      "./themeWorkbenchExecLogData",
      "./themeWorkbenchWorkflowData",
      "./themeWorkbenchSidebarComparator",
      "./themeWorkbenchSidebarContentContract",
      "./themeWorkbenchSidebarContract",
      "./themeWorkbenchSidebarOrchestrationContract",
      "./themeWorkbenchSidebarShared",
      "./useThemeWorkbenchArtifactActions",
      "./useThemeWorkbenchContextPanelState",
      "./useThemeWorkbenchExecLogState",
      "./useThemeWorkbenchSidebarOrchestration",
      "./useThemeWorkbenchSidebarTelemetry",
      "./useThemeWorkbenchWorkflowPanelState",
      "../components/themeWorkbenchSidebarContract",
      "../components/themeWorkbenchWorkflowData",
    ]);
  });

  it("应禁止 ThemeWorkbenchSkillsPanel 回流到运行时代码或测试夹具", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "theme-workbench-skills-panel-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components",
      "src/components/agent/chat/index.test.tsx",
    ]);
    expect(monitor?.patterns).toEqual([
      "./ThemeWorkbenchSkillsPanel",
      "../components/ThemeWorkbenchSkillsPanel",
    ]);
  });

  it("应禁止运行时代码绕过 useActiveSkill 直接构造 skillSelection", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) =>
        entry.id === "skill-selection-direct-construction-runtime-usage",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.patterns).toEqual(["createSkillSelectionProps("]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components",
      "src/components/agent/chat/skill-selection",
    ]);
    expect(monitor?.allowedPaths).toEqual([
      "src/components/agent/chat/skill-selection/skillSelectionBindings.ts",
      "src/components/agent/chat/skill-selection/useActiveSkill.ts",
    ]);
  });

  it("应禁止共享技能选择能力继续从 Inputbar 旧目录导入", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "skill-selection-inputbar-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
      "src/components/agent/chat/components/EmptyStateComposerPanel.tsx",
      "src/components/agent/chat/components/EmptyStateComposerPanel.test.tsx",
      "src/components/agent/chat/components/EmptyState.test.tsx",
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/components/Inputbar/index.test.tsx",
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarController.ts",
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarSend.ts",
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
      "src/components/agent/chat/components/Inputbar/components/BuiltinCommandBadge.tsx",
      "src/components/agent/chat/components/Inputbar/components/TeamSelector.tsx",
      "src/components/smart-input/ChatInput.tsx",
      "src/components/workspace/video/PromptInput.tsx",
    ]);
    expect(monitor?.patterns).toEqual(
      expect.arrayContaining([
        "./Inputbar/components/CharacterMention",
        "./Inputbar/components/SkillBadge",
        "./Inputbar/components/SkillSelector",
        "./Inputbar/components/skillSelectionBindings",
        "./Inputbar/hooks/useActiveSkill",
        "../components/SkillBadge",
        "./useActiveSkill",
        "./CharacterMention",
        "./SkillSelector",
        "./skillSelectionBindings",
        "./builtinCommands",
        "./useIdleModulePreload",
      ]),
    );
  });

  it("应记录已删除的独立终端页面与挂件 surface 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "terminal-page-shell-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/terminal/index.ts",
      "src/components/terminal/TerminalWorkspace.tsx",
      "src/components/terminal/TerminalPanel.tsx",
      "src/components/terminal/TerminalView.tsx",
      "src/components/terminal/terminalPageHotkeys.ts",
      "src/components/terminal/widgets/FileBrowserView.tsx",
      "src/components/terminal/widgets/SysinfoView.tsx",
      "src/components/terminal/widgets/WebView.tsx",
      "src/components/terminal/ai/index.ts",
      "src/components/terminal/ai/TerminalAIInput.tsx",
    ]);
  });

  it("应记录已删除的终端状态与 VDOM 侧链文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "terminal-runtime-state-modules",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/lib/terminal/README.md",
      "src/lib/terminal/stickers/README.md",
      "src/lib/terminal/stickers/index.ts",
      "src/lib/terminal/stickers/store.ts",
      "src/lib/terminal/stickers/types.ts",
      "src/lib/terminal/store/README.md",
      "src/lib/terminal/store/atoms.ts",
      "src/lib/terminal/store/events.ts",
      "src/lib/terminal/store/hooks.ts",
      "src/lib/terminal/store/index.ts",
      "src/lib/terminal/store/multiInput.ts",
      "src/lib/terminal/store/types.ts",
      "src/lib/terminal/store/viewmodel.ts",
      "src/lib/terminal/themes.ts",
      "src/lib/terminal/vdom/README.md",
      "src/lib/terminal/vdom/index.ts",
      "src/lib/terminal/vdom/store.ts",
      "src/lib/terminal/vdom/types.ts",
    ]);
  });

  it("应记录已删除的工具箱页面与图像分析工具面文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "tools-page-shell-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/tools/ToolsPage.tsx",
      "src/components/tools/ToolCardContextMenu.tsx",
      "src/components/tools/image-analysis/index.ts",
      "src/components/tools/image-analysis/ImageAnalysisTool.tsx",
    ]);
  });

  it("应记录已删除的独立插图页面与旧搜图 surface 文件路径", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "image-page-shell-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual([
      "src/components/image-gen/ImageGenPage.tsx",
      "src/components/image-gen/ImageGenPage.test.tsx",
      "src/components/image-gen/tabs/AiImageGenTab.tsx",
      "src/components/image-gen/tabs/ImageSearchTab.tsx",
      "src/components/image-gen/tabs/ImageSearchTab.test.tsx",
      "src/components/image-gen/hooks/useImageSearch.ts",
      "src/components/image-gen/hooks/useImageSearch.test.tsx",
    ]);
  });

  it("应记录已删除的 image-gen 目录级 barrel 入口", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "image-generation-runtime-barrel-entry",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.targets).toEqual(["src/components/image-gen/index.ts"]);
  });

  it("应限制 AI 图片生成 runtime 入口继续扩散到 Claw 工作台之外", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "image-generation-runtime-entry-usage",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.patterns).toEqual(["useImageGen({"]);
    expect(monitor?.includePathPrefixes).toEqual(["src/components"]);
    expect(monitor?.allowedPaths).toEqual([
      "src/components/agent/chat/AgentChatWorkspace.tsx",
    ]);
  });

  it("应禁止前端恢复 image-gen 目录级 barrel 导入", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "image-generation-runtime-barrel-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.patterns).toEqual([
      "from \"@/components/image-gen\"",
      "from '@/components/image-gen'",
      "import(\"@/components/image-gen\")",
      "import('@/components/image-gen')",
      "from \"@/components/image-gen/index\"",
      "from '@/components/image-gen/index'",
      "import(\"@/components/image-gen/index\")",
      "import('@/components/image-gen/index')",
    ]);
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应禁止前端恢复独立工具箱页面 surface", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "frontend-tools-page-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.patterns).toEqual([]);
    expect(monitor?.regexPatterns).toEqual([
      "\\bcurrentPage\\s*===\\s*[\"']tools[\"']",
      "\\bcurrentPage\\s*===\\s*[\"']image-analysis[\"']",
      "\\bpage\\s*:\\s*[\"']tools[\"']",
      "\\bpage\\s*:\\s*[\"']image-analysis[\"']",
      "\\bonNavigate\\(\\s*[\"']tools[\"']",
      "\\bonNavigate\\(\\s*[\"']image-analysis[\"']",
    ]);
    expect(monitor?.includePathPrefixes).toEqual(["src"]);
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应禁止前端恢复独立终端页面 surface", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "frontend-terminal-page-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.patterns).toEqual([]);
    expect(monitor?.regexPatterns).toEqual([
      "\\bcurrentPage\\s*===\\s*[\"']terminal[\"']",
      "\\bcurrentPage\\s*===\\s*[\"']sysinfo[\"']",
      "\\bcurrentPage\\s*===\\s*[\"']files[\"']",
      "\\bcurrentPage\\s*===\\s*[\"']web[\"']",
      "\\bpage\\s*:\\s*[\"']terminal[\"']",
      "\\bpage\\s*:\\s*[\"']sysinfo[\"']",
      "\\bpage\\s*:\\s*[\"']files[\"']",
      "\\bpage\\s*:\\s*[\"']web[\"']",
    ]);
    expect(monitor?.includePathPrefixes).toEqual(["src"]);
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应禁止前端恢复独立插图页面 surface", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "frontend-image-page-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.patterns).toEqual([]);
    expect(monitor?.regexPatterns).toEqual([
      "\\bcurrentPage\\s*===\\s*[\"']image-gen[\"']",
      "\\bpage\\s*:\\s*[\"']image-gen[\"']",
      "\\brenderContent\\([\"']image-gen[\"']",
    ]);
    expect(monitor?.includePathPrefixes).toEqual(["src"]);
    expect(monitor?.allowedPaths).toEqual([]);
  });

  it("应禁止首页恢复旧 entry task 发送链", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-legacy-entry-task-runtime-usage",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
      "src/components/agent/chat/components/EmptyStateComposerPanel.tsx",
      "src/components/agent/chat/utils/contextualRecommendations.ts",
    ]);
    expect(monitor?.patterns).toEqual(
      expect.arrayContaining([
        "ENTRY_THEME_ID",
        "SOCIAL_MEDIA_ENTRY_TASKS",
        "composeEntryPrompt(",
        "validateEntryTaskSlots(",
      ]),
    );
  });

  it("应禁止首页类型定义恢复旧 entry task 契约", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-legacy-entry-task-type-contract",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/types.ts",
    ]);
    expect(monitor?.patterns).toEqual([
      "export type EntryTaskType",
      "export interface EntryTaskSlotDefinition",
      "export interface EntryTaskTemplate",
      "export type EntryTaskSlotValues",
    ]);
  });

  it("应禁止 Inputbar 恢复旧 execution strategy 兼容 props 链", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-legacy-execution-strategy-prop-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual(["showExecutionStrategy"]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyStateComposerPanel.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarCore.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarTools.tsx",
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarAdapter.ts",
      "src/components/input-kit/adapters/agentAdapter.ts",
      "src/components/input-kit/adapters/types.ts",
    ]);
  });

  it("应禁止 Inputbar 家族恢复旧空透传 props", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-legacy-dead-prop-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "isCanvasOpen",
      "isExecutionRuntimeActive",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/AgentChatWorkspace.tsx",
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarCore.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarTools.tsx",
    ]);
  });

  it("应禁止 Inputbar hooks 恢复旧本地 toggle 兜底链", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-legacy-local-tool-toggle-runtime",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      'case "execution_strategy"',
      'case "canvas"',
      'activeTools["execution_strategy"]',
      "onToggleCanvas",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarController.ts",
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarSend.ts",
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarToolState.ts",
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
      "src/components/agent/chat/AgentChatWorkspace.tsx",
    ]);
  });

  it("应禁止 TeamSelector 调用端恢复旧 workspace 上下文透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "team-selector-legacy-context-prop-callsite",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual(["workspaceId={workspaceId}"]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyStateComposerPanel.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
    ]);
  });

  it("应禁止 TeamSelector 面板恢复未消费的旧运行时上下文透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) =>
        entry.id === "team-selector-panel-legacy-runtime-context-props",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "providerType={providerType}",
      "model={model}",
      "executionStrategy={executionStrategy}",
      "workspaceId?: string | null;",
      "providerType?: string;",
      "model?: string;",
      'executionStrategy?: "react" | "code_orchestrated" | "auto";',
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/TeamSelector.tsx",
      "src/components/agent/chat/components/Inputbar/components/TeamSelectorPanel.tsx",
    ]);
  });

  it("应禁止 TeamSelector 恢复旧触发器文案与样式透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "team-selector-legacy-trigger-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/TeamSelector.tsx",
    ]);
    expect(monitor?.regexPatterns).toEqual([
      "\\btriggerLabel\\s*\\?:",
      "\\bclassName\\s*\\?:",
    ]);
  });

  it("应禁止 Inputbar 恢复旧 workspace 上下文透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-legacy-workspace-context-prop-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "workspaceId?: string | null;",
      'projectId: InputbarParams["workspaceId"];',
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
    ]);
  });

  it("应禁止 Inputbar 恢复旧 task 工具状态契约", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-legacy-task-tool-state-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "task: false",
      "task: true",
      "task?: boolean;",
      "toolStates?.task",
      "next.task",
      "prev.task",
      "taskEnabled",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarToolState.ts",
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/components/Inputbar/index.test.tsx",
    ]);
  });

  it("应禁止 Inputbar 工具状态 runtime 恢复已删除的旧工具动作分支", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-legacy-dead-tool-action-runtime",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      'case "clear"',
      'case "new_topic"',
      'case "quick_action"',
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarToolState.ts",
    ]);
  });

  it("应禁止 Inputbar 恢复旧 onClearMessages 透传链", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-legacy-clear-messages-prop-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "onClearMessages?: () => void;",
      "onClearMessages: handleClearMessages,",
      'handleClearMessages: InputbarParams["onClearMessages"];',
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarController.ts",
      "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
      "src/components/agent/chat/AgentChatWorkspace.tsx",
    ]);
  });

  it("应禁止 InputbarModelExtra 恢复旧工作流 variant 透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-model-extra-legacy-variant-prop-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "isThemeWorkbenchVariant?: boolean;",
      "isThemeWorkbenchVariant={isThemeWorkbenchVariant}",
      "isThemeWorkbenchVariant = false,",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarModelExtra.tsx",
    ]);
  });

  it("应禁止 SkillSelector 恢复旧触发按钮自定义表面", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "skill-selector-legacy-trigger-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "triggerLabel?: string;",
      "className?: string;",
      'triggerLabel = "技能",',
      "className,",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/skill-selection/SkillSelector.tsx",
    ]);
  });

  it("应禁止 InputbarModelExtra 恢复旧模型 setter fallback", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-model-extra-legacy-setter-fallback",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "setProviderType?: (type: string) => void;",
      "setModel?: (model: string) => void;",
      "const NOOP_SET_PROVIDER_TYPE = (_type: string) => {};",
      "const NOOP_SET_MODEL = (_model: string) => {};",
      "setProviderType={setProviderType || NOOP_SET_PROVIDER_TYPE}",
      "setModel={setModel || NOOP_SET_MODEL}",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/InputbarModelExtra.tsx",
    ]);
  });

  it("应禁止 InputbarTools 恢复旧可选工具状态 props", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-tools-legacy-optional-state-props",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "onToolClick?: (tool: string) => void;",
      "activeTools?: Record<string, boolean>;",
      "activeTools = {}",
      'onToolClick?.("thinking")',
      'onToolClick?.("web_search")',
      'onToolClick?.("subagent_mode")',
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/InputbarTools.tsx",
    ]);
  });

  it("应禁止 InputbarVisionCapabilityNotice 恢复旧可选模型 props", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) =>
        entry.id === "inputbar-vision-notice-legacy-optional-model-props",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "providerType?: string;",
      "model?: string;",
      "Boolean(providerType?.trim())",
      "Boolean(model?.trim())",
      "if (!shouldInspectCapability || !model?.trim())",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/InputbarVisionCapabilityNotice.tsx",
    ]);
  });

  it("应禁止 InputbarWorkflowStatusPanel 恢复旧数组 fallback", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) =>
        entry.id === "inputbar-workflow-status-panel-legacy-array-fallbacks",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "quickActions?: ThemeWorkbenchQuickAction[];",
      "queueItems?: ThemeWorkbenchWorkflowStep[];",
      "quickActions = []",
      "queueItems = []",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/InputbarWorkflowStatusPanel.tsx",
    ]);
  });

  it("应禁止 InputbarCore 恢复零调用的 allowEmptySend 透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-core-legacy-allow-empty-send-prop",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "allowEmptySend?: boolean;",
      "allowEmptySend={allowEmptySend}",
      "allowEmptySend = false,",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/InputbarCore.tsx",
    ]);
  });

  it("应禁止 InputbarCore 恢复零调用的 rightExtra 右侧插槽", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "inputbar-core-legacy-right-extra-slot",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "rightExtra?: React.ReactNode;",
      "Boolean(rightExtra)",
      "<MetaSlot>{rightExtra}</MetaSlot>",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/components/InputbarCore.tsx",
    ]);
  });

  it("应禁止首页空态恢复旧主题 tabs 壳", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-legacy-theme-tabs-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual(["showThemeTabs", "themeTabs={"]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
      "src/components/agent/chat/components/EmptyStateHero.tsx",
      "src/components/agent/chat/workspace/chatSurfaceProps.ts",
    ]);
  });

  it("应禁止首页空态恢复旧项目选择器扩展透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-legacy-project-selector-overrides",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "skipProjectSelectorWorkspaceReadyCheck",
      "deferProjectSelectorListLoad",
      "skipDefaultWorkspaceReadyCheck={",
      "deferProjectListLoad={",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
    ]);
  });

  it("应禁止首页空态恢复 supportingSlotOverride 注入口", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-supporting-slot-override-surface",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual(["supportingSlotOverride"]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
      "src/components/agent/chat/components/EmptyState.test.tsx",
    ]);
  });

  it("应禁止首页链路恢复模型选择器预加载 props 透传", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) =>
        entry.id === "empty-state-legacy-model-selector-preload-prop-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "modelSelectorBackgroundPreload",
      "backgroundPreload={backgroundPreload}",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
      "src/components/agent/chat/components/EmptyStateComposerPanel.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarModelExtra.tsx",
    ]);
  });

  it("应禁止首页空态恢复 configLoadStrategy 时序开关", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-legacy-config-load-strategy-prop",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.patterns).toEqual([
      "configLoadStrategy",
      "scheduleDeferredConfigLoad",
    ]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
    ]);
  });

  it("应禁止 EmptyState 重新直读本地 activeSkill hook 状态", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "empty-state-local-active-skill-hook-usage",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.regexPatterns).toEqual([
      "(?<!\\.)\\bactiveSkill\\s*[,}]",
      "(?<!\\.)\\bclearActiveSkill\\s*[,}]",
    ]);
  });

  it("应禁止技能入口旧展示文案重新回到页面层手写", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "skill-selection-legacy-display-copy",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/EmptyState.tsx",
      "src/components/agent/chat/skill-selection/SkillSelector.tsx",
    ]);
    expect(monitor?.patterns).toEqual(
      expect.arrayContaining([
        "当前技能 ",
        "当前已启用 ",
        "为当前任务挂载额外能力",
        "按需挂载能力",
        "项技能可用",
      ]),
    );
  });

  it("应禁止旧海报素材入口与 Rust 符号重新回流", () => {
    const importMonitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "gallery-material-legacy-frontend-module",
    );
    const frontendMonitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "gallery-material-legacy-helper-usage",
    );
    const rustMonitor = legacySurfaceCatalogJson.rustText.find(
      (entry) => entry.id === "rust-gallery-material-legacy-symbols",
    );

    expect(importMonitor).toBeTruthy();
    expect(importMonitor?.allowedPaths).toEqual([]);
    expect(importMonitor?.targets).toEqual(
      expect.arrayContaining([
        "src/lib/api/posterMaterials.ts",
        "src/hooks/usePosterMaterial.ts",
        "src/types/poster-material.ts",
      ]),
    );

    expect(frontendMonitor).toBeTruthy();
    expect(frontendMonitor?.classification).toBe("dead-candidate");
    expect(frontendMonitor?.patterns).toEqual(
      expect.arrayContaining([
        "getPosterMaterial(",
        "createPosterMetadata(",
        "usePosterMaterial(",
      ]),
    );

    expect(rustMonitor).toBeTruthy();
    expect(rustMonitor?.allowedPaths).toEqual([
      "src-tauri/crates/core/src/database/schema.rs",
    ]);
    expect(rustMonitor?.patterns).toEqual(
      expect.arrayContaining([
        "PosterMaterialDao",
        "poster_material_metadata",
        "idx_poster_material_metadata_",
      ]),
    );
  });
});
