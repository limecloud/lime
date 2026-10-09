import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import { ReasoningVisibility } from "./ReasoningVisibility";
import { useRawReasoningVisibility } from "./reasoningVisibilityContext";

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: vi.fn(),
  subscribeAppConfigChanged: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

it("默认隐藏，读取共享配置后显示，配置变化与读取失败恢复隐藏", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let changed = () => {};
  const unsubscribe = vi.fn();
  vi.mocked(subscribeAppConfigChanged).mockImplementation((listener) => {
    changed = listener;
    return unsubscribe;
  });
  vi.mocked(getConfig).mockResolvedValue({
    default_provider: "fixture",
    show_raw_agent_reasoning: true,
  } as Awaited<ReturnType<typeof getConfig>>);
  function Consumer() {
    return <span>{String(useRawReasoningVisibility())}</span>;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <ReasoningVisibility>
          <Consumer />
        </ReasoningVisibility>,
      ),
    );
    expect(container.textContent).toBe("false");
    await act(async () => {});
    expect(container.textContent).toBe("true");
    vi.mocked(getConfig).mockResolvedValue({
      default_provider: "fixture",
      show_raw_agent_reasoning: false,
    } as Awaited<ReturnType<typeof getConfig>>);
    await act(async () => changed());
    expect(container.textContent).toBe("false");
    vi.mocked(getConfig).mockResolvedValue({
      default_provider: "fixture",
      show_raw_agent_reasoning: true,
    } as Awaited<ReturnType<typeof getConfig>>);
    await act(async () => changed());
    expect(container.textContent).toBe("true");
    vi.mocked(getConfig).mockRejectedValue(new Error("config unavailable"));
    await act(async () => changed());
    expect(container.textContent).toBe("false");
  } finally {
    act(() => root.unmount());
  }
  expect(unsubscribe).toHaveBeenCalledOnce();
});
