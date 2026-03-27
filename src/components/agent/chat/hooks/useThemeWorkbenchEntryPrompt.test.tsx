import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowState as ContentWorkflowState } from "@/lib/api/content-workflow";
import type { ThemeWorkbenchRunState as BackendThemeWorkbenchRunState } from "@/lib/api/executionRun";
import { useThemeWorkbenchEntryPrompt } from "./useThemeWorkbenchEntryPrompt";

interface HookHarness {
  getValue: () => ReturnType<typeof useThemeWorkbenchEntryPrompt>;
  rerender: (props?: Partial<HookProps>) => void;
  unmount: () => void;
  onHydrateInitialPrompt: ReturnType<typeof vi.fn>;
}

interface HookProps {
  activeTheme: string;
  contentId?: string;
  sessionId?: string;
  isThemeWorkbench: boolean;
  autoRunInitialPromptOnMount: boolean;
  shouldUseCompactThemeWorkbench: boolean;
  messagesCount: number;
  initialDispatchKey: string | null;
  initialUserPrompt?: string;
  initialUserImages?: Array<{ data: string; mediaType: string }>;
  consumedInitialPromptKey?: string | null;
}

function mountHook(initialProps?: Partial<HookProps>): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onHydrateInitialPrompt = vi.fn();

  const loadWorkflow = vi.fn(
    async (_contentId: string): Promise<ContentWorkflowState | null> => null,
  );
  const loadRunState = vi.fn(
    async (_sessionId: string): Promise<BackendThemeWorkbenchRunState | null> =>
      null,
  );

  let hookValue: ReturnType<typeof useThemeWorkbenchEntryPrompt> | null = null;
  let currentProps: HookProps = {
    activeTheme: "social-media",
    contentId: "content-1",
    sessionId: "session-1",
    isThemeWorkbench: true,
    autoRunInitialPromptOnMount: false,
    shouldUseCompactThemeWorkbench: false,
    messagesCount: 0,
    initialDispatchKey: null,
    initialUserPrompt: "",
    initialUserImages: [],
    consumedInitialPromptKey: null,
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useThemeWorkbenchEntryPrompt({
      ...currentProps,
      onHydrateInitialPrompt,
      loadWorkflow,
      loadRunState,
    });
    return null;
  }

  const render = (nextProps?: Partial<HookProps>) => {
    currentProps = {
      ...currentProps,
      ...nextProps,
    };
    act(() => {
      root.render(<TestComponent />);
    });
  };

  render();

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    onHydrateInitialPrompt,
  };
}

async function flushEffects(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("useThemeWorkbenchEntryPrompt", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("主题工作台初始意图应先进入预填提示态", async () => {
    const harness = mountHook({
      initialDispatchKey: "initial-dispatch",
      initialUserPrompt: "请先生成社媒主稿",
    });

    try {
      await flushEffects();
      expect(harness.onHydrateInitialPrompt).toHaveBeenCalledWith(
        "请先生成社媒主稿",
        "initial-dispatch",
      );
      expect(harness.getValue().themeWorkbenchEntryPrompt).toMatchObject({
        kind: "initial_prompt",
        prompt: "请先生成社媒主稿",
      });
    } finally {
      harness.unmount();
    }
  });

  it("启用自动执行时不应进入预填提示态", async () => {
    const harness = mountHook({
      initialDispatchKey: "initial-dispatch",
      initialUserPrompt: "请先生成社媒主稿",
      autoRunInitialPromptOnMount: true,
    });

    try {
      await flushEffects();
      expect(harness.onHydrateInitialPrompt).not.toHaveBeenCalled();
      expect(harness.getValue().themeWorkbenchEntryPrompt).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("无初始意图时应查询 resume prompt", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onHydrateInitialPrompt = vi.fn();
    const loadWorkflow = vi.fn(
      async (_contentId: string): Promise<ContentWorkflowState | null> => ({
        id: "wf-1",
        content_id: "content-1",
        theme: "social-media",
        mode: "guided",
        current_step_index: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
        steps: [
          {
            id: "step-1",
            type: "write",
            title: "撰写主稿",
            behavior: {
              skippable: false,
              redoable: true,
              auto_advance: false,
            },
            status: "completed",
          },
          {
            id: "step-2",
            type: "polish",
            title: "润色结尾",
            behavior: {
              skippable: false,
              redoable: true,
              auto_advance: false,
            },
            status: "pending",
          },
        ],
      }),
    );
    const loadRunState = vi.fn(
      async (_sessionId: string): Promise<BackendThemeWorkbenchRunState | null> =>
        null,
    );
    const hookValueRef: {
      current: ReturnType<typeof useThemeWorkbenchEntryPrompt> | null;
    } = { current: null };

    function TestComponent() {
      hookValueRef.current = useThemeWorkbenchEntryPrompt({
        activeTheme: "social-media",
        contentId: "content-1",
        sessionId: "session-1",
        isThemeWorkbench: true,
        autoRunInitialPromptOnMount: false,
        shouldUseCompactThemeWorkbench: false,
        messagesCount: 0,
        initialDispatchKey: null,
        initialUserPrompt: "",
        initialUserImages: [],
        consumedInitialPromptKey: null,
        onHydrateInitialPrompt,
        loadWorkflow,
        loadRunState,
      });
      return null;
    }

    act(() => {
      root.render(<TestComponent />);
    });

    try {
      await flushEffects();
      expect(loadWorkflow).toHaveBeenCalledWith("content-1");
      expect(hookValueRef.current?.themeWorkbenchEntryPrompt).toMatchObject({
        kind: "resume",
        title: "发现上次未完成任务",
      });
      expect(hookValueRef.current?.themeWorkbenchEntryCheckPending).toBe(false);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
