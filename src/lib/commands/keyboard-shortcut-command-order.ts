import type { CommandSection, RegisteredCommand } from "./registry";

// 对齐 Desktop keyboard-shortcut-command-order；general 对应未分组命令的末尾位置。
export const keyboardShortcutSections = [
  "thread",
  "navigation",
  "panels",
  "workspace",
  "skills",
  "configure",
  "app",
  "general",
] as const satisfies readonly CommandSection[];

const priorityCommands = [
  "newTask",
  "temporaryChat",
  "archiveThread",
  "newProjectlessTask",
  "openSideChat",
];

function priority(id: string) {
  const index = priorityCommands.indexOf(id);
  return index === -1 ? priorityCommands.length : index;
}

export function compareKeyboardShortcutCommands(
  left: Pick<RegisteredCommand, "id" | "section">,
  right: Pick<RegisteredCommand, "id" | "section">,
) {
  return (
    keyboardShortcutSections.indexOf(left.section) -
      keyboardShortcutSections.indexOf(right.section) ||
    priority(left.id) - priority(right.id) ||
    left.id.localeCompare(right.id)
  );
}
