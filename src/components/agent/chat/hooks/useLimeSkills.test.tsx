import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLimeSkills } from "./useLimeSkills";

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
  getValue: () => ReturnType<typeof useLimeSkills>;
  unmount: () => void;
}

function mountHook(
  options: Parameters<typeof useLimeSkills>[0] = {
    autoLoad: "deferred",
  },
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useLimeSkills> | null = null;

  function TestComponent() {
    hookValue = useLimeSkills(options);
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

describe("useLimeSkills", () => {
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

  it("deferred 模式应在 idle/fallback 阶段加载本地 skills", async () => {
    const harness = mountHook({ autoLoad: "deferred", logScope: "TestScope" });

    try {
      act(() => {
        vi.advanceTimersByTime(200);
      });
      await flushEffects();

      expect(mockGetLocal).toHaveBeenCalledWith("lime");
      expect(harness.getValue().skills[0]?.key).toBe("local-skill");
      expect(mockLogAgentDebug).toHaveBeenCalledWith(
        "TestScope",
        "loadSkills.start",
        { includeRemote: false },
      );
    } finally {
      harness.unmount();
    }
  });

  it("immediate 模式应立即加载，并支持手动刷新远端", async () => {
    const harness = mountHook({ autoLoad: "immediate" });

    try {
      await flushEffects();

      expect(mockGetLocal).toHaveBeenCalledWith("lime");

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
