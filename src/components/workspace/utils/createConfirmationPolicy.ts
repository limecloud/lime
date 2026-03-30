import type { CreationMode } from "@/lib/workspace/workbenchContract";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";

export type CreateConfirmationSource =
  | "project_created"
  | "open_project_for_writing"
  | "workspace_create_entry"
  | "workspace_prompt"
  | "quick_create";

export type CreateConfirmationOption =
  | "continue_history"
  | "new_post"
  | "new_version"
  | "other";

export interface PendingCreateConfirmation {
  projectId: string;
  source: CreateConfirmationSource;
  creationMode: CreationMode;
  initialUserPrompt?: string;
  preferredContentId?: string;
  fallbackContentTitle?: string;
  createdAt: number;
}

export interface CreateConfirmationIntent {
  option: CreateConfirmationOption;
  note: string;
}

interface ParseCreateConfirmationIntentSuccess {
  ok: true;
  intent: CreateConfirmationIntent;
}

interface ParseCreateConfirmationIntentFailure {
  ok: false;
  message: string;
}

export type ParseCreateConfirmationIntentResult =
  | ParseCreateConfirmationIntentSuccess
  | ParseCreateConfirmationIntentFailure;

export const CREATE_CONFIRMATION_FORM_FIELDS = {
  option: "create_confirmation_option",
  note: "create_confirmation_note",
} as const;

const SOURCE_HINTS: Record<CreateConfirmationSource, string> = {
  project_created: "项目已经准备好。先确认这次是继续已有内容，还是新开一篇。",
  open_project_for_writing: "开始创作前，再确认一下这次希望如何进入工作流。",
  workspace_create_entry: "先确认开始方式，我会按你的选择继续处理。",
  workspace_prompt: "我已经收到你的提示，先确认要继续已有内容还是创建新稿。",
  quick_create: "快捷创建前先补一条确认信息，避免重复开稿。",
};

const OPTION_LABELS: Record<CreateConfirmationOption, string> = {
  continue_history: "继续完善已有内容",
  new_post: "新写一篇内容",
  new_version: "新建一个版本",
  other: "其他方式",
};

export function getCreateConfirmationSourceHint(
  source: CreateConfirmationSource,
): string {
  return SOURCE_HINTS[source] || "先确认开始方式，我会据此继续处理。";
}

function normalizeConfirmationOption(
  rawValue: unknown,
): CreateConfirmationOption | null {
  const firstValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof firstValue !== "string") {
    return null;
  }
  switch (firstValue) {
    case "continue_history":
    case "new_post":
    case "new_version":
    case "other":
      return firstValue;
    default:
      return null;
  }
}

export function parseCreateConfirmationIntent(
  formData: A2UIFormData,
): ParseCreateConfirmationIntentResult {
  const option = normalizeConfirmationOption(
    formData[CREATE_CONFIRMATION_FORM_FIELDS.option],
  );
  if (!option) {
    return {
      ok: false,
      message: "请先选择这次希望如何开始",
    };
  }

  const noteRaw = formData[CREATE_CONFIRMATION_FORM_FIELDS.note];
  const note =
    typeof noteRaw === "string" ? noteRaw.trim() : String(noteRaw || "").trim();

  if (option === "other" && note.length < 2) {
    return {
      ok: false,
      message: "选择“其他方式”时请至少补充 2 个字说明",
    };
  }

  return {
    ok: true,
    intent: {
      option,
      note,
    },
  };
}

export function shouldCreateContentByIntent(
  intent: CreateConfirmationIntent,
): boolean {
  return intent.option !== "continue_history";
}

export function resolveConfirmedInitialPrompt(
  pending: PendingCreateConfirmation,
  intent: CreateConfirmationIntent,
): string {
  const preferredPrompt = pending.initialUserPrompt?.trim() || "";
  if (preferredPrompt) {
    return preferredPrompt;
  }
  if (intent.option === "other") {
    return intent.note;
  }
  return "";
}

export function resolveCreateContentTitle(
  pending: PendingCreateConfirmation,
  defaultTitle: string,
  intent: CreateConfirmationIntent,
): string {
  const fallbackTitle = pending.fallbackContentTitle?.trim() || "";
  if (fallbackTitle) {
    return fallbackTitle;
  }
  if (intent.option === "new_version") {
    return `新版本-${defaultTitle}`;
  }
  return defaultTitle;
}

export function buildCreateConfirmationMetadata(
  pending: PendingCreateConfirmation,
  intent: CreateConfirmationIntent,
): Record<string, unknown> {
  return {
    creationMode: pending.creationMode,
    createConfirmation: {
      source: pending.source,
      option: intent.option,
      optionLabel: OPTION_LABELS[intent.option],
      note: intent.note || null,
      confirmedAt: Date.now(),
    },
  };
}

export function buildCreateConfirmationA2UI(
  pending: PendingCreateConfirmation,
): A2UIResponse {
  const rootId = "create_confirmation_root";
  const hintId = "create_confirmation_hint";
  const optionId = CREATE_CONFIRMATION_FORM_FIELDS.option;
  const noteId = CREATE_CONFIRMATION_FORM_FIELDS.note;

  return {
    id: `create-confirmation-${pending.projectId}`,
    root: rootId,
    data: {},
    components: [
      {
        id: hintId,
        component: "Text",
        text: getCreateConfirmationSourceHint(pending.source),
        variant: "body",
      },
      {
        id: optionId,
        component: "ChoicePicker",
        label: "你希望我如何开始这次创作？",
        value: [],
        variant: "mutuallyExclusive",
        layout: "vertical",
        options: [
          {
            value: "continue_history",
            label: OPTION_LABELS.continue_history,
            description: "直接回到最近相关文稿继续，不额外新建。",
          },
          {
            value: "new_post",
            label: OPTION_LABELS.new_post,
            description: "创建新的独立文稿，从这次需求开始写。",
          },
          {
            value: "new_version",
            label: OPTION_LABELS.new_version,
            description: "保留当前项目语境，再开一个版本文稿。",
          },
          {
            value: "other",
            label: OPTION_LABELS.other,
            description: "如果你有特殊开始方式，可以补充说明。",
          },
        ],
      },
      {
        id: noteId,
        component: "TextField",
        label: "补充说明（可选）",
        value: "",
        variant: "longText",
        placeholder: "如果你有明确主题、素材、目标读者或限制条件，可以补充在这里",
        helperText: "选择“其他方式”时，建议在这里补充说明。",
        visible: {
          path: `formData.${optionId}.0`,
        },
      },
      {
        id: rootId,
        component: "Column",
        children: [hintId, optionId, noteId],
        gap: 16,
        align: "stretch",
      },
    ],
    submitAction: {
      label: "开始处理",
      action: {
        name: "submit",
      },
    },
  };
}
