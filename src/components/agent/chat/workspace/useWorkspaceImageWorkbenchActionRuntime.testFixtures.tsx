import { createRuntimeAcceptanceReceipt } from "@/lib/api/agentRuntime/runtimeAcceptance";
import { fromRuntimeAcceptanceReceipt } from "../hooks/agentSendResult";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { createInitialSessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import { useWorkspaceImageWorkbenchActionRuntime } from "./useWorkspaceImageWorkbenchActionRuntime";
import { useWorkspaceImageWorkbenchCommandActionRuntime } from "./useWorkspaceImageWorkbenchCommandActionRuntime";

const toastHoisted = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));
const titleHoisted = vi.hoisted(() => ({
  mockGenerateAgentRuntimeTitle: vi.fn(),
}));

export const toast = toastHoisted.toast;
export const mockGenerateAgentRuntimeTitle =
  titleHoisted.mockGenerateAgentRuntimeTitle;

vi.mock("sonner", () => ({
  toast: toastHoisted.toast,
}));

vi.mock("@/lib/api/agentRuntime/agentClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/agentRuntime/agentClient")>();

  return {
    ...actual,
    generateAgentRuntimeTitleResult: (...args: unknown[]) =>
      titleHoisted.mockGenerateAgentRuntimeTitle(...args),
  };
});

export type HookProps = Parameters<
  typeof useWorkspaceImageWorkbenchActionRuntime
>[0];
export type CommandActionHookProps = Parameters<
  typeof useWorkspaceImageWorkbenchCommandActionRuntime
>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

export function createParsedCommand() {
  return {
    rawText: "@配图 生成 城市夜景主视觉",
    commandKey: "image_generate",
    trigger: "@配图" as const,
    body: "生成 城市夜景主视觉",
    mode: "generate" as const,
    prompt: "城市夜景主视觉",
    count: 1,
    size: "1024x1024",
    aspectRatio: undefined,
    targetRef: undefined,
  };
}

export function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<
    typeof useWorkspaceImageWorkbenchActionRuntime
  > | null = null;

  const defaultProps: HookProps = {
    cancelImageTask: vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
      status: "cancelled",
    }),
    contentId: null,
    createImageGenerationTask: vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
    }),
    getImageTask: vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
      task_family: "image",
      status: "cancelled",
      normalized_status: "cancelled",
      path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      artifact_path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_artifact_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      reused_existing: false,
      record: {
        task_id: "task-image-1",
        task_type: "image_generate",
        task_family: "image",
        relationships: {
          slot_id: "document-slot-inline-retry",
        },
        payload: {
          prompt: "城市夜景主视觉",
          mode: "generate",
          raw_text: "@配图 生成 城市夜景主视觉",
          size: "1024x1024",
          count: 1,
          usage: "claw-image-workbench",
          provider_id: "fal",
          model: "fal-ai/nano-banana-pro",
          session_id: "session-1",
          project_id: "project-1",
          entry_source: "at_image_command",
          requested_target: "generate",
          anchor_hint: "section_end",
          anchor_section_title: "技术亮点",
          reference_images: [],
        },
        status: "cancelled",
        normalized_status: "cancelled",
        created_at: "2026-04-04T12:00:00Z",
      },
      success: true,
    }),
    currentImageWorkbenchState: createInitialSessionImageWorkbenchState(),
    imageWorkbenchSelectedModelId: "fal-ai/nano-banana-pro",
    imageWorkbenchSelectedProviderId: "fal",
    imageWorkbenchSelectedSize: "1024x1024",
    imageWorkbenchSessionKey: "session-1",
    projectId: "project-1",
    projectRootPath: "/workspace/project-1",
    setCanvasState: vi.fn(),
    setInput: vi.fn(),
    updateCurrentImageWorkbenchState: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceImageWorkbenchActionRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

export function renderCommandActionHook(
  props?: Partial<CommandActionHookProps>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<
    typeof useWorkspaceImageWorkbenchCommandActionRuntime
  > | null = null;

  const defaultProps: CommandActionHookProps = {
    contentId: null,
    currentImageWorkbenchState: createInitialSessionImageWorkbenchState(),
    imageWorkbenchPreferredModelId: undefined,
    imageWorkbenchPreferredProviderId: undefined,
    imageWorkbenchPreferredProviderUnavailable: false,
    imageWorkbenchSelectedModelId: "fal-ai/nano-banana-pro",
    imageWorkbenchSelectedProviderId: "fal",
    imageWorkbenchSelectedSize: "1024x1024",
    imageWorkbenchSessionKey: "session-1",
    projectId: "project-1",
    projectRootPath: "/workspace/project-1",
    submitImageWorkbenchAgentCommand: vi
      .fn()
      .mockResolvedValue(
        fromRuntimeAcceptanceReceipt(
          createRuntimeAcceptanceReceipt(
            { sessionId: "s", threadId: "t" },
            "start",
            "turn",
          ),
        ),
      ),
  };

  function Probe(currentProps: CommandActionHookProps) {
    latestValue = useWorkspaceImageWorkbenchCommandActionRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<CommandActionHookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");

  mockGenerateAgentRuntimeTitle.mockReset();
  mockGenerateAgentRuntimeTitle.mockResolvedValue({
    title: "城市夜景主视觉",
    sessionId: "title-session-1",
    executionRuntime: {
      route: "auxiliary.generate_title",
      task_profile: {
        task_kind: "artifact",
      },
    },
    usedFallback: false,
    fallbackReason: null,
  });
  toast.error.mockReset();
  toast.info.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  await changeLimeLocale("zh-CN");
});
