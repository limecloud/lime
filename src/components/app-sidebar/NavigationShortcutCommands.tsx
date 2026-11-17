import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createAgentRuntimeSession } from "@/lib/api/agentRuntime/sessionClient";
import { readAgentRuntimeSessionRolloutPath } from "@/lib/api/agentRuntime/sessionPath";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import {
  exportDiagnosticsTrace,
  listDiagnosticsTraces,
} from "@/lib/api/serverRuntime";
import { toast } from "sonner";
import {
  downloadTraceRecording,
  isTraceRecording,
  startTraceRecording,
  stopTraceRecording,
} from "@/lib/traceRecording";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { useCommand } from "@/lib/commands/useCommand";
import type { CommandRegistration } from "@/lib/commands/registry";
import {
  activateConversationTab,
  closeConversationTab,
  closeOtherConversationTabs,
  getConversationTabsSnapshot,
  reopenLastClosedConversationTab,
  requestNewConversationTab,
} from "@/lib/conversationTabs";
import {
  requestWorkspaceReviewTab,
  requestWorkspaceReviewTabClose,
  requestWorkspaceReviewTabToggle,
} from "@/lib/workspaceReviewTabEvents";
import { toggleWorkspaceFullView } from "@/lib/workspaceFullView";
import {
  requestConversationHistoryBack,
  requestConversationHistoryForward,
} from "@/lib/conversationHistory";

function ShortcutCommand({ command }: { command: CommandRegistration }) {
  useCommand(command);
  return null;
}

export function NavigationShortcutCommands({
  onNavigate,
}: {
  onNavigate?: (page: Page, params?: PageParams) => void;
} = {}) {
  const { t } = useTranslation("navigation");
  const commands = useMemo<CommandRegistration[]>(() => {
    const activeTab = () => getConversationTabsSnapshot().activeSessionId;
    const moveTab = (offset: number) => {
      const { tabs, activeSessionId } = getConversationTabsSnapshot();
      if (tabs.length < 2) return;
      const index = tabs.findIndex((tab) => tab.sessionId === activeSessionId);
      const nextIndex = (index + offset + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (next) activateConversationTab(next.sessionId);
    };
    return [
      {
        id: "navigation.newChat",
        titleKey: "commands.newChat.title",
        descriptionKey: "commands.newChat.description",
        section: "navigation",
        bindings: ["CommandOrControl+N", "CommandOrControl+Shift+O"],
        allowInInput: true,
        handler: requestNewConversationTab,
      },
      {
        id: "approval.approve",
        titleKey: "commands.approvePending.title",
        descriptionKey: "commands.approvePending.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:approve-pending")),
      },
      {
        id: "approval.deny",
        titleKey: "commands.denyPending.title",
        descriptionKey: "commands.denyPending.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:deny-pending")),
      },
      {
        id: "app.snapshotNewChat",
        titleKey: "commands.snapshotNewChat.title",
        descriptionKey: "commands.snapshotNewChat.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:snapshot-new-chat")),
      },
      {
        id: "app.snapshotCurrentChat",
        titleKey: "commands.snapshotCurrentChat.title",
        descriptionKey: "commands.snapshotCurrentChat.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:snapshot-current-chat"),
          ),
      },
      {
        id: "app.searchFiles",
        titleKey: "commands.searchFiles.title",
        descriptionKey: "commands.searchFiles.description",
        section: "navigation",
        bindings: ["CommandOrControl+P"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:open-file-search")),
      },
      {
        id: "navigation.temporaryChat",
        titleKey: "commands.temporaryChat.title",
        descriptionKey: "commands.temporaryChat.description",
        section: "navigation",
        bindings: ["CommandOrControl+Shift+N"],
        allowInInput: true,
        handler: async () => {
          const name = t("commands.temporaryChat.title");
          const sessionId = await createAgentRuntimeSession(
            undefined,
            name,
            undefined,
            { ephemeral: true },
          );
          onNavigate?.(
            "agent",
            buildHomeAgentParams({
              initialSessionId: sessionId,
              initialSessionName: name,
            }),
          );
        },
      },
      {
        id: "navigation.newStandaloneChat",
        titleKey: "commands.newStandaloneChat.title",
        descriptionKey: "commands.newStandaloneChat.description",
        section: "navigation",
        bindings: ["CommandOrControl+Alt+O"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:new-standalone-chat")),
      },
      {
        id: "navigation.newTab",
        titleKey: "commands.newTab.title",
        descriptionKey: "commands.newTab.description",
        section: "navigation",
        bindings: ["CommandOrControl+T"],
        allowInInput: true,
        handler: requestNewConversationTab,
      },
      {
        id: "navigation.closeTab",
        titleKey: "commands.closeTab.title",
        descriptionKey: "commands.closeTab.description",
        section: "navigation",
        bindings: ["CommandOrControl+W"],
        allowInInput: true,
        handler: () => {
          const active = activeTab();
          if (active) closeConversationTab(active);
        },
      },
      {
        id: "navigation.closeOtherTabs",
        titleKey: "commands.closeOtherTabs.title",
        descriptionKey: "commands.closeOtherTabs.description",
        section: "navigation",
        bindings: ["CommandOrControl+Alt+W"],
        allowInInput: true,
        handler: () => {
          const active = activeTab();
          if (active) closeOtherConversationTabs(active);
        },
      },
      {
        id: "navigation.nextTab",
        titleKey: "commands.nextTab.title",
        descriptionKey: "commands.nextTab.description",
        section: "navigation",
        bindings: ["CommandOrControl+Shift+]"],
        allowInInput: true,
        handler: () => moveTab(1),
      },
      {
        id: "navigation.previousTab",
        titleKey: "commands.previousTab.title",
        descriptionKey: "commands.previousTab.description",
        section: "navigation",
        bindings: ["CommandOrControl+Shift+["],
        allowInInput: true,
        handler: () => moveTab(-1),
      },
      {
        id: "navigation.reopenClosedTab",
        titleKey: "commands.reopenClosedTab.title",
        descriptionKey: "commands.reopenClosedTab.description",
        section: "navigation",
        bindings: ["CommandOrControl+Shift+T"],
        allowInInput: true,
        handler: reopenLastClosedConversationTab,
      },
      {
        id: "navigation.previousViewedChat",
        titleKey: "commands.previousViewedChat.title",
        descriptionKey: "commands.previousViewedChat.description",
        section: "navigation",
        bindings: [],
        handler: requestConversationHistoryBack,
      },
      {
        id: "navigation.nextViewedChat",
        titleKey: "commands.nextViewedChat.title",
        descriptionKey: "commands.nextViewedChat.description",
        section: "navigation",
        bindings: [],
        handler: requestConversationHistoryForward,
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `navigation.focusTab${index + 1}`,
        titleKey: `commands.focusTab${index + 1}.title`,
        descriptionKey: `commands.focusTab${index + 1}.description`,
        section: "navigation" as const,
        bindings: [`CommandOrControl+${index + 1}`],
        allowInInput: true,
        handler: () => {
          const target = getConversationTabsSnapshot().tabs[index];
          if (target) activateConversationTab(target.sessionId);
        },
      })),
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `navigation.recentChat${index + 1}`,
        titleKey: `commands.recentChat${index + 1}.title`,
        descriptionKey: `commands.recentChat${index + 1}.description`,
        section: "navigation" as const,
        bindings: [`CommandOrControl+Alt+${index + 1}`],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:open-recent-chat", { detail: index }),
          ),
      })),
      {
        id: "navigation.previousSidebarItem",
        titleKey: "commands.previousSidebarItem.title",
        descriptionKey: "commands.previousSidebarItem.description",
        section: "navigation",
        bindings: ["CommandOrControl+Alt+["],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:cycle-sidebar-item", { detail: -1 }),
          ),
      },
      {
        id: "navigation.nextSidebarItem",
        titleKey: "commands.nextSidebarItem.title",
        descriptionKey: "commands.nextSidebarItem.description",
        section: "navigation",
        bindings: ["CommandOrControl+Alt+]"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:cycle-sidebar-item", { detail: 1 }),
          ),
      },
      {
        id: "inputbar.togglePlanMode",
        titleKey: "commands.togglePlanMode.title",
        descriptionKey: "commands.togglePlanMode.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-plan-mode")),
      },
      {
        id: "app.focusSideChat",
        titleKey: "commands.focusSideChat.title",
        descriptionKey: "commands.focusSideChat.description",
        section: "panels",
        bindings: ["CommandOrControl+Alt+S"],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:focus-side-chat")),
      },
      {
        id: "app.openAvatarOverlay",
        titleKey: "commands.openAvatarOverlay.title",
        descriptionKey: "commands.openAvatarOverlay.description",
        section: "app",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:open-quick-capture")),
      },
      {
        id: "app.toggleNotch",
        titleKey: "commands.toggleNotch.title",
        descriptionKey: "commands.toggleNotch.description",
        section: "app",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-notch")),
      },
      {
        id: "app.notchVoice",
        titleKey: "commands.notchVoice.title",
        descriptionKey: "commands.notchVoice.description",
        section: "app",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:notch-voice")),
      },
      {
        id: "app.toggleSideChat",
        titleKey: "commands.toggleSideChat.title",
        descriptionKey: "commands.toggleSideChat.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-side-chat")),
      },
      {
        id: "app.quickCapture",
        titleKey: "commands.quickCapture.title",
        descriptionKey: "commands.quickCapture.description",
        section: "app",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:open-quick-capture")),
      },
      {
        id: "app.exportDiagnosticsTrace",
        titleKey: "commands.exportDiagnosticsTrace.title",
        descriptionKey: "commands.exportDiagnosticsTrace.description",
        section: "app",
        bindings: [],
        handler: async () => {
          const sessionId = activeTab();
          if (!sessionId) return;
          const list = await listDiagnosticsTraces({
            session_id: sessionId,
            limit: 1,
          });
          const trace = list.traces[0];
          if (!trace) {
            toast.error(t("commands.exportDiagnosticsTrace.empty"));
            return;
          }
          const result = await exportDiagnosticsTrace({
            session_id: sessionId,
            trace_id: trace.trace_id,
          });
          if (result.bundle_path) {
            toast.success(
              t("commands.exportDiagnosticsTrace.success", {
                path: result.bundle_path,
              }),
            );
          } else {
            toast.error(t("commands.exportDiagnosticsTrace.failed"));
          }
        },
      },
      {
        id: "app.toggleTraceRecording",
        titleKey: "commands.toggleTraceRecording.title",
        descriptionKey: "commands.toggleTraceRecording.description",
        section: "app",
        bindings: [],
        handler: () => {
          if (isTraceRecording()) {
            const snapshot = stopTraceRecording();
            if (snapshot) downloadTraceRecording(snapshot);
          } else {
            startTraceRecording();
          }
        },
      },
      {
        id: "app.globalDictation",
        titleKey: "commands.globalDictation.title",
        descriptionKey: "commands.globalDictation.description",
        section: "panels",
        bindings: [],
        handler: () => {
          window.dispatchEvent(new CustomEvent("lime:toggle-dictation"));
        },
      },
      {
        id: "composer.toggleWorkRunLocation",
        titleKey: "commands.toggleWorkRunLocation.title",
        descriptionKey: "commands.toggleWorkRunLocation.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:open-cloud-run-location"),
          ),
      },
      {
        id: "composer.toggleWorktreeMode",
        titleKey: "commands.toggleWorktreeMode.title",
        descriptionKey: "commands.toggleWorktreeMode.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-worktree-mode")),
      },
      {
        id: "composer.cycleReasoningEffort",
        titleKey: "commands.cycleReasoningEffort.title",
        descriptionKey: "commands.cycleReasoningEffort.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:cycle-reasoning-effort"),
          ),
      },
      {
        id: "inputbar.toggleDictation",
        titleKey: "commands.toggleDictation.title",
        descriptionKey: "commands.toggleDictation.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-dictation")),
      },
      {
        id: "inputbar.attachFiles",
        titleKey: "commands.attachFiles.title",
        descriptionKey: "commands.attachFiles.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:attach-files")),
      },
      {
        id: "inputbar.clearPrompt",
        titleKey: "commands.clearPrompt.title",
        descriptionKey: "commands.clearPrompt.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:clear-composer")),
      },
      {
        id: "panels.toggleSummaryPanel",
        titleKey: "commands.toggleSummaryPanel.title",
        descriptionKey: "commands.toggleSummaryPanel.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-summary-panel")),
      },
      {
        id: "panels.openTerminal",
        titleKey: "commands.openTerminal.title",
        descriptionKey: "commands.openTerminal.description",
        section: "panels",
        bindings: ["Control+`"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:open-terminal")),
      },
      {
        id: "panels.toggleBottomPanel",
        titleKey: "commands.toggleBottomPanel.title",
        descriptionKey: "commands.toggleBottomPanel.description",
        section: "panels",
        bindings: ["CommandOrControl+J"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-bottom-terminal")),
      },
      {
        id: "navigation.toggleSidebar",
        titleKey: "commands.toggleSidebar.title",
        descriptionKey: "commands.toggleSidebar.description",
        section: "navigation",
        bindings: ["CommandOrControl+Shift+S", "CommandOrControl+B"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-sidebar")),
      },
      {
        id: "navigation.focusComposer",
        titleKey: "commands.focusComposer.title",
        descriptionKey: "commands.focusComposer.description",
        section: "navigation",
        bindings: ["Alt+L"],
        handler: () => {
          const target = document.querySelector<HTMLElement>(
            '[data-testid="inputbar-core-container"] [contenteditable="true"]',
          );
          target?.focus();
        },
      },
      {
        id: "search.previousChat",
        titleKey: "commands.searchPreviousChat.title",
        descriptionKey: "commands.searchPreviousChat.description",
        section: "navigation",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:search-chats-previous"),
          ),
      },
      {
        id: "search.nextChat",
        titleKey: "commands.searchNextChat.title",
        descriptionKey: "commands.searchNextChat.description",
        section: "navigation",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:search-chats-next")),
      },
      {
        id: "navigation.togglePriorityFilter",
        titleKey: "commands.togglePriorityFilter.title",
        descriptionKey: "commands.togglePriorityFilter.description",
        section: "navigation",
        bindings: ["CommandOrControl+Alt+U"],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:toggle-priority-filter"),
          ),
      },
      {
        id: "navigation.focusSidebar",
        titleKey: "commands.focusSidebar.title",
        descriptionKey: "commands.focusSidebar.description",
        section: "navigation",
        bindings: [],
        handler: () => {
          const target = document.querySelector<HTMLElement>(
            '[data-testid="app-sidebar-search-button"]',
          );
          target?.focus();
        },
      },
      {
        id: "panels.fullView",
        titleKey: "commands.fullView.title",
        descriptionKey: "commands.fullView.description",
        section: "panels",
        bindings: ["CommandOrControl+Shift+F"],
        allowInInput: true,
        handler: toggleWorkspaceFullView,
      },
      {
        id: "panels.reviewTab",
        titleKey: "commands.reviewTab.title",
        descriptionKey: "commands.reviewTab.description",
        section: "panels",
        bindings: ["CommandOrControl+Shift+G"],
        allowInInput: true,
        handler: requestWorkspaceReviewTab,
      },
      {
        id: "panels.toggleChangesPanel",
        titleKey: "commands.toggleChangesPanel.title",
        descriptionKey: "commands.toggleChangesPanel.description",
        section: "panels",
        bindings: ["CommandOrControl+Alt+B"],
        allowInInput: true,
        handler: requestWorkspaceReviewTabToggle,
      },
      {
        id: "panels.closeChangesPanel",
        titleKey: "commands.closeChangesPanel.title",
        descriptionKey: "commands.closeChangesPanel.description",
        section: "panels",
        bindings: [],
        allowInInput: true,
        handler: requestWorkspaceReviewTabClose,
      },
      {
        id: "thread.archiveChat",
        titleKey: "commands.archiveChat.title",
        descriptionKey: "commands.archiveChat.description",
        section: "thread",
        bindings: ["CommandOrControl+Shift+A"],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:thread-shortcut", { detail: "archive" }),
          ),
      },
      {
        id: "thread.pinChat",
        titleKey: "commands.pinChat.title",
        descriptionKey: "commands.pinChat.description",
        section: "thread",
        bindings: ["CommandOrControl+Alt+P"],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:thread-shortcut", { detail: "pin" }),
          ),
      },
      {
        id: "thread.renameChat",
        titleKey: "commands.renameChat.title",
        descriptionKey: "commands.renameChat.description",
        section: "thread",
        bindings: ["CommandOrControl+Alt+R"],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:thread-shortcut", { detail: "rename" }),
          ),
      },
      {
        id: "navigation.markAllRead",
        titleKey: "commands.markAllRead.title",
        descriptionKey: "commands.markAllRead.description",
        section: "navigation",
        bindings: ["Shift+Escape"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:mark-all-read")),
      },
      {
        id: "thread.markUnread",
        titleKey: "commands.markUnread.title",
        descriptionKey: "commands.markUnread.description",
        section: "thread",
        bindings: ["CommandOrControl+Shift+U"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:mark-active-unread")),
      },
      {
        id: "thread.forkChat",
        titleKey: "commands.forkChat.title",
        descriptionKey: "commands.forkChat.description",
        section: "thread",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:thread-shortcut", { detail: "fork" }),
          ),
      },
      {
        id: "app.screenshotCurrentChat",
        titleKey: "commands.screenshotCurrentChat.title",
        descriptionKey: "commands.screenshotCurrentChat.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:screenshot-current-chat"),
          ),
      },
      {
        id: "app.screenshotNewChat",
        titleKey: "commands.screenshotNewChat.title",
        descriptionKey: "commands.screenshotNewChat.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:screenshot-new-chat"),
          ),
      },
      {
        id: "app.copyWorkingDirectory",
        titleKey: "commands.copyWorkingDirectory.title",
        descriptionKey: "commands.copyWorkingDirectory.description",
        section: "app",
        bindings: ["CommandOrControl+Shift+C"],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:copy-working-directory")),
      },
      {
        id: "app.openKeyboardShortcutsSettings",
        titleKey: "commands.openKeyboardShortcutsSettings.title",
        descriptionKey: "commands.openKeyboardShortcutsSettings.description",
        section: "app",
        bindings: [],
        handler: () =>
          onNavigate?.("settings", {
            tab: SettingsTabs.KeyboardShortcuts,
          } as PageParams),
      },
      {
        id: "app.openMcpSettings",
        titleKey: "commands.openMcpSettings.title",
        descriptionKey: "commands.openMcpSettings.description",
        section: "app",
        bindings: [],
        handler: () =>
          onNavigate?.("settings", {
            tab: SettingsTabs.McpServers,
          } as PageParams),
      },
      {
        id: "app.openImportSettings",
        titleKey: "commands.openImportSettings.title",
        descriptionKey: "commands.openImportSettings.description",
        section: "app",
        bindings: [],
        handler: () =>
          onNavigate?.("settings", {
            tab: SettingsTabs.Import,
          } as PageParams),
      },
      {
        id: "app.openScheduledTasks",
        titleKey: "commands.openScheduledTasks.title",
        descriptionKey: "commands.openScheduledTasks.description",
        section: "app",
        bindings: [],
        handler: () => onNavigate?.("scheduled-tasks"),
      },
      {
        id: "app.openSkills",
        titleKey: "commands.openSkills.title",
        descriptionKey: "commands.openSkills.description",
        section: "skills",
        bindings: [],
        handler: () => onNavigate?.("skills"),
      },
      {
        id: "app.copyConversationMarkdown",
        titleKey: "commands.copyConversationMarkdown.title",
        descriptionKey: "commands.copyConversationMarkdown.description",
        section: "app",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:copy-conversation-markdown"),
          ),
      },
      {
        id: "browser.back",
        titleKey: "commands.browserBack.title",
        descriptionKey: "commands.browserBack.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-back")),
      },
      {
        id: "browser.forward",
        titleKey: "commands.browserForward.title",
        descriptionKey: "commands.browserForward.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-forward")),
      },
      {
        id: "browser.findNext",
        titleKey: "commands.browserFindNext.title",
        descriptionKey: "commands.browserFindNext.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-find-next")),
      },
      {
        id: "browser.findPrevious",
        titleKey: "commands.browserFindPrevious.title",
        descriptionKey: "commands.browserFindPrevious.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-find-previous")),
      },
      {
        id: "browser.find",
        titleKey: "commands.browserFind.title",
        descriptionKey: "commands.browserFind.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:open-browser-find")),
      },
      {
        id: "browser.focusPage",
        titleKey: "commands.browserFocusPage.title",
        descriptionKey: "commands.browserFocusPage.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-focus-page")),
      },
      {
        id: "browser.closeAllTabs",
        titleKey: "commands.browserCloseAllTabs.title",
        descriptionKey: "commands.browserCloseAllTabs.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:browser-close-all-tabs"),
          ),
      },
      {
        id: "browser.closeOtherTabs",
        titleKey: "commands.browserCloseOtherTabs.title",
        descriptionKey: "commands.browserCloseOtherTabs.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("lime:browser-close-other-tabs"),
          ),
      },
      {
        id: "browser.nextTab",
        titleKey: "commands.browserNextTab.title",
        descriptionKey: "commands.browserNextTab.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-next-tab")),
      },
      {
        id: "browser.previousTab",
        titleKey: "commands.browserPreviousTab.title",
        descriptionKey: "commands.browserPreviousTab.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-previous-tab")),
      },
      {
        id: "browser.closeTab",
        titleKey: "commands.browserCloseTab.title",
        descriptionKey: "commands.browserCloseTab.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-close-tab")),
      },
      {
        id: "browser.newTab",
        titleKey: "commands.browserNewTab.title",
        descriptionKey: "commands.browserNewTab.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-new-tab")),
      },
      {
        id: "browser.stopLoading",
        titleKey: "commands.browserStop.title",
        descriptionKey: "commands.browserStop.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-stop")),
      },
      ...(
        [
          ["browser.zoomIn", "browser-zoom-in", "browserZoomIn"],
          ["browser.zoomOut", "browser-zoom-out", "browserZoomOut"],
          ["browser.zoomReset", "browser-zoom-reset", "browserZoomReset"],
          ["browser.toggleMute", "browser-toggle-mute", "browserToggleMute"],
        ] as const
      ).map(([id, event, copy]) => ({
        id,
        titleKey: `commands.${copy}.title`,
        descriptionKey: `commands.${copy}.description`,
        section: "panels" as const,
        bindings: [],
        handler: () => window.dispatchEvent(new CustomEvent(`lime:${event}`)),
      })),
      {
        id: "browser.copyUrl",
        titleKey: "commands.browserCopyUrl.title",
        descriptionKey: "commands.browserCopyUrl.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:copy-browser-url")),
      },
      {
        id: "browser.copyScreenshot",
        titleKey: "commands.browserScreenshot.title",
        descriptionKey: "commands.browserScreenshot.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-copy-screenshot")),
      },
      {
        id: "browser.print",
        titleKey: "commands.browserPrint.title",
        descriptionKey: "commands.browserPrint.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-print")),
      },
      {
        id: "browser.focusAddress",
        titleKey: "commands.browserFocusAddress.title",
        descriptionKey: "commands.browserFocusAddress.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:focus-browser-address")),
      },
      {
        id: "browser.hardReload",
        titleKey: "commands.browserHardReload.title",
        descriptionKey: "commands.browserHardReload.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-hard-reload")),
      },
      {
        id: "browser.reload",
        titleKey: "commands.browserReload.title",
        descriptionKey: "commands.browserReload.description",
        section: "panels",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:browser-reload")),
      },
      {
        id: "app.copyConversationDeepLink",
        titleKey: "commands.copyConversationDeepLink.title",
        descriptionKey: "commands.copyConversationDeepLink.description",
        section: "thread",
        bindings: [],
        handler: async () => {
          const sessionId = activeTab();
          if (!sessionId) return;
          await navigator.clipboard.writeText(
            `lime://session?sessionId=${encodeURIComponent(sessionId)}`,
          );
        },
      },
      {
        id: "thread.deleteChat",
        titleKey: "commands.deleteChat.title",
        descriptionKey: "commands.deleteChat.description",
        section: "thread",
        bindings: [],
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:delete-active-chat")),
      },
      {
        id: "thread.copyConversationPath",
        titleKey: "commands.copyConversationPath.title",
        descriptionKey: "commands.copyConversationPath.description",
        section: "thread",
        bindings: [],
        handler: async () => {
          const sessionId = activeTab();
          if (!sessionId) return;
          const path = await readAgentRuntimeSessionRolloutPath(sessionId);
          if (path) await navigator.clipboard.writeText(path);
        },
      },
      {
        id: "app.copyConversationLink",
        titleKey: "commands.copyConversationLink.title",
        descriptionKey: "commands.copyConversationLink.description",
        section: "app",
        bindings: ["CommandOrControl+Alt+L"],
        handler: () => {
          void navigator.clipboard?.writeText(window.location.href);
        },
      },
      {
        id: "app.copyLastCode",
        titleKey: "commands.copyLastCode.title",
        descriptionKey: "commands.copyLastCode.description",
        section: "app",
        bindings: ["CommandOrControl+Shift+;"],
        allowInInput: true,
        handler: () => {
          const buttons = document.querySelectorAll<HTMLButtonElement>(
            "[data-markdown-code-action]",
          );
          buttons.item(buttons.length - 1)?.click();
        },
      },
    ];
  }, [onNavigate, t]);
  return (
    <>
      {commands.map((command) => (
        <ShortcutCommand key={command.id} command={command} />
      ))}
    </>
  );
}
