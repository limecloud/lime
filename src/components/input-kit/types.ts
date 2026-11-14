import type { ModelReasoningEffortLevel } from "@/lib/types/modelRegistry";
import type { TextElement, UserInput } from "@limecloud/app-server-client";

export type ComposerTextElement = TextElement;
export type ComposerInputMention = Extract<
  UserInput,
  { type: "skill" | "mention" }
>;

export interface ComposerSelection {
  /** UTF-16 offsets in serialized editor text, independent of PM positions. */
  start: number;
  end: number;
}

export interface ComposerEditorDocument {
  type: "doc";
  content: readonly ComposerBlock[];
}

export type ComposerBlock = ComposerParagraph | ComposerCodeBlock;

export interface ComposerCodeBlock {
  type: "code_block";
  attrs?: { autoDetectLanguage?: boolean; language?: string | null };
  content?: readonly { type: "text"; text: string }[];
}

export interface ComposerLinkAttributes {
  href: string | null;
  title: string | null;
  disabled: boolean;
  isAutolink: boolean;
  isGeneratedAutolink: boolean;
  literalMarkdownOccurrenceId: number | null;
  literalMarkdownSource: string | null;
  sourceAppId: string | null;
}

export interface ComposerLinkMark {
  type: "link";
  attrs?: Partial<ComposerLinkAttributes>;
}

export interface ComposerParagraph {
  type: "paragraph";
  content?: readonly ComposerInline[];
}

export type ComposerInline =
  | { type: "text"; text: string; marks?: readonly ComposerLinkMark[] }
  | { type: "hard_break" }
  | {
      type: "mention";
      attrs: {
        id: string;
        kind: "file" | "skill" | "plugin";
        name: string;
        path: string;
        label: string;
        displayName?: string;
      };
    }
  | { type: "paste"; attrs: { id: string; placeholder: string; text: string } }
  | {
      type: "text_element";
      attrs: { text: string; placeholder?: string | null };
    };

export interface ComposerAttachment {
  data: string;
  mediaType: string;
  sourceUri?: string;
  sourcePath?: string;
  previewUrl?: string;
  metadata?: Record<string, unknown>;
  index?: number;
}

export interface ComposerPathReference {
  id: string;
  path: string;
  name: string;
  isDir: boolean;
  size?: number | null;
  mimeType?: string | null;
  source?: "file_manager" | "system_drop";
}

export interface ComposerMentionBinding {
  id: string;
  kind: "file" | "skill" | "plugin";
  name: string;
  path: string;
  label: string;
  displayName?: string;
  from: number;
  to: number;
}

export interface ComposerPendingPaste {
  placeholder: string;
  text: string;
}

export interface ComposerDocumentInput {
  editorDocument?: ComposerEditorDocument;
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
  textElements?: readonly ComposerTextElement[];
  mentionBindings?: readonly ComposerMentionBinding[];
  attachments?: readonly ComposerAttachment[];
  pathReferences?: readonly ComposerPathReference[];
  pendingPastes?: readonly ComposerPendingPaste[];
  inputCapabilityRoute?: unknown;
}

export interface ComposerControllerOptions {
  enableRichText?: boolean;
  enableCodeBlocks?: boolean;
  plainTextMode?: boolean;
}

export interface ComposerDocument {
  editorDocument: ComposerEditorDocument;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  textElements: readonly ComposerTextElement[];
  mentionBindings: readonly ComposerMentionBinding[];
  attachments: readonly ComposerAttachment[];
  pathReferences: readonly ComposerPathReference[];
  pendingPastes: readonly ComposerPendingPaste[];
  inputCapabilityRoute?: unknown;
}

export type ComposerIntent =
  | "start"
  | "queue"
  | "steer"
  | "interrupt"
  | "command"
  | "edit"
  | "clear";

export type ComposerHistoryDirection = "previous" | "next";

export type ComposerSubmitTarget =
  | "start"
  | "queue"
  | "steer"
  | "interrupt"
  | "command";

export type ComposerDraftSnapshot = ComposerDocument;

export interface ComposerSubmission {
  text: string;
  textElements: readonly ComposerTextElement[];
  inputMentions: readonly ComposerInputMention[];
  attachments: readonly ComposerAttachment[];
  pathReferences: readonly ComposerPathReference[];
  inputCapabilityRoute?: unknown;
}

export interface ComposerControllerSnapshot {
  document: ComposerDocument;
  revision: number;
  lastIntent: ComposerIntent | null;
}

export type ComposerSubmitResult =
  | {
      kind: "accepted";
      intent: ComposerIntent;
      target: ComposerSubmitTarget;
      draft: ComposerDraftSnapshot;
      submission: ComposerSubmission;
      revision: number;
    }
  | {
      kind: "empty";
      intent: ComposerIntent;
      target: ComposerSubmitTarget;
      draft: ComposerDraftSnapshot;
      submission: ComposerSubmission;
      revision: number;
    };

export interface ComposerPasteOptions {
  platform?: "macos" | "windows" | "linux" | "unknown";
  bracketed?: boolean;
  /** 强制把粘贴内容折叠为 paste 原子（如应用快照文本）。 */
  preferPasteAtom?: boolean;
}

export interface ComposerState {
  text: string;
  isSending: boolean;
  disabled?: boolean;
  attachments?: ComposerAttachment[];
  document?: ComposerDocument;
}

export interface ModelSelectionState {
  providerType: string;
  model: string;
  reasoningEffort?: ModelReasoningEffortLevel | "";
  providersLoading?: boolean;
  modelsLoading?: boolean;
}

export interface ComposerActions {
  setText: (value: string) => void;
  send: (options?: { textOverride?: string }) => void;
  stop?: () => void;
  setProviderType?: (providerType: string) => void;
  setModel?: (model: string) => void;
  setReasoningEffort?: (value: ModelReasoningEffortLevel | "") => void;
}
