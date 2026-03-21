import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  const loadWorkflow = vi.fn(async () => null);
  const loadRunState = vi.fn(async () => null);

  let hookValue: ReturnType<typeof useThemeWorkbenchEntryPrompt> | null = null;
  let currentProps: HookProps = {
    activeTheme: "social-media",
    contentId: "content-1",
    sessionId: "session-1",
    isThemeWorkbench: true,
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

  it("无初始意图时应查询 resume prompt", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onHydrateInitialPrompt = vi.fn();
    const loadWorkflow = vi.fn(async () => ({
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
          title: "撰写主稿",
          status: "completed",
        },
        {
          id: "step-2",
          title: "润色结尾",
          status: "pending",
        },
      ],
    }));
    const loadRunState = vi.fn(async () => null);
    let hookValue: ReturnType<typeof useThemeWorkbenchEntryPrompt> | null = null;

    function TestComponent() {
      hookValue = useThemeWorkbenchEntryPrompt({
        activeTheme: "social-media",
        contentId: "content-1",
        sessionId: "session-1",
        isThemeWorkbench: true,
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
      expect(hookValue?.themeWorkbenchEntryPrompt).toMatchObject({
        kind: "resume",
        title: "发现上次未完成任务",
      });
      expect(hookValue?.themeWorkbenchEntryCheckPending).toBe(false);
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
