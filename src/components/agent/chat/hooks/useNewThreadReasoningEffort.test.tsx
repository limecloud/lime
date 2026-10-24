import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentContext } from "./useAgentContext";

const api = vi.hoisted(() => ({ read: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/lib/api/appConfig", () => ({
  getConfigSnapshot: api.read,
  subscribeAppConfigChanged: api.subscribe,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/api/project", () => ({ updateProject: vi.fn() }));
vi.mock("@/components/workspace/services/runtimeAgentsGuideService", () => ({
  notifyProjectRuntimeAgentsGuide: vi.fn(),
}));

let root: Root, container: HTMLDivElement;
let cwd: string | undefined, session: string | null;
let state: ReturnType<typeof useAgentContext>, changed: () => void;
const stop = vi.fn();
const runtime = {
  setSessionExecutionStrategy: vi.fn(async () => {}),
  setSessionProviderSelection: vi.fn(async () => {}),
};
const snapshot = (effort: string | undefined) => ({
  config: { model_reasoning_effort: effort },
});
function deferred() {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  const promise = new Promise<ReturnType<typeof snapshot>>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function View() {
  const sessionIdRef = useRef(session);
  sessionIdRef.current = session;
  state = useAgentContext({
    workspaceId: "workspace",
    workingDir: cwd,
    sessionIdRef,
    topicsUpdaterRef: useRef(null),
    sendMessageRef: useRef(null),
    runtime,
  });
  return <div>{state.reasoningEffort}</div>;
}
async function render() {
  await act(async () => root.render(<View />));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  cwd = undefined;
  session = null;
  api.read.mockResolvedValue(snapshot("high"));
  api.subscribe.mockImplementation((listener) => {
    changed = listener;
    return stop;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("previews User defaults while leaving the first-send override empty", async () => {
  await render();
  expect(api.read).toHaveBeenCalledWith({ cwd: undefined });
  expect(state.reasoningEffort).toBe("high");
  expect(state.reasoningEffortRef.current).toBe("");
  api.read.mockResolvedValue(snapshot("ultra"));
  await act(async () => changed());
  expect(state.reasoningEffort).toBe("ultra");
  expect(state.reasoningEffortRef.current).toBe("");
  expect(runtime.setSessionProviderSelection).not.toHaveBeenCalled();
});

it("keeps an explicit selection when a default arrives later", async () => {
  const pending = deferred();
  api.read.mockReturnValue(pending.promise);
  await render();
  await act(async () => state.setReasoningEffort("low"));
  await act(async () => pending.resolve(snapshot("high")));
  expect(state.reasoningEffort).toBe("low");
  expect(state.reasoningEffortRef.current).toBe("low");
});

it("reads the effective project cwd and hides a previous scope immediately", async () => {
  cwd = "/first";
  await render();
  expect(state.reasoningEffort).toBe("high");
  const pending = deferred();
  api.read.mockReturnValue(pending.promise);
  cwd = "/second";
  await render();
  expect(api.read).toHaveBeenLastCalledWith({ cwd: "/second" });
  expect(state.reasoningEffort).toBe("");
  await act(async () => pending.resolve(snapshot("medium")));
  expect(state.reasoningEffort).toBe("medium");
  expect(state.reasoningEffortRef.current).toBe("");
});

it("ignores a late read from the previous project", async () => {
  const first = deferred();
  api.read.mockReturnValueOnce(first.promise);
  cwd = "/first";
  await render();
  cwd = "/second";
  api.read.mockResolvedValue(snapshot("medium"));
  await render();
  await act(async () => first.resolve(snapshot("ultra")));
  expect(state.reasoningEffort).toBe("medium");
});

it("ignores a late initial read after a newer config event", async () => {
  const pending = deferred();
  api.read.mockReturnValueOnce(pending.promise);
  await render();
  api.read.mockResolvedValue(snapshot("medium"));
  await act(async () => changed());
  await act(async () => pending.resolve(snapshot("ultra")));
  expect(state.reasoningEffort).toBe("medium");
});

it("does not substitute a guessed model default after a failed read", async () => {
  api.read.mockRejectedValue(new Error("unavailable"));
  await render();
  expect(state.reasoningEffort).toBe("");
  expect(state.reasoningEffortRef.current).toBe("");
  api.read.mockResolvedValue(snapshot("high"));
  await act(async () => changed());
  api.read.mockRejectedValue(new Error("unavailable"));
  await act(async () => changed());
  expect(state.reasoningEffort).toBe("high");
  expect(state.reasoningEffortRef.current).toBe("");
});

it("keeps an existing Thread's null or explicit canonical effort", async () => {
  session = "old-thread";
  await render();
  expect(api.read).not.toHaveBeenCalled();
  expect(api.subscribe).not.toHaveBeenCalled();
  expect(state.reasoningEffort).toBe("");
  await act(async () =>
    state.applySessionModelPreference(session!, {
      providerType: "provider",
      model: "model",
      threadSettings: { effort: "ultra" },
    }),
  );
  expect(state.reasoningEffort).toBe("ultra");
  expect(state.reasoningEffortRef.current).toBe("ultra");
  expect(runtime.setSessionProviderSelection).not.toHaveBeenCalled();
});

it("stops listening and rejects a pending preview when a Thread is created", async () => {
  const pending = deferred();
  api.read.mockReturnValueOnce(pending.promise);
  await render();
  session = "created-thread";
  await render();
  expect(stop).toHaveBeenCalledOnce();
  await act(async () => pending.resolve(snapshot("ultra")));
  expect(state.reasoningEffort).toBe("");
  expect(state.reasoningEffortRef.current).toBe("");
});

it("uses a canonical read for a fresh or restored Thread and gives notifications priority", async () => {
  session = "thread";
  await render();
  await act(async () =>
    state.applySessionModelPreference(session!, {
      providerType: "provider",
      model: "model",
      reasoningEffort: "high",
    }),
  );
  expect(state.reasoningEffort).toBe("high");
  expect(state.reasoningEffortRef.current).toBe("high");
  await act(async () =>
    state.applySessionModelPreference(session!, {
      providerType: "provider",
      model: "model",
      reasoningEffort: "high",
      threadSettings: { effort: null },
    }),
  );
  expect(state.reasoningEffort).toBe("");
  expect(state.reasoningEffortRef.current).toBe("");
});
