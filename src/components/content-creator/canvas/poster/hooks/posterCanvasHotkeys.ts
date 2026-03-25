/**
 * @file posterCanvasHotkeys.ts
 * @description 海报画布快捷键定义与匹配
 */

import {
  hasPrimaryModifier,
  isInputLikeTarget,
  normalizeHotkeyKey,
  type HotkeyEventLike,
} from "@/lib/hotkeys/platform";
import type { AuditedHotkeyDefinition } from "@/lib/hotkeys/types";

export const POSTER_CANVAS_HOTKEYS: AuditedHotkeyDefinition[] = [
  {
    id: "poster-undo",
    label: "海报撤销",
    description: "撤销上一笔海报编辑操作。",
    shortcut: "CommandOrControl+Z",
    scope: "local",
    scene: "poster-canvas",
    source: "海报画布",
    condition: "仅在海报画布内生效，输入框聚焦时忽略。",
  },
  {
    id: "poster-redo",
    label: "海报重做",
    description: "重做最近一次撤销的海报编辑操作。",
    shortcut: "CommandOrControl+Shift+Z",
    scope: "local",
    scene: "poster-canvas",
    source: "海报画布",
    condition: "仅在海报画布内生效，输入框聚焦时忽略。",
  },
  {
    id: "poster-redo-windows",
    label: "海报重做（Windows 风格）",
    description: "使用 Windows 常见组合键重做海报编辑操作。",
    shortcut: "CommandOrControl+Y",
    scope: "local",
    scene: "poster-canvas",
    source: "海报画布",
    condition: "仅在海报画布内生效，输入框聚焦时忽略。",
  },
  {
    id: "poster-select-all",
    label: "海报全选",
    description: "选中画布中的全部元素。",
    shortcut: "CommandOrControl+A",
    scope: "local",
    scene: "poster-canvas",
    source: "海报画布",
    condition: "仅在海报画布内生效，输入框聚焦时忽略。",
  },
  {
    id: "poster-group",
    label: "海报组合",
    description: "将当前选中元素组合为一个组。",
    shortcut: "CommandOrControl+G",
    scope: "local",
    scene: "poster-canvas",
    source: "海报画布",
    condition: "仅在海报画布内生效，输入框聚焦时忽略。",
  },
  {
    id: "poster-ungroup",
    label: "海报取消组合",
    description: "取消当前组对象的组合状态。",
    shortcut: "CommandOrControl+Shift+G",
    scope: "local",
    scene: "poster-canvas",
    source: "海报画布",
    condition: "仅在海报画布内生效，输入框聚焦时忽略。",
  },
];

export type PosterCanvasHotkeyAction =
  | "undo"
  | "redo"
  | "select-all"
  | "group"
  | "ungroup";

export function resolvePosterCanvasHotkeyAction(
  event: HotkeyEventLike,
): PosterCanvasHotkeyAction | null {
  if (!hasPrimaryModifier(event)) {
    return null;
  }

  const key = normalizeHotkeyKey(event.key);
  const shouldIgnoreForInputTarget = isInputLikeTarget(event.target);

  if (key === "z" && !event.shiftKey) {
    return shouldIgnoreForInputTarget ? null : "undo";
  }

  if ((key === "z" && event.shiftKey) || key === "y") {
    return shouldIgnoreForInputTarget ? null : "redo";
  }

  if (key === "a") {
    return shouldIgnoreForInputTarget ? null : "select-all";
  }

  if (key === "g" && !event.shiftKey) {
    return shouldIgnoreForInputTarget ? null : "group";
  }

  if (key === "g" && event.shiftKey) {
    return shouldIgnoreForInputTarget ? null : "ungroup";
  }

  return null;
}
