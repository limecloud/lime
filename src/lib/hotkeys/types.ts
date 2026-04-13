/**
 * @file types.ts
 * @description 应用快捷键共享类型
 */

export type HotkeyScope = "global" | "local";

export type HotkeyScene =
  | "global"
  | "workspace"
  | "document-editor"
  | "document-canvas";

export interface AuditedHotkeyDefinition {
  id: string;
  label: string;
  description: string;
  shortcut: string;
  scope: HotkeyScope;
  scene: HotkeyScene;
  source: string;
  condition: string;
}
