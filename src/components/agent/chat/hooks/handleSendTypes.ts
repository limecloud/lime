import type { SlashSkillRequest } from "./agentChatShared";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";

export interface HandleSendObserver {
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

export interface HandleSendOptions {
  skipThemeSkillPrefix?: boolean;
  skipSceneCommandRouting?: boolean;
  purpose?: "content_review" | "text_stylize" | "style_rewrite" | "style_audit";
  observer?: HandleSendObserver;
  requestMetadata?: Record<string, unknown>;
  toolPreferencesOverride?: ChatToolPreferences;
  displayContent?: string;
  skillRequest?: SlashSkillRequest;
}
