/**
 * @file hotkeyCatalog.ts
 * @description 快捷键页的共享事实源
 */

import type { VoiceInputConfig } from "@/lib/api/asrProvider";
import type { ExperimentalFeatures } from "@/lib/api/experimentalFeatures";
import type { HotkeyRuntimeStatus } from "@/lib/api/hotkeys";
import {
  formatShortcutTokens,
  type HotkeyPlatform,
} from "@/lib/hotkeys/platform";
import type {
  AuditedHotkeyDefinition,
  HotkeyScene,
} from "@/lib/hotkeys/types";
import { DOCUMENT_CANVAS_HOTKEYS } from "@/components/content-creator/canvas/document/documentCanvasHotkeys";
import { DOCUMENT_EDITOR_HOTKEYS } from "@/components/content-creator/canvas/document/documentEditorHotkeys";
import { POSTER_CANVAS_HOTKEYS } from "@/components/content-creator/canvas/poster/hooks/posterCanvasHotkeys";
import { getTerminalPageHotkeys } from "@/components/terminal/terminalPageHotkeys";
import { WORKBENCH_SIDEBAR_TOGGLE_HOTKEY } from "@/components/workspace/hooks/workbenchHotkeys";

export type HotkeyStatusKind =
  | "ready"
  | "inactive"
  | "needs-config"
  | "runtime-error";

export interface AuditedHotkeyItem extends AuditedHotkeyDefinition {
  keys: string[];
  status: HotkeyStatusKind;
  statusLabel: string;
  statusDescription: string;
  available: boolean;
}

export interface AuditedHotkeySection {
  scene: HotkeyScene;
  title: string;
  description: string;
  hotkeys: AuditedHotkeyItem[];
}

export interface AuditedHotkeySummary {
  total: number;
  ready: number;
  attention: number;
  globalReady: number;
}

export interface AuditedHotkeyCatalog {
  sections: AuditedHotkeySection[];
  summary: AuditedHotkeySummary;
}

interface BuildHotkeyCatalogParams {
  platform: HotkeyPlatform;
  experimentalConfig: ExperimentalFeatures;
  voiceConfig: Partial<VoiceInputConfig>;
  runtimeStatus: HotkeyRuntimeStatus | null;
}

const GLOBAL_SHORTCUT_DEFINITIONS: AuditedHotkeyDefinition[] = [
  {
    id: "screenshot-chat",
    label: "截图对话",
    description: "全局截图后直接打开截图问答窗口。",
    shortcut: "",
    scope: "global",
    scene: "global",
    source: "实验功能 → 截图对话",
    condition: "依赖实验功能开关与系统全局快捷键权限。",
  },
  {
    id: "voice-input",
    label: "语音输入",
    description: "按下开始录音，松开后识别并输出文本。",
    shortcut: "",
    scope: "global",
    scene: "global",
    source: "语音服务",
    condition: "依赖语音输入已启用且系统允许注册全局快捷键。",
  },
  {
    id: "voice-translate",
    label: "语音翻译模式",
    description: "直接走翻译指令完成录音、识别与翻译。",
    shortcut: "",
    scope: "global",
    scene: "global",
    source: "语音服务 → 翻译模式",
    condition: "依赖语音输入启用、翻译快捷键与翻译指令均已配置。",
  },
];

const SCENE_META: Record<
  HotkeyScene,
  { title: string; description: string }
> = {
  global: {
    title: "全局快捷键",
    description: "离开当前页面也能触发，是否可用取决于运行时是否注册成功。",
  },
  workspace: {
    title: "工作区",
    description: "用于主工作区导航与侧栏控制。",
  },
  terminal: {
    title: "终端页面",
    description: "只在终端页面里生效，用于搜索和字体调整。",
  },
  "document-editor": {
    title: "文档编辑器",
    description: "针对源码/富文本编辑态的保存与退出操作。",
  },
  "document-canvas": {
    title: "文档画布",
    description: "用于文档画布层级的撤销与重做。",
  },
  "poster-canvas": {
    title: "海报画布",
    description: "用于海报画布编辑、撤销和元素组合。",
  },
};

function createStaticHotkeyItem(
  definition: AuditedHotkeyDefinition,
  platform: HotkeyPlatform,
): AuditedHotkeyItem {
  return {
    ...definition,
    keys: formatShortcutTokens(definition.shortcut, platform),
    status: "ready",
    statusLabel: "可直接使用",
    statusDescription: definition.condition,
    available: true,
  };
}

function buildScreenshotHotkey(
  platform: HotkeyPlatform,
  experimentalConfig: ExperimentalFeatures,
  runtimeStatus: HotkeyRuntimeStatus | null,
): AuditedHotkeyItem {
  const definition = GLOBAL_SHORTCUT_DEFINITIONS[0]!;
  const shortcut = experimentalConfig.screenshot_chat.shortcut;
  const enabled = experimentalConfig.screenshot_chat.enabled;
  const registered = runtimeStatus?.screenshot.shortcut_registered ?? enabled;

  if (!enabled) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "inactive",
      statusLabel: "功能未启用",
      statusDescription: "去实验功能里开启截图对话后，才会注册全局快捷键。",
      available: false,
    };
  }

  if (!shortcut.trim()) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "needs-config",
      statusLabel: "未设置快捷键",
      statusDescription: "截图对话已开启，但当前没有可注册的快捷键。",
      available: false,
    };
  }

  if (!registered) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "runtime-error",
      statusLabel: "未注册到系统",
      statusDescription: "配置已开启，但运行时没有完成全局快捷键注册。",
      available: false,
    };
  }

  return {
    ...definition,
    shortcut,
    keys: formatShortcutTokens(shortcut, platform),
    status: "ready",
    statusLabel: "运行中",
    statusDescription: "已完成注册，可以在任意页面触发截图对话。",
    available: true,
  };
}

function buildVoiceInputHotkey(
  platform: HotkeyPlatform,
  voiceConfig: Partial<VoiceInputConfig>,
  runtimeStatus: HotkeyRuntimeStatus | null,
): AuditedHotkeyItem {
  const definition = GLOBAL_SHORTCUT_DEFINITIONS[1]!;
  const shortcut = voiceConfig.shortcut ?? "";
  const enabled = voiceConfig.enabled ?? false;
  const registered = runtimeStatus?.voice.shortcut_registered ?? enabled;

  if (!enabled) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "inactive",
      statusLabel: "功能未启用",
      statusDescription: "去语音服务里开启语音输入后才会注册全局快捷键。",
      available: false,
    };
  }

  if (!shortcut.trim()) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "needs-config",
      statusLabel: "未设置快捷键",
      statusDescription: "语音输入已启用，但没有配置可注册的快捷键。",
      available: false,
    };
  }

  if (!registered) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "runtime-error",
      statusLabel: "未注册到系统",
      statusDescription: "语音输入已启用，但运行时未成功注册快捷键。",
      available: false,
    };
  }

  return {
    ...definition,
    shortcut,
    keys: formatShortcutTokens(shortcut, platform),
    status: "ready",
    statusLabel: "运行中",
    statusDescription: "已完成注册，可以直接唤起语音输入。",
    available: true,
  };
}

function buildVoiceTranslateHotkey(
  platform: HotkeyPlatform,
  voiceConfig: Partial<VoiceInputConfig>,
  runtimeStatus: HotkeyRuntimeStatus | null,
): AuditedHotkeyItem {
  const definition = GLOBAL_SHORTCUT_DEFINITIONS[2]!;
  const shortcut = voiceConfig.translate_shortcut ?? "";
  const enabled = voiceConfig.enabled ?? false;
  const instructionId = voiceConfig.translate_instruction_id?.trim() ?? "";
  const registered =
    runtimeStatus?.voice.translate_shortcut_registered ??
    (enabled && Boolean(shortcut.trim()));

  if (!enabled) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "inactive",
      statusLabel: "语音输入未启用",
      statusDescription: "翻译模式依赖语音输入先启用。",
      available: false,
    };
  }

  if (!shortcut.trim()) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "needs-config",
      statusLabel: "未设置快捷键",
      statusDescription: "还没有给翻译模式绑定独立快捷键。",
      available: false,
    };
  }

  if (!instructionId) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "needs-config",
      statusLabel: "未绑定翻译指令",
      statusDescription: "先为翻译模式选择一条要执行的翻译指令。",
      available: false,
    };
  }

  if (!registered) {
    return {
      ...definition,
      shortcut,
      keys: formatShortcutTokens(shortcut, platform),
      status: "runtime-error",
      statusLabel: "未注册到系统",
      statusDescription: "翻译模式配置完整，但运行时没有成功注册快捷键。",
      available: false,
    };
  }

  return {
    ...definition,
    shortcut,
    keys: formatShortcutTokens(shortcut, platform),
    source: `语音服务 → 翻译指令 ${instructionId}`,
    status: "ready",
    statusLabel: "运行中",
    statusDescription: "已完成注册，可以直接进入翻译模式。",
    available: true,
  };
}

export function buildAuditedHotkeyCatalog({
  platform,
  experimentalConfig,
  voiceConfig,
  runtimeStatus,
}: BuildHotkeyCatalogParams): AuditedHotkeyCatalog {
  const sections: AuditedHotkeySection[] = [
    {
      scene: "global",
      ...SCENE_META.global,
      hotkeys: [
        buildScreenshotHotkey(platform, experimentalConfig, runtimeStatus),
        buildVoiceInputHotkey(platform, voiceConfig, runtimeStatus),
        buildVoiceTranslateHotkey(platform, voiceConfig, runtimeStatus),
      ],
    },
    {
      scene: "workspace",
      ...SCENE_META.workspace,
      hotkeys: [createStaticHotkeyItem(WORKBENCH_SIDEBAR_TOGGLE_HOTKEY, platform)],
    },
    {
      scene: "terminal",
      ...SCENE_META.terminal,
      hotkeys: getTerminalPageHotkeys(platform).map((item) =>
        createStaticHotkeyItem(item, platform),
      ),
    },
    {
      scene: "document-editor",
      ...SCENE_META["document-editor"],
      hotkeys: DOCUMENT_EDITOR_HOTKEYS.map((item) =>
        createStaticHotkeyItem(item, platform),
      ),
    },
    {
      scene: "document-canvas",
      ...SCENE_META["document-canvas"],
      hotkeys: DOCUMENT_CANVAS_HOTKEYS.map((item) =>
        createStaticHotkeyItem(item, platform),
      ),
    },
    {
      scene: "poster-canvas",
      ...SCENE_META["poster-canvas"],
      hotkeys: POSTER_CANVAS_HOTKEYS.map((item) =>
        createStaticHotkeyItem(item, platform),
      ),
    },
  ];

  const hotkeys = sections.flatMap((section) => section.hotkeys);
  const ready = hotkeys.filter((item) => item.available).length;
  const globalReady = sections[0]?.hotkeys.filter((item) => item.available).length ?? 0;

  return {
    sections,
    summary: {
      total: hotkeys.length,
      ready,
      attention: hotkeys.length - ready,
      globalReady,
    },
  };
}
