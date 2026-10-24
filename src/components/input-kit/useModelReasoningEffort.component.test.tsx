import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  buildModelReasoningPolicy,
  type KnownModelReasoningEffort,
} from "@/lib/model/modelReasoningPolicy";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { useModelReasoningEffort } from "./useModelReasoningEffort";

const api = vi.hoisted(() => ({ read: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/lib/api/appConfig", () => ({
  getConfig: api.read,
  subscribeAppConfigChanged: api.subscribe,
}));
let root: Root, container: HTMLDivElement, changed: () => void;
const onChange = vi.fn();
let enabled: KnownModelReasoningEffort[],
  current: string,
  model: EnhancedModelMetadata | undefined;
let active: boolean;
let state: ReturnType<typeof useModelReasoningEffort>;
function View() {
  state = useModelReasoningEffort({
    model,
    value: current,
    onChange,
    enabled: active,
  });
  return <div>{state.options.map((option) => option.value).join(",")}</div>;
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  enabled = ["low", "medium", "high", "max", "ultra"];
  current = "ultra";
  active = true;
  model = {
    reasoning_policy: buildModelReasoningPolicy({
      supported_reasoning_levels: ["low", "medium", "high", "max", "ultra"],
      default_reasoning_level: "medium",
    }),
  } as EnhancedModelMetadata;
  api.read.mockImplementation(async () => ({
    desktop: { "enabled-reasoning-efforts": enabled },
  }));
  api.subscribe.mockImplementation((listener) => {
    changed = listener;
    return vi.fn();
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("filters saved choices without changing an existing canonical selection", async () => {
  await act(async () => root.render(<View />));
  expect(container.textContent).toContain("ultra");
  expect(onChange).not.toHaveBeenCalled();
  enabled = ["low", "medium", "high", "max"];
  await act(async () => changed());
  expect(container.textContent).not.toContain("ultra");
  expect(state.selectedOption?.value).toBe("ultra");
  expect(onChange).not.toHaveBeenCalled();
  expect(state.resolve(model, current)).toBe("medium");
});
it("keeps an unselected effort empty for canonical Thread defaults", async () => {
  current = "";
  await act(async () => root.render(<View />));
  expect(onChange).not.toHaveBeenCalled();
  expect(state.selectedOption).toBeUndefined();
  enabled = [];
  await act(async () => changed());
  expect(onChange).not.toHaveBeenCalled();
});
it("displays a confirmed effort before loading optional model metadata", async () => {
  current = "high";
  model = undefined;
  await act(async () => root.render(<View />));
  expect(state.selectedOption?.value).toBe("high");
  expect(state.options).toEqual([]);
  expect(onChange).not.toHaveBeenCalled();
  model = {
    reasoning_policy: buildModelReasoningPolicy({
      supported_reasoning_levels: ["low", "medium", "high"],
      default_reasoning_level: "medium",
    }),
  } as EnhancedModelMetadata;
  await act(async () => root.render(<View />));
  expect(state.selectedOption?.value).toBe("high");
  expect(onChange).not.toHaveBeenCalled();
});
it("retains a supported selection and applies preferences to a model change", async () => {
  current = "high";
  await act(async () => root.render(<View />));
  enabled = [];
  await act(async () => changed());
  expect(onChange).not.toHaveBeenCalled();
  model = {
    reasoning_policy: buildModelReasoningPolicy({
      supported_reasoning_levels: ["low", "max"],
      default_reasoning_level: "max",
    }),
  } as EnhancedModelMetadata;
  await act(async () => root.render(<View />));
  expect(container.textContent).toBe("low");
  expect(onChange).toHaveBeenLastCalledWith("low");
});
it("keeps optional selection while preferences are unavailable", async () => {
  api.read.mockRejectedValue(new Error("unavailable"));
  await act(async () => root.render(<View />));
  expect(onChange).not.toHaveBeenCalled();
});
it("keeps ordinary model-switch fallback when an optional effort remains enabled", async () => {
  await act(async () => root.render(<View />));
  const next = {
    reasoning_policy: buildModelReasoningPolicy({
      supported_reasoning_levels: ["low", "medium", "high"],
      default_reasoning_level: "high",
    }),
  } as EnhancedModelMetadata;
  expect(state.resolve(next, "ultra")).toBe("medium");
});
it("does not let a late initial read overwrite a newer preference event", async () => {
  let finish!: (value: unknown) => void;
  api.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(<View />));
  enabled = [];
  await act(async () => changed());
  expect(container.textContent).not.toContain("ultra");
  await act(async () =>
    finish({ desktop: { "enabled-reasoning-efforts": ["ultra"] } }),
  );
  expect(container.textContent).not.toContain("ultra");
});
