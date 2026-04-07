import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";

export type CodexSlashCommandSupport = "supported" | "unsupported";
export type CodexSlashCommandKind = "local_action" | "prompt_action" | "info";

export interface CodexSlashCommandDefinition {
  key: string;
  commandName: string;
  commandPrefix: `/${string}`;
  label: string;
  description: string;
  aliases: string[];
  kind: CodexSlashCommandKind;
  support: CodexSlashCommandSupport;
  argumentHint?: string;
}

export interface ParsedCodexSlashCommand {
  definition: CodexSlashCommandDefinition;
  commandName: string;
  userInput: string;
  rawContent: string;
}

export interface CodexSlashStatusSnapshot {
  sessionId: string | null;
  currentTurnId: string | null;
  providerType: string;
  model: string;
  executionStrategy: AsterExecutionStrategy;
  queuedTurnsCount: number;
  isSending: boolean;
}

export interface ExecuteCodexSlashCommandParams {
  command: ParsedCodexSlashCommand;
  statusSnapshot: CodexSlashStatusSnapshot;
  sendPrompt: (prompt: string) => Promise<void>;
  compactSession: () => Promise<void>;
  clearMessages: (options?: {
    showToast?: boolean;
    toastMessage?: string;
  }) => void;
  createFreshSession: (sessionName?: string) => Promise<string | null>;
  appendAssistantMessage: (content: string) => void;
  notifyInfo: (message: string) => void;
  notifySuccess: (message: string) => void;
  onExecutedCommand?: (command: ParsedCodexSlashCommand) => void;
}
