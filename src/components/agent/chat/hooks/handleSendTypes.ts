import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { BrowserPreflightState, BrowserTaskRequirement, MessageImage } from "../types";

export interface HandleSendObserver {
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

export interface HandleSendOptions {
  skipThemeSkillPrefix?: boolean;
  purpose?: "content_review" | "text_stylize" | "style_rewrite" | "style_audit";
  observer?: HandleSendObserver;
  requestMetadata?: Record<string, unknown>;
  toolPreferencesOverride?: ChatToolPreferences;
}

export interface BrowserTaskPreflight {
  requestId: string;
  createdAt: number;
  sourceText: string;
  images: MessageImage[];
  webSearch?: boolean;
  thinking?: boolean;
  sendExecutionStrategy?: "react" | "code_orchestrated" | "auto";
  autoContinuePayload?: AutoContinueRequestPayload;
  sendOptions?: HandleSendOptions;
  requirement: BrowserTaskRequirement;
  reason: string;
  phase: BrowserPreflightState;
  launchUrl: string;
  platformLabel?: string;
  detail?: string;
}
