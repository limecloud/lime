import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeShellProjectMemory } from "./useHomeShellProjectMemory";

const mockGetProjectMemory = vi.hoisted(() => vi.fn());
const mockLogAgentDebug = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/memory", () => ({
  getProjectMemory: mockGetProjectMemory,
}));

vi.mock("@/lib/agentDebug", () => ({
  logAgentDebug: mockLogAgentDebug,
}));

interface HookHarness {
  getValue: () => ReturnType<typeof useHomeShellProjectMemory>;
  rerender: (projectId?: string | null) => void;
  unmount: () => void;
}

function mountHook(initialProjectId?: string | null): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useHomeShellProjectMemory> | null = null;

  function TestComponent({ projectId }: { projectId?: string | null }) {
    hookValue = useHomeShellProjectMemory(projectId);
    return null;
  }

  const render = (projectId?: string | null) => {
    act(() => {
      root.render(<TestComponent projectId={projectId} />);
    });
  };

  render(initialProjectId);

  return {
    getValue: () => hookValue,
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushEffects(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("useHomeShellProjectMemory", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mockGetProjectMemory.mockResolvedValue({
      characters: [{ id: "char-1", name: "主角" }],
      outline: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("无项目时应直接返回空记忆且不触发加载", async () => {
    const harness = mountHook();

    try {
      await flushEffects();
      expect(harness.getValue()).toBeNull();
      expect(mockGetProjectMemory).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("切换项目时应加载对应项目记忆", async () => {
    const harness = mountHook("project-memory-a");

    try {
      await flushEffects();
      expect(mockGetProjectMemory).toHaveBeenCalledWith("project-memory-a");
      expect(harness.getValue()?.characters[0]?.name).toBe("主角");

      mockGetProjectMemory.mockResolvedValueOnce({
        characters: [{ id: "char-2", name: "配角" }],
        outline: [],
      });

      harness.rerender("project-memory-b");
      await flushEffects();

      expect(mockGetProjectMemory).toHaveBeenLastCalledWith("project-memory-b");
      expect(harness.getValue()?.characters[0]?.name).toBe("配角");
    } finally {
      harness.unmount();
    }
  });
});
