import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateContent } = vi.hoisted(() => ({
  mockUpdateContent: vi.fn(),
}));

vi.mock("@/lib/api/project", () => ({
  updateContent: mockUpdateContent,
}));

import { useContentSync } from "./useContentSync";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

interface HookHarness {
  getValue: () => ReturnType<typeof useContentSync>;
  unmount: () => void;
}

function mountHook(
  options?: Parameters<typeof useContentSync>[0],
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useContentSync> | null = null;

  function TestComponent() {
    hookValue = useContentSync(options);
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

describe("useContentSync", () => {
  let harness: HookHarness | null = null;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mockUpdateContent.mockReset();
    mockUpdateContent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("相同内容在防抖期间不应重复推迟同步", async () => {
    harness = mountHook({ debounceMs: 2000, autoRetry: false });

    act(() => {
      harness?.getValue().syncContent("content-1", "hello world");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    act(() => {
      harness?.getValue().syncContent("content-1", "hello world");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(mockUpdateContent).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockUpdateContent).toHaveBeenCalledTimes(1);
    expect(mockUpdateContent).toHaveBeenCalledWith("content-1", {
      body: "hello world",
    });
  });

  it("卸载时应清理待执行的同步定时器", async () => {
    harness = mountHook({ debounceMs: 2000, autoRetry: false });

    act(() => {
      harness?.getValue().syncContent("content-1", "hello world");
    });

    harness.unmount();
    harness = null;

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockUpdateContent).not.toHaveBeenCalled();
  });
});
