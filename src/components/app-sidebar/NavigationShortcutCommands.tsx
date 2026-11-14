import { useMemo } from "react";
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
import { requestWorkspaceReviewTab } from "@/lib/workspaceReviewTabEvents";
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
        bindings: ["CommandOrControl+N"],
        allowInInput: true,
        handler: requestNewConversationTab,
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
          window.dispatchEvent(
            new CustomEvent("lime:toggle-summary-panel"),
          ),
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
        bindings: ["CommandOrControl+Shift+S"],
        allowInInput: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("lime:toggle-sidebar")),
      },
      {
        id: "navigation.focusComposer",
        titleKey: "commands.focusComposer.title",
        descriptionKey: "commands.focusComposer.description",
        section: "navigation",
        bindings: [],
        handler: () => {
          const target = document.querySelector<HTMLElement>(
            '[data-testid="inputbar-core-container"] [contenteditable="true"]',
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
        id: "app.copyWorkingDirectory",
        titleKey: "commands.copyWorkingDirectory.title",
        descriptionKey: "commands.copyWorkingDirectory.description",
        section: "app",
        bindings: [],
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
        id: "app.copyConversationLink",
        titleKey: "commands.copyConversationLink.title",
        descriptionKey: "commands.copyConversationLink.description",
        section: "app",
        bindings: [],
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
  }, [onNavigate]);
  return (
    <>
      {commands.map((command) => (
        <ShortcutCommand key={command.id} command={command} />
      ))}
    </>
  );
}
