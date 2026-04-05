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

  it("应记录已迁出 Inputbar 的 A2UI 对话框 helper", () => {
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

  it("应记录已迁出 Inputbar 的主题工作台输入状态 helper", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "inputbar-theme-workbench-input-state-entry",
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

  it("应限制 compat subagent runtime 桥的引用边界", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "team-subagent-runtime-compat-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("compat");
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/hooks/useCompatSubagentRuntime.ts",
      "src/components/agent/chat/utils/compatSubagentRuntime.ts",
    ]);
    expect(monitor?.allowedPaths).toEqual([
      "src/components/agent/chat/AgentChatWorkspace.tsx",
      "src/components/agent/chat/components/AgentRuntimeStrip.tsx",
      "src/components/agent/chat/components/HarnessStatusPanel.tsx",
      "src/components/agent/chat/hooks/useCompatSubagentRuntime.ts",
      "src/components/agent/chat/utils/subagentTimeline.ts",
    ]);
  });

  it("应限制旧问卷转 A2UI compat 桥的引用边界", () => {
    const monitor = legacySurfaceCatalogJson.imports.find(
      (entry) => entry.id === "legacy-questionnaire-a2ui-compat-bridge",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("compat");
    expect(monitor?.targets).toEqual([
      "src/components/agent/chat/utils/compatQuestionnaireA2UI.ts",
    ]);
    expect(monitor?.allowedPaths).toEqual([
      "src/components/agent/chat/workspace/useWorkspaceDisplayMessagesRuntime.ts",
      "src/components/agent/chat/workspace/useWorkspaceA2UIRuntime.ts",
      "src/components/agent/chat/workspace/useWorkspaceA2UISubmitActions.ts",
    ]);
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
      (entry) => entry.id === "inputbar-a2ui-dialog-prop-bridge",
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

  it("应禁止 WorkspacePendingA2UIDialog 回流到 Inputbar A2UI helper 路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "workspace-pending-a2ui-dialog-inputbar-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/workspace/WorkspacePendingA2UIDialog.tsx",
      "src/components/agent/chat/workspace/WorkspacePendingA2UIDialog.test.tsx",
    ]);
    expect(monitor?.patterns).toEqual([
      "../components/Inputbar/components/A2UISubmissionNotice",
      "../components/Inputbar/hooks/useA2UISubmissionNotice",
      "../components/Inputbar/hooks/useStickyA2UIForm",
    ]);
  });

  it("应禁止主题工作台状态 helper 回流到 Inputbar hooks 路径", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "theme-workbench-input-state-inputbar-imports",
    );

    expect(monitor).toBeTruthy();
    expect(monitor?.classification).toBe("dead-candidate");
    expect(monitor?.allowedPaths).toEqual([]);
    expect(monitor?.includePathPrefixes).toEqual([
      "src/components/agent/chat/components/Inputbar/hooks/useInputbarController.ts",
      "src/components/agent/chat/components/Inputbar/index.tsx",
      "src/components/agent/chat/components/Inputbar/components/ThemeWorkbenchStatusPanel.tsx",
      "src/components/agent/chat/components/Inputbar/components/InputbarComposerSection.tsx",
      "src/components/agent/chat/workspace/useWorkspaceThemeWorkbenchRuntime.ts",
      "src/components/agent/chat/utils/themeWorkbenchLayout.ts",
    ]);
    expect(monitor?.patterns).toEqual([
      "../components/Inputbar/hooks/useThemeWorkbenchInputState",
      "./hooks/useThemeWorkbenchInputState",
      "../hooks/useThemeWorkbenchInputState",
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
      "src/components/image-gen/tabs/AiImageGenTab.tsx",
      "src/components/terminal/ai/TerminalAIInput.tsx",
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

  it("应禁止 InputbarModelExtra 恢复旧主题工作台 variant 透传", () => {
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

  it("应禁止 ThemeWorkbenchStatusPanel 恢复旧数组 fallback", () => {
    const monitor = legacySurfaceCatalogJson.frontendText.find(
      (entry) => entry.id === "theme-workbench-status-panel-legacy-array-fallbacks",
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
      "src/components/agent/chat/components/Inputbar/components/ThemeWorkbenchStatusPanel.tsx",
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
