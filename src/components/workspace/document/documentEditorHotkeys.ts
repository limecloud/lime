/**
 * @file documentEditorHotkeys.ts
 * @description 文档编辑器快捷键定义与匹配
 */

import {
  hasPrimaryModifier,
  normalizeHotkeyKey,
  type HotkeyEventLike,
} from "@/lib/hotkeys/platform";
import type { AuditedHotkeyDefinition } from "@/lib/hotkeys/types";

export const DOCUMENT_EDITOR_HOTKEYS: AuditedHotkeyDefinition[] = [
  {
    id: "document-editor-save",
    label: "保存文档编辑",
    description: "保存当前文档编辑内容。",
    shortcut: "CommandOrControl+S",
    scope: "local",
    scene: "document-editor",
    source: "文档编辑器",
    condition: "仅在文档编辑态聚焦时生效。",
  },
  {
    id: "document-editor-cancel",
    label: "退出文档编辑",
    description: "取消当前编辑并退出编辑态。",
    shortcut: "Escape",
    scope: "local",
    scene: "document-editor",
    source: "文档编辑器",
    condition: "仅在文档编辑态聚焦时生效。",
  },
];

export type DocumentEditorHotkeyAction = "save" | "cancel";

export function resolveDocumentEditorHotkeyAction(
  event: HotkeyEventLike,
): DocumentEditorHotkeyAction | null {
  if (hasPrimaryModifier(event) && normalizeHotkeyKey(event.key) === "s") {
    return "save";
  }

  return event.key === "Escape" ? "cancel" : null;
}
