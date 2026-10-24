import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const settingsSources = [
  "scripts/electron/lib/settings-navigation-fixture-identity.mjs",
  "scripts/electron/lib/settings-browser-preferences-scenario.mjs",
  "scripts/electron/lib/settings-navigation-surface.mjs",
  "src/components/settings-v2/general/browser/index.tsx",
  "src/components/settings-v2/general/browser/PreferenceMenu.tsx",
  "src/components/settings-v2/general/keyboard-shortcuts/index.tsx",
  "src/hooks/useDesktopPreferences.ts",
  "src/lib/api/desktopPreferences.ts",
  "src/lib/api/appConfig.ts",
  "src/lib/api/appConfigTypes.ts",
  "src/types/settings.ts",
  "electron/appServerHost.ts",
  "scripts/electron/lib/settings-search-scenario.mjs",
  "src/components/settings-v2/settingsSearchDocuments.ts",
  "src/components/settings-v2/settingsSearch.ts",
  "src/components/settings-v2/_layout/SettingsSearch.tsx",
  "src/components/settings-v2/_layout/SettingsSidebar.tsx",
  "src/components/settings-v2/_layout/useSettingsSearchTarget.ts",
  "src/components/settings-v2/hooks/useSettingsCategory.ts",
  "src/lib/api/oemCloudRuntime.ts",

  ...[
    "index.tsx",
    "ProfileFieldEditor.tsx",
    "ProfileContent.tsx",
    "profileConfig.ts",
    "ProfileLayout.tsx",
    "useProfileDraft.ts",
  ].map((file) => "src/components/settings-v2/account/profile/" + file),
  "scripts/electron/lib/settings-profile-navigation-scenario.mjs",
  "scripts/electron/lib/settings-profile-fixture-driver.mjs",
  "src/hooks/useAppNavigation.ts",
  "src/hooks/useAppShellLayout.ts",
  "src/lib/navigationGuard.ts",
  "src/types/page.ts",
  "src/App.tsx",
  "electron/main.ts",
  "src/hooks/useDeepLink.ts",
  "src/lib/deepLink/websiteLaunch.ts",
  "src/components/AppPageContent.tsx",
  "src/components/app-sidebar/SidebarResizeHandle.tsx",
  "src/components/app-sidebar/useSidebarWidth.ts",
  "src/components/app-sidebar/AppSidebar.constants.ts",
  "src/components/settings-v2/sections.tsx",
  "src/components/settings-v2/_layout/index.tsx",
  "src/components/settings-v2/_layout/SettingsNavigation.tsx",
  "src/components/settings-v2/_layout/SettingsNavigationGuard.tsx",
  "src/components/settings-v2/_layout/SettingsUnsavedChangesDialog.tsx",
  "src/components/settings-v2/_layout/useSettingsDraft.ts",
  "src/components/settings-v2/general/memory/index.tsx",
  "src/components/settings-v2/general/appearance/index.tsx",
  "src/components/settings-v2/general/appearance/AppearanceSettingsView.tsx",
  ...[
    "useMemorySettings.ts",
    "InstructionsEditor.tsx",
    "DeleteMemoriesDialog.tsx",
  ].map((file) => "src/components/settings-v2/general/memory/" + file),
  "src/lib/api/instructions.ts",
  "src/components/settings-v2/system/configuration/index.tsx",
  "src/components/settings-v2/system/configuration/useConfiguration.ts",
  "src/components/settings-v2/system/configuration/ModelFeaturesSection.tsx",
  ...[
    "LocalEnvironmentsSettings.tsx",
    "LocalEnvironmentEditor.tsx",
    "LifecycleEditor.tsx",
    "ActionsEditor.tsx",
  ].map(
    (file) => "src/components/settings-v2/coding/local-environments/" + file,
  ),
  "src/lib/localEnvironments.ts",
  "src/lib/api/localEnvironments.ts",
  "scripts/electron/lib/settings-local-environments-navigation-scenario.mjs",
  ...[
    "index.tsx",
    "useExecutionPolicyDraft.ts",
    "executionPolicyConfig.ts",
    "executionPolicyPresentation.ts",
    "ExecutionPolicyFields.tsx",
    "PolicySourceLayerPanel.tsx",
    "ExecutionPolicyNetworkFocusPanel.tsx",
    "executionPolicyFocus.ts",
    "WindowsSandboxReadinessStatus.tsx",
    "windowsSandboxPlatform.ts",
  ].map((file) => "src/components/settings-v2/system/execution-policy/" + file),
  "scripts/electron/lib/settings-execution-policy-navigation-scenario.mjs",
  "src/components/agent/chat/index.tsx",
  "src/components/agent/chat/agentChatWorkspaceContract.ts",
  "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceContextSurfaceRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceTaskCenterNavigationRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspacePendingInputRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceResetRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceInitialSessionNavigation.ts",
  "src/components/agent/chat/workspace/useWorkspaceTopicSwitch.ts",
  "src/components/agent/chat/workspace/useWorkspaceComposerDraftRuntime.ts",
  "src/components/agent/chat/workspace/useWorkspaceComposerDraftNavigation.ts",
  "scripts/electron/settings-navigation-fixture-smoke.mjs",
  "scripts/electron/lib/settings-unsaved-navigation-scenario.mjs",
  "scripts/electron/lib/settings-note-navigation-scenario.mjs",
  "scripts/electron/lib/settings-web-search-navigation-scenario.mjs",
  "scripts/electron/mcp-config-fixture-smoke.mjs",
  "scripts/electron/lib/persisted-atom-fixture-driver.mjs",
  "scripts/agent-runtime/claw-chat-current-fixture-teardown.mjs",
  "scripts/agent-runtime/claw-chat-current-fixture-rpc.mjs",
  "scripts/agent-runtime/claw-chat-current-fixture-backend-script.mjs",
  "scripts/lib/invoke-trace-collector.mjs",
  "scripts/lib/electron-fixture-build.mjs",
  ...["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].map(
    (locale) => `src/i18n/resources/${locale}/settings.json`,
  ),
];
export const fingerprints = () =>
  Object.fromEntries(
    settingsSources.map((file) => [
      file,
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    ]),
  );

// Directory identity includes retained chunks; it does not claim every file loaded.
export function artifactFingerprints() {
  const records = {};
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile())
        records[file] = createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex");
    }
  };
  for (const directory of [
    "dist",
    "dist-electron",
    "packages/app-server-client/dist",
  ])
    visit(directory);
  return records;
}
