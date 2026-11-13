import { useMemo } from "react";
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

function ShortcutCommand({ command }: { command: CommandRegistration }) {
  useCommand(command);
  return null;
}

export function NavigationShortcutCommands() {
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
  }, []);
  return (
    <>
      {commands.map((command) => (
        <ShortcutCommand key={command.id} command={command} />
      ))}
    </>
  );
}
