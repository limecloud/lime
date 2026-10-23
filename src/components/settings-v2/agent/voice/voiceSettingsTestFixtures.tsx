import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VoiceSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

export function renderComponent(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<VoiceSettings />);
  });
  mounted.push({ container, root });
  return container;
}

export function cleanupMountedVoiceSettings() {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) {
      break;
    }
    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
}

export async function flushEffects(times = 4) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function createVoiceInputConfig(
  overrides: Record<string, unknown> = {},
) {
  return {
    enabled: true,
    shortcut: "CommandOrControl+Shift+V",
    processor: {
      polish_enabled: true,
      polish_provider: "openai",
      polish_model: "gpt-4.1-mini",
      default_instruction_id: "default",
    },
    output: {
      mode: "type",
      type_delay_ms: 10,
    },
    instructions: [
      {
        id: "default",
        name: "默认润色",
        prompt: "{{text}}",
        is_preset: true,
      },
      {
        id: "translate_en",
        name: "翻译为英文",
        prompt: "{{text}}",
        is_preset: true,
      },
      {
        id: "email",
        name: "邮件格式",
        prompt: "{{text}}",
        is_preset: false,
      },
    ],
    selected_device_id: undefined,
    sound_enabled: true,
    dictation_dictionary: [],
    translate_instruction_id: "translate_en",
    ...overrides,
  };
}
