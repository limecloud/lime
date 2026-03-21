import { buildClawAgentParams } from "@/lib/workspace/navigation";
import type { AgentPageParams } from "@/types/page";
import type { CreationMode } from "./components/types";
import type { MessageImage } from "./types";
import type { ChatToolPreferences } from "./utils/chatToolPreferences";

export interface AgentChatWorkspaceBootstrap {
  projectId?: string;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  theme?: string;
  initialCreationMode?: CreationMode;
  openBrowserAssistOnMount?: boolean;
  newChatAt?: number;
}

export interface HomeShellEnterWorkspacePayload {
  prompt?: string;
  images?: MessageImage[];
  openBrowserAssistOnMount?: boolean;
  toolPreferences?: ChatToolPreferences;
  themeOverride?: string;
}

export interface ResolveHomeShellWorkspaceEntryInput {
  projectId?: string | null;
  activeTheme: string;
  creationMode: CreationMode;
  defaultToolPreferences: ChatToolPreferences;
  payload: HomeShellEnterWorkspacePayload;
  now?: () => number;
}

export type HomeShellEnterWorkspaceRejectedReason =
  | "missing_project"
  | "empty_payload";

export type ResolvedHomeShellWorkspaceEntry =
  | {
      ok: false;
      reason: HomeShellEnterWorkspaceRejectedReason;
    }
  | {
      ok: true;
      toolPreferences: ChatToolPreferences;
      targetTheme: string;
      nextNewChatAt: number;
      navigationParams: AgentPageParams;
      workspaceBootstrap: AgentChatWorkspaceBootstrap;
    };

export function resolveHomeShellWorkspaceEntry(
  input: ResolveHomeShellWorkspaceEntryInput,
): ResolvedHomeShellWorkspaceEntry {
  const {
    projectId,
    activeTheme,
    creationMode,
    defaultToolPreferences,
    payload,
    now = () => Date.now(),
  } = input;

  const hasPrompt = Boolean(payload.prompt?.trim());
  const hasImages = Boolean(payload.images?.length);
  const toolPreferences = payload.toolPreferences ?? defaultToolPreferences;
  const targetTheme = payload.themeOverride ?? activeTheme;
  const openBrowserAssistOnMount = payload.openBrowserAssistOnMount;

  if (!openBrowserAssistOnMount && !projectId) {
    return {
      ok: false,
      reason: "missing_project",
    };
  }

  if (!openBrowserAssistOnMount && !hasPrompt && !hasImages) {
    return {
      ok: false,
      reason: "empty_payload",
    };
  }

  const nextNewChatAt = now();
  const shared = {
    projectId: projectId ?? undefined,
    theme: targetTheme,
    initialCreationMode: creationMode,
    initialUserPrompt: payload.prompt,
    initialUserImages: payload.images,
    openBrowserAssistOnMount,
    newChatAt: nextNewChatAt,
  } satisfies AgentPageParams;

  return {
    ok: true,
    toolPreferences,
    targetTheme,
    nextNewChatAt,
    navigationParams: buildClawAgentParams(shared),
    workspaceBootstrap: {
      projectId: projectId ?? undefined,
      initialUserPrompt: payload.prompt,
      initialUserImages: payload.images,
      theme: targetTheme,
      initialCreationMode: creationMode,
      openBrowserAssistOnMount,
      newChatAt: nextNewChatAt,
    },
  };
}
