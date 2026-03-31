/**
 * @file documentCanvasHotkeys.ts
 * @description 文档画布快捷键定义与匹配
 */

import { hasPrimaryModifier, normalizeHotkeyKey, type HotkeyEventLike } from "@/lib/hotkeys/platform";
import type { AuditedHotkeyDefinition } from "@/lib/hotkeys/types";

export const DOCUMENT_CANVAS_HOTKEYS: AuditedHotkeyDefinition[] = [
  {
    id: "document-canvas-undo",
    label: "文档撤销",
    description: "撤销上一步文档内容改动。",
    shortcut: "CommandOrControl+Z",
    scope: "local",
    scene: "document-canvas",
    source: "文档画布",
    condition: "仅在文档画布内生效。",
  },
  {
    id: "document-canvas-redo",
    label: "文档重做",
    description: "恢复最近一次被撤销的内容改动。",
    shortcut: "CommandOrControl+Shift+Z",
    scope: "local",
    scene: "document-canvas",
    source: "文档画布",
    condition: "仅在文档画布内生效。",
  },
];

export type DocumentCanvasHotkeyAction = "undo" | "redo";

export function resolveDocumentCanvasHotkeyAction(
  event: HotkeyEventLike,
): DocumentCanvasHotkeyAction | null {
  if (!hasPrimaryModifier(event) || normalizeHotkeyKey(event.key) !== "z") {
    return null;
  }

  return event.shiftKey ? "redo" : "undo";
}
