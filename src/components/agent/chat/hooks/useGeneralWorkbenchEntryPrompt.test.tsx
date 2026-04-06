import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralWorkbenchRunState as BackendGeneralWorkbenchRunState } from "@/lib/api/executionRun";
import {
  useGeneralWorkbenchEntryPrompt,
  type GeneralWorkbenchResumeWorkflowState,
} from "./useGeneralWorkbenchEntryPrompt";

interface HookHarness {
  getValue: () => ReturnType<typeof useGeneralWorkbenchEntryPrompt>;
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
  shouldUseCompactGeneralWorkbench: boolean;
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
    async (
      _contentId: string,
    ): Promise<GeneralWorkbenchResumeWorkflowState | null> => null,
  );
  const loadRunState = vi.fn(
    async (_sessionId: string): Promise<BackendGeneralWorkbenchRunState | null> =>
      null,
  );

  let hookValue: ReturnType<typeof useGeneralWorkbenchEntryPrompt> | null = null;
  let currentProps: HookProps = {
    activeTheme: "general",
    contentId: "content-1",
    sessionId: "session-1",
    isThemeWorkbench: true,
    autoRunInitialPromptOnMount: false,
    shouldUseCompactGeneralWorkbench: false,
    messagesCount: 0,
    initialDispatchKey: null,
    initialUserPrompt: "",
    initialUserImages: [],
    consumedInitialPromptKey: null,
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useGeneralWorkbenchEntryPrompt({
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

describe("useGeneralWorkbenchEntryPrompt", () => {
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
      initialUserPrompt: "请先生成内容主稿",
    });

    try {
      await flushEffects();
      expect(harness.onHydrateInitialPrompt).toHaveBeenCalledWith(
        "请先生成内容主稿",
        "initial-dispatch",
      );
      expect(harness.getValue().generalWorkbenchEntryPrompt).toMatchObject({
        kind: "initial_prompt",
        prompt: "请先生成内容主稿",
      });
    } finally {
      harness.unmount();
    }
  });

  it("启用自动执行时不应进入预填提示态", async () => {
    const harness = mountHook({
      initialDispatchKey: "initial-dispatch",
      initialUserPrompt: "请先生成内容主稿",
      autoRunInitialPromptOnMount: true,
    });

    try {
      await flushEffects();
      expect(harness.onHydrateInitialPrompt).not.toHaveBeenCalled();
      expect(harness.getValue().generalWorkbenchEntryPrompt).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("无初始意图时应基于 run-state 生成 resume prompt", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onHydrateInitialPrompt = vi.fn();
    const loadRunState = vi.fn(
      async (_sessionId: string): Promise<BackendGeneralWorkbenchRunState | null> => ({
        run_state: "auto_running",
        current_gate_key: "write_mode",
        queue_items: [
          {
            run_id: "run-1",
            title: "撰写主稿",
            gate_key: "write_mode",
            status: "running",
            source: "skill",
            source_ref: null,
            started_at: new Date().toISOString(),
          },
        ],
        latest_terminal: null,
        recent_terminals: [],
        updated_at: new Date().toISOString(),
      }),
    );
    const hookValueRef: {
      current: ReturnType<typeof useGeneralWorkbenchEntryPrompt> | null;
    } = { current: null };

    function TestComponent() {
      hookValueRef.current = useGeneralWorkbenchEntryPrompt({
        activeTheme: "general",
        contentId: "content-1",
        sessionId: "session-1",
        isThemeWorkbench: true,
        autoRunInitialPromptOnMount: false,
        shouldUseCompactGeneralWorkbench: false,
        messagesCount: 0,
        initialDispatchKey: null,
        initialUserPrompt: "",
        initialUserImages: [],
        consumedInitialPromptKey: null,
        onHydrateInitialPrompt,
        loadRunState,
      });
      return null;
    }

    act(() => {
      root.render(<TestComponent />);
    });

    try {
      await flushEffects();
      expect(loadRunState).toHaveBeenCalledWith("session-1");
      expect(hookValueRef.current?.generalWorkbenchEntryPrompt).toMatchObject({
        kind: "resume",
        title: "发现上次未完成任务",
        description: expect.stringContaining("撰写主稿"),
      });
      expect(hookValueRef.current?.generalWorkbenchEntryCheckPending).toBe(false);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
