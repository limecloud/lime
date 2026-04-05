import type { ChatInputAdapter } from "./types";
import type { ComposerAttachment } from "../types";

interface CreateAgentInputAdapterOptions {
  text: string;
  setText: (value: string) => void;
  isSending: boolean;
  disabled?: boolean;
  providerType: string;
  model: string;
  setProviderType: (providerType: string) => void;
  setModel: (model: string) => void;
  send: (options?: { textOverride?: string }) => void;
  stop?: () => void;
  attachments?: ComposerAttachment[];
}

export const createAgentInputAdapter = (
  options: CreateAgentInputAdapterOptions,
): ChatInputAdapter => {
  const {
    text,
    setText,
    isSending,
    disabled,
    providerType,
    model,
    setProviderType,
    setModel,
    send,
    stop,
    attachments,
  } = options;

  return {
    state: {
      text,
      isSending,
      disabled,
      attachments,
    },
    model: {
      providerType,
      model,
    },
    actions: {
      setText,
      send,
      stop,
      setProviderType,
      setModel,
    },
    ui: {
      showModelSelector: true,
      showToolBar: true,
    },
  };
};
