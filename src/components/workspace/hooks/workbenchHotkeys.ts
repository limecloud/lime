/**
 * @file workbenchHotkeys.ts
 * @description 工作区级快捷键定义与匹配
 */

import { hasPrimaryModifier, normalizeHotkeyKey, type HotkeyEventLike } from "@/lib/hotkeys/platform";
import type { AuditedHotkeyDefinition } from "@/lib/hotkeys/types";

export const WORKBENCH_SIDEBAR_TOGGLE_HOTKEY: AuditedHotkeyDefinition = {
  id: "workspace-sidebar-toggle",
  label: "侧栏展开 / 折叠",
  description: "切换工作区左侧栏的展开状态。",
  shortcut: "CommandOrControl+B",
  scope: "local",
  scene: "workspace",
  source: "工作区",
  condition: "仅在工作区页面内生效。",
};

export type WorkbenchHotkeyAction = "toggle-sidebar";

export function resolveWorkbenchHotkeyAction(
  event: HotkeyEventLike,
): WorkbenchHotkeyAction | null {
  if (!hasPrimaryModifier(event)) {
    return null;
  }

  return normalizeHotkeyKey(event.key) === "b" ? "toggle-sidebar" : null;
}
