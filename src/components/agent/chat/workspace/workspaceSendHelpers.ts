import { preheatBrowserAssistInBackground } from "../utils/browserAssistPreheat";
import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
} from "../utils/harnessRequestMetadata";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { MessageImage } from "../types";
import type { Character } from "@/lib/api/memory";
import type { ThemeType } from "@/components/content-creator/types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";
import type { UseRuntimeTeamFormationResult } from "../hooks/useRuntimeTeamFormation";
import type { AgentAccessMode } from "../hooks/agentChatStorage";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";

type PreparedRuntimeTeamState = NonNullable<
  Awaited<ReturnType<UseRuntimeTeamFormationResult["prepareRuntimeTeamBeforeSend"]>>
>;

export interface ContextWorkspaceSummary {
  enabled: boolean;
  activeContextPrompt: string;
  prepareActiveContextPrompt: () => Promise<string>;
}

export interface EnsureBrowserAssistCanvasOptions {
  silent?: boolean;
  navigationMode?: "none" | "explicit-url" | "best-effort";
}

interface BuildWorkspaceSendTextOptions {
  sourceText: string;
  contextWorkspace: ContextWorkspaceSummary;
  mentionedCharacters: Character[];
  runtimeStyleMessagePrompt: string;
  sendOptions?: HandleSendOptions;
}

interface PrimeBrowserAssistBeforeSendOptions {
  activeTheme: string;
  sourceText: string;
  browserRequirementMatch?: {
    requirement: "optional" | "required" | "required_with_user_step";
    reason: string;
    launchUrl: string;
  } | null;
  ensureBrowserAssistCanvas: (
    target: string,
    options?: EnsureBrowserAssistCanvasOptions,
  ) => Promise<boolean>;
}

interface BuildWorkspaceRequestMetadataOptions {
  workspaceRequestMetadataBase?: Record<string, unknown>;
  sendOptions?: HandleSendOptions;
  effectiveToolPreferences: ChatToolPreferences;
  accessMode?: AgentAccessMode;
  mappedTheme: ThemeType;
  isThemeWorkbench: boolean;
  currentGateKey: string;
  themeWorkbenchActiveQueueTitle?: string;
  contentId?: string | null;
  browserRequirementMatch?: {
    requirement: "optional" | "required" | "required_with_user_step";
    reason: string;
    launchUrl: string;
  } | null;
  browserAssistProfileKey?: string | null;
  browserAssistPreferredBackend?:
    | "aster_compat"
    | "lime_extension_bridge"
    | "cdp_direct"
    | null;
  browserAssistAutoLaunch?: boolean | null;
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string;
  selectedTeamSummary?: string;
}

function applyActiveContextPrompt(
  text: string,
  activeContextPrompt: string,
): string {
  if (!activeContextPrompt.trim()) {
    return text;
  }

  const slashCommandMatch = text.match(/^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/);
  if (slashCommandMatch) {
    const [, skillName, skillArgs] = slashCommandMatch;
    const mergedArgs = [activeContextPrompt, skillArgs.trim()]
      .filter((part) => part.length > 0)
      .join("\n\n");
    return `/${skillName} ${mergedArgs}`.trim();
  }

  return `${activeContextPrompt}\n\n${text}`;
}

function applyMentionedCharacterContext(
  text: string,
  mentionedCharacters: Character[],
): string {
  if (mentionedCharacters.length === 0) {
    return text;
  }

  const characterContext = mentionedCharacters
    .map((char) => {
      let context = `角色：${char.name}`;
      if (char.description) context += `\n简介：${char.description}`;
      if (char.personality) context += `\n性格：${char.personality}`;
      if (char.background) context += `\n背景：${char.background}`;
      return context;
    })
    .join("\n\n");

  return `[角色上下文]\n${characterContext}\n\n[用户输入]\n${text}`;
}

function applyRuntimeStyleMessagePrompt(
  text: string,
  runtimeStyleMessagePrompt: string,
  sendOptions?: HandleSendOptions,
): string {
  if (sendOptions?.purpose || !runtimeStyleMessagePrompt.trim()) {
    return text;
  }

  return `[本次任务风格要求]\n${runtimeStyleMessagePrompt}\n\n[用户输入]\n${text}`;
}

export async function buildWorkspaceSendText(
  options: BuildWorkspaceSendTextOptions,
): Promise<string> {
  const {
    sourceText,
    contextWorkspace,
    mentionedCharacters,
    runtimeStyleMessagePrompt,
    sendOptions,
  } = options;

  let text = sourceText;
  let preparedActiveContextPrompt = contextWorkspace.enabled
    ? contextWorkspace.activeContextPrompt.trim()
    : "";
  if (!preparedActiveContextPrompt && contextWorkspace.enabled) {
    preparedActiveContextPrompt =
      (await contextWorkspace.prepareActiveContextPrompt()).trim();
  } else if (preparedActiveContextPrompt) {
    // 发送路径优先使用现成上下文快照，后台继续补齐正文缓存以优化后续轮次。
    void contextWorkspace.prepareActiveContextPrompt().catch(() => undefined);
  }

  if (preparedActiveContextPrompt) {
    text = applyActiveContextPrompt(text, preparedActiveContextPrompt);
  }

  text = applyMentionedCharacterContext(text, mentionedCharacters);
  return applyRuntimeStyleMessagePrompt(
    text,
    runtimeStyleMessagePrompt,
    sendOptions,
  );
}

export function primeBrowserAssistBeforeSend(
  options: PrimeBrowserAssistBeforeSendOptions,
): void {
  const {
    activeTheme,
    sourceText,
    browserRequirementMatch,
    ensureBrowserAssistCanvas,
  } = options;

  if (browserRequirementMatch) {
    void ensureBrowserAssistCanvas(
      browserRequirementMatch.launchUrl || sourceText,
      {
        silent: true,
        navigationMode:
          browserRequirementMatch.launchUrl &&
          browserRequirementMatch.launchUrl !== sourceText
            ? "explicit-url"
            : "best-effort",
      },
    ).catch((error) => {
      console.warn(
        "[AgentChatPage] 强浏览器任务发送前准备浏览器失败，继续由主流程处理:",
        error,
      );
    });
    return;
  }

  preheatBrowserAssistInBackground({
    activeTheme,
    sourceText,
    ensureBrowserAssistCanvas,
    onError: (error) => {
      console.warn(
        "[AgentChatPage] 发送前预热浏览器协助失败，继续发送消息:",
        error,
      );
    },
  });
}

export function buildWorkspaceRequestMetadata(
  options: BuildWorkspaceRequestMetadataOptions,
): Record<string, unknown> {
  const {
    workspaceRequestMetadataBase,
    sendOptions,
    effectiveToolPreferences,
    accessMode,
    mappedTheme,
    isThemeWorkbench,
    currentGateKey,
    themeWorkbenchActiveQueueTitle,
    contentId,
    browserRequirementMatch,
    browserAssistProfileKey,
    browserAssistPreferredBackend,
    browserAssistAutoLaunch,
    preferredTeamPresetId,
    selectedTeam,
    selectedTeamLabel,
    selectedTeamSummary,
  } = options;

  const existingHarnessMetadata = extractExistingHarnessMetadata({
    ...(workspaceRequestMetadataBase || {}),
    ...(sendOptions?.requestMetadata || {}),
  });

  return {
    ...(workspaceRequestMetadataBase || {}),
    ...(sendOptions?.requestMetadata || {}),
    harness: buildHarnessRequestMetadata({
      base: existingHarnessMetadata,
      theme: mappedTheme,
      turnPurpose: sendOptions?.purpose,
      preferences: {
        webSearch: effectiveToolPreferences.webSearch,
        thinking: effectiveToolPreferences.thinking,
        task: effectiveToolPreferences.task,
        subagent: effectiveToolPreferences.subagent,
      },
      accessMode,
      sessionMode: isThemeWorkbench ? "theme_workbench" : "default",
      gateKey: isThemeWorkbench ? currentGateKey : undefined,
      runTitle: themeWorkbenchActiveQueueTitle?.trim() || undefined,
      contentId: contentId || undefined,
      browserRequirement: browserRequirementMatch?.requirement,
      browserRequirementReason: browserRequirementMatch?.reason,
      browserLaunchUrl: browserRequirementMatch?.launchUrl,
      browserAssistProfileKey:
        mappedTheme === "general"
          ? browserAssistProfileKey || GENERAL_BROWSER_ASSIST_PROFILE_KEY
          : undefined,
      browserAssistPreferredBackend,
      browserAssistAutoLaunch,
      preferredTeamPresetId,
      selectedTeamId: selectedTeam?.id,
      selectedTeamSource: selectedTeam?.source,
      selectedTeamLabel,
      selectedTeamDescription: selectedTeam?.description,
      selectedTeamSummary,
      selectedTeamRoles: selectedTeam?.roles,
    }),
  };
}

export function buildRuntimeTeamDispatchPreview(
  preparedRuntimeTeamState: PreparedRuntimeTeamState,
  sourceText: string,
  images: MessageImage[],
  messagesCount: number,
): RuntimeTeamDispatchPreviewSnapshot {
  return {
    key: preparedRuntimeTeamState.requestId,
    prompt: sourceText,
    images,
    baseMessageCount: messagesCount,
    status: preparedRuntimeTeamState.status,
    formationState: preparedRuntimeTeamState,
    failureMessage: preparedRuntimeTeamState.errorMessage?.trim() || null,
  };
}
