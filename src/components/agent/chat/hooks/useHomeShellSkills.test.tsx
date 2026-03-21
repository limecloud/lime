import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeShellSkills } from "./useHomeShellSkills";

const mockGetLocal = vi.hoisted(() => vi.fn());
const mockGetAll = vi.hoisted(() => vi.fn());
const mockLogAgentDebug = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/skills", () => ({
  skillsApi: {
    getLocal: mockGetLocal,
    getAll: mockGetAll,
  },
}));

vi.mock("@/lib/agentDebug", () => ({
  logAgentDebug: mockLogAgentDebug,
}));

interface HookHarness {
  getValue: () => ReturnType<typeof useHomeShellSkills>;
  unmount: () => void;
}

function mountHook(): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useHomeShellSkills> | null = null;

  function TestComponent() {
    hookValue = useHomeShellSkills();
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useHomeShellSkills", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetLocal.mockResolvedValue([
      {
        key: "local-skill",
        name: "本地技能",
        description: "默认加载",
        directory: "local-skill",
        installed: true,
        sourceKind: "builtin",
      },
    ]);
    mockGetAll.mockResolvedValue([
      {
        key: "remote-skill",
        name: "远端技能",
        description: "刷新加载",
        directory: "remote-skill",
        installed: true,
        sourceKind: "builtin",
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("应在 idle/fallback 阶段加载本地 skills", async () => {
    const harness = mountHook();

    try {
      act(() => {
        vi.advanceTimersByTime(200);
      });
      await flushEffects();

      expect(mockGetLocal).toHaveBeenCalledWith("lime");
      expect(harness.getValue().skills).toHaveLength(1);
      expect(harness.getValue().skills[0]?.key).toBe("local-skill");
      expect(harness.getValue().skillsLoading).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  it("手动刷新时应走远端聚合入口", async () => {
    const harness = mountHook();

    try {
      act(() => {
        vi.advanceTimersByTime(200);
      });
      await flushEffects();

      await act(async () => {
        await harness.getValue().refreshSkills(true);
      });

      expect(mockGetAll).toHaveBeenCalledWith("lime");
      expect(harness.getValue().skills[0]?.key).toBe("remote-skill");
    } finally {
      harness.unmount();
    }
  });
});
