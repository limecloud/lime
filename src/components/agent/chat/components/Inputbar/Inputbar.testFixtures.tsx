import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StyleSheetManager } from "styled-components";
import { createTestStyleSheet } from "@/test/createTestStyleSheet";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { Inputbar } from "./index";
import { changeLimeLocale } from "@/i18n/createI18n";

import type { Skill } from "@/lib/api/skills";

import type { InputbarSendPayload } from "./inputbarSendPayload";

import { ComposerController } from "@/components/input-kit";

import { stubSuggestionGeometry } from "./components/contextualSuggestions.testFixtures";

export const mockInputbarCore =
  vi.fn<
    (
      props: React.ComponentProps<
        typeof import("./components/InputbarCore").InputbarCore
      >,
    ) => void
  >();
vi.mock("./components/InputbarCore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./components/InputbarCore")>();
  return {
    InputbarCore: (props: React.ComponentProps<typeof actual.InputbarCore>) => {
      mockInputbarCore(props);
      return <actual.InputbarCore {...props} />;
    },
  };
});
vi.mock("../ThreadGoalPanel", () => ({
  ThreadGoalPanel: (props: {
    threadId?: string | null;
    threadGoal?: { objective: string } | null;
    runtimeBusy?: boolean;
    onEdit?: () => void;
  }) => (
    <div
      data-testid="thread-goal-inline-panel"
      data-thread-id={props.threadId ?? ""}
      data-objective={props.threadGoal?.objective ?? ""}
      data-runtime-busy={String(Boolean(props.runtimeBusy))}
      data-variant="inline"
    >
      {props.onEdit ? (
        <button data-testid="thread-goal-edit" onClick={props.onEdit}>
          Edit goal
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("../ChatModelSelector", () => ({
  ChatModelSelector: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" data-testid="model-selector" disabled={disabled} />
  ),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(async () => []),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/input-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/input-kit")>()),
  createAgentInputAdapter: (options: {
    text: string;
    setText: (value: string) => void;
    isSending: boolean;
    disabled?: boolean;
    attachments?: unknown[];
    providerType: string;
    model: string;
    setProviderType: (providerType: string) => void;
    setModel: (model: string) => void;
    stop?: () => void;
  }) => ({
    state: {
      text: options.text,
      isSending: options.isSending,
      disabled: options.disabled,
      attachments: options.attachments,
    },
    model: {
      providerType: options.providerType,
      model: options.model,
    },
    actions: {
      setText: options.setText,
      send: vi.fn(),
      stop: options.stop,
      setProviderType: options.setProviderType,
      setModel: options.setModel,
    },
    ui: {
      showModelSelector: true,
      showToolBar: true,
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

export const mountedRoots: Array<{
  root: Root;
  container: HTMLDivElement;
  styleTarget?: HTMLDivElement;
}> = [];

beforeEach(async () => {
  stubSuggestionGeometry();
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  await changeLimeLocale("zh-CN");
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted.styleTarget?.remove();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

export function renderInputbar(
  props?: Partial<React.ComponentProps<typeof Inputbar>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const styleTarget = document.createElement("div");
  document.head.appendChild(styleTarget);
  const sheet = createTestStyleSheet(styleTarget);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof Inputbar> = {
    input: "",
    setInput: vi.fn(),
    onSend: vi.fn(),
    isLoading: false,
    characters: [],
    skills: [],
  };

  const render = (
    nextProps?: Partial<React.ComponentProps<typeof Inputbar>>,
  ) => {
    act(() => {
      root.render(
        <StyleSheetManager sheet={sheet}>
          <Inputbar {...defaultProps} {...props} {...nextProps} />
        </StyleSheetManager>,
      );
    });
  };

  render();

  mountedRoots.push({ root, container, styleTarget });
  return {
    container,
    rerender: render,
  };
}

export function expectInputbarSend(
  onSend: ReturnType<typeof vi.fn>,
  payload: Pick<
    InputbarSendPayload,
    "images" | "textOverride" | "sendOptions"
  > = {},
) {
  const actual = onSend.mock.calls.at(-1)?.[0] as
    | InputbarSendPayload
    | undefined;
  expect(actual).toBeTruthy();
  expect(actual?.images).toEqual(payload.images);
  expect(actual?.textOverride).toEqual(payload.textOverride);
  if (payload.sendOptions) {
    expect(actual?.sendOptions).toMatchObject(payload.sendOptions);
    return;
  }
  expect(actual?.sendOptions).toBe(payload.sendOptions);
}

export function openContextSuggestions(container: HTMLDivElement) {
  const toggleButton = container.querySelector(
    '[data-testid="inputbar-plus-trigger"]',
  ) as HTMLButtonElement | null;

  expect(toggleButton).toBeTruthy();

  act(() => {
    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  return toggleButton;
}

export function dispatchInputbarDrop(
  container: HTMLDivElement,
  dataTransfer: {
    files: File[];
    getData: (format: string) => string;
  },
): Event {
  const surface = container.firstElementChild;
  expect(surface).toBeTruthy();

  const event = new Event("drop", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer,
  });

  act(() => {
    surface?.dispatchEvent(event);
  });
  return event;
}

export function createRichSkillRestoreDraft(
  skill: Skill,
  pathReference: {
    id: string;
    path: string;
    name: string;
    isDir: boolean;
    source: "file_manager";
  },
) {
  const images = [{ data: "image-data", mediaType: "image/png" }];
  const label = `$${skill.name}`;
  const controller = new ComposerController({
    text: `${label} 继续生成提纲`,
    mentionBindings: [
      {
        id: skill.key,
        kind: "skill",
        name: skill.name,
        path: "draft/SKILL.md",
        label,
        from: 0,
        to: label.length,
      },
    ],
    attachments: images,
    pathReferences: [pathReference],
  });
  return { ...controller.captureDraft(), images };
}
