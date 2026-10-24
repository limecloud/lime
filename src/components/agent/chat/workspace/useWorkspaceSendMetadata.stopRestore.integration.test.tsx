import React, { act, createRef, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  harness,
  a,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import { useComposerController } from "@/components/input-kit/useComposerController";
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from "@/components/input-kit/ComposerEditor";
import { useInputbarController } from "../components/Inputbar/hooks/useInputbarController";
import type { InputbarSendPayload } from "../components/Inputbar/inputbarSendPayload";
import type { Inputbar } from "../components/Inputbar";
import { insertComposerSkill } from "../skill-selection/composerCapabilityMention";
import { resolveInputCapabilitySendRoute } from "../skill-selection/inputCapabilitySelection";
import { createAgentChatSendMessage } from "../hooks/agentChatSendMessage";
import { createRestoreTokenFixture } from "../hooks/agentStreamRestoreToken.testFixtures";
import { useAgentStream } from "../hooks/useAgentStream";
import type { InterruptedInputRestoreRequest } from "../hooks/agentStreamInputRestoreTypes";
import { clearAllAgentStreamTextOverlays } from "../hooks/agentStreamTextOverlayStore";
import type {
  RawSendMessageFn,
  SendMessageOptions,
} from "../hooks/agentChatShared";
import type { Skill } from "@/lib/api/skills";
import { activityLogger } from "@/lib/workspace/workbenchRuntime";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import {
  captureCanonicalTurnEvents,
  createSceneProps,
} from "./stopSendChain.testFixtures";

const observed = vi.hoisted(() => ({
  controller: undefined as
    | ReturnType<
        typeof import("../hooks/useAgentStreamController").useAgentStreamController
      >
    | undefined,
  inputbar: undefined as ReturnType<typeof useInputbarController> | undefined,
  payload: undefined as InputbarSendPayload | undefined,
  acceptance: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock("../hooks/useAgentStreamController", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../hooks/useAgentStreamController")>();
  return {
    ...actual,
    // Observation only: the real hook, state, ref and methods are returned unchanged.
    useAgentStreamController: (
      ...args: Parameters<typeof actual.useAgentStreamController>
    ) => {
      const value = actual.useAgentStreamController(...args);
      observed.controller = value;
      return value;
    },
  };
});
vi.mock("../components/Inputbar", () => ({
  // Replace presentation only; Controller send, settlement and restore effects stay real.
  Inputbar: (props: React.ComponentProps<typeof Inputbar>) => {
    const runtime = useInputbarController({
      ...props,
      onSend: async (payload = {}) => {
        observed.payload = payload;
        if (!payload.onRuntimeAccepted)
          throw new Error("Missing real settlement observer");
        const acceptance = vi.fn(payload.onRuntimeAccepted);
        observed.acceptance = acceptance;
        return props.onSend({ ...payload, onRuntimeAccepted: acceptance });
      },
    });
    observed.inputbar = runtime;
    return (
      <button data-testid="stop" onClick={runtime.inputAdapter.actions.stop}>
        Stop
      </button>
    );
  },
}));
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({ AppServerClient: vi.fn() }));
vi.mock("@/lib/api/promptHistory", () => ({
  readPromptHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/api/hintRoutes", () => ({
  listHintRoutes: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));
vi.mock("@/lib/api/permissionProfiles", () => ({
  resolveAllowedPermissionProfile: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/lib/api/modelRegistry", () => ({
  modelRegistryApi: {
    getModelRegistry: vi.fn(async () => [
      {
        id: "fixture",
        provider_id: "openai",
        capabilities: { vision: true, reasoning: false },
        task_families: ["chat", "vision_understanding"],
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        runtime_features: ["streaming"],
        capability_provenance: "provider_explicit",
      },
    ]),
  },
}));
vi.mock("@/lib/api/appConfig", () => ({ getConfig: vi.fn(async () => ({})) }));
vi.mock("../hooks/usePendingInteractions", () => ({
  usePendingInteractions: () => ({ interactions: [], respond: vi.fn() }),
}));
vi.mock("../hooks/useStrictReviewStatus", () => ({
  useStrictReviewStatus: () => null,
}));
vi.mock("./WorkspaceHarnessDialogs", () => ({
  GeneralWorkbenchDialogSection: () => null,
}));

const skill: Skill = {
  key: "user:capability-report",
  name: "Capability Report",
  description: "Report",
  directory: "/tmp/capability-report",
  installed: true,
  sourceKind: "other",
};
type PersistenceHarness = Awaited<ReturnType<typeof harness>>;
const mounted: {
  root: ReturnType<typeof createRoot>;
  element: HTMLElement;
  h: PersistenceHarness;
  detach: () => void;
}[] = [];
const noop = () => undefined;
const rangeDescriptors = new Map(
  ["getClientRects", "getBoundingClientRect"].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(Range.prototype, name)] as const,
  ),
);

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  observed.controller = undefined;
  observed.inputbar = undefined;
  observed.payload = undefined;
  observed.acceptance = undefined;
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 1),
  });
});
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    act(() => {
      m.detach();
      m.root.unmount();
    });
    m.element.remove();
    await m.h.close();
  }
  activityLogger.clear();
  clearAllAgentStreamTextOverlays();
  vi.useRealTimers();
  for (const [name, descriptor] of rangeDescriptors) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else Reflect.deleteProperty(Range.prototype, name);
  }
});

async function setup(withEditor = false) {
  const h = await harness({ safeInvoke, safeListen });
  await h.coordinator.bindCommitted(a);
  h.controller.setText("原始中😀 ");
  h.controller.ingestHTML(
    '<p><a href="https://example.invalid/marks" title="标题">链接中😀</a></p><pre><code class="language-typescript">const value = "中😀";</code></pre>',
  );
  h.controller.ingestPaste("历史粘贴验证😀 ".repeat(180));
  insertComposerSkill(h.controller, skill);
  h.controller.setInputCapabilityRoute(
    resolveInputCapabilitySendRoute({ kind: "installed_skill", skill }),
  );
  h.controller.setAttachments([
    { data: "cGljdHVyZQ==", mediaType: "image/png" },
  ]);
  h.controller.setPathReferences([
    {
      id: "file:/tmp/composer-reference.md",
      path: "/tmp/composer-reference.md",
      name: "composer-reference.md",
      isDir: false,
      source: "file_manager",
    },
  ]);
  h.controller.setSelection(1, 4);
  const original = h.controller.captureDraft();
  await h.coordinator.idle();
  const f = createRestoreTokenFixture();
  const turnEvents = captureCanonicalTurnEvents(f.runtime);
  const editorRef = createRef<ComposerEditorHandle>();
  let stream!: ReturnType<typeof useAgentStream>;
  let rawOptions: SendMessageOptions | undefined;
  let stopping: Promise<void> | undefined;
  const restoreRequests: InterruptedInputRestoreRequest[] = [];
  const rootElement = document.createElement("div");
  document.body.appendChild(rootElement);
  const root = createRoot(rootElement);

  function Harness() {
    const { snapshot } = useComposerController({ controller: h.controller });
    const [request, setRequest] =
      useState<InterruptedInputRestoreRequest | null>(null);
    const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
    const updateCurrentTurnId = useCallback(
      (value: React.SetStateAction<string | null>) => {
        f.env.setCurrentTurnId(value);
        setCurrentTurnId(f.state.currentTurnId);
      },
      [],
    );
    const setInput = useCallback(
      (value: string) => h.controller.setText(value),
      [],
    );
    const onRestore = useCallback((value: InterruptedInputRestoreRequest) => {
      restoreRequests.push(value);
      setRequest(value);
    }, []);
    const onHandled = useCallback(
      (requestId: string) =>
        setRequest((value) => (value?.requestId === requestId ? null : value)),
      [],
    );
    stream = useAgentStream({
      ...f.env,
      waitForSessionProviderSelectionSync:
        f.env.waitForSessionProviderSelectionSync!,
      setTodoItems: f.env.setTodoItems!,
      currentAssistantMsgIdRef: React.useRef<string | null>(null),
      currentStreamingSessionIdRef: React.useRef<string | null>(null),
      currentStreamingEventNameRef: React.useRef<string | null>(null),
      getMessages: () => f.state.messages,
      executionRuntime: null,
      threadBusy: false,
      currentTurnId,
      setCurrentTurnId: updateCurrentTurnId,
      threadTurns: f.state.turns,
      onRestoreInterruptedInput: onRestore,
    });
    const rawSendMessage: RawSendMessageFn = (...args) => {
      rawOptions = args[8];
      return stream.sendMessage(...args);
    };
    const sendMessage = createAgentChatSendMessage({
      rawSendMessage,
      baseStatusSnapshot: {
        sessionId: "session-1",
        currentTurnId,
        providerType: "openai",
        model: "fixture",
        executionStrategy: "react",
        queuedTurnsCount: 0,
        isSending: stream.isSending,
      },
      compactSession: stream.compactSession,
      clearMessages: noop,
      createFreshSession: async () => null,
      appendAssistantMessage: noop,
      notifyInfo: noop,
      notifySuccess: noop,
    });
    const send = useWorkspaceSendActions({
      input: snapshot.document.text,
      setInput,
      mentionedCharacters: [],
      setMentionedCharacters: noop,
      chatToolPreferences: { task: false, subagent: false },
      setChatToolPreferences: noop,
      serviceSkills: [],
      activeTheme: "general",
      mappedTheme: "general",
      isThemeWorkbench: false,
      projectId: "workspace-1",
      projectRootPath: "/workspace",
      sessionId: "session-1",
      executionStrategy: "react",
      accessMode: "current",
      currentGateKey: "default_gate",
      contentId: null,
      messages: f.state.messages,
      setChatMessages: f.env.setMessages,
      sendMessage,
      ensureSessionForCommandMetadata: f.env.ensureSession,
      resolveSendBoundary: ({ sourceText }) => ({
        sourceText,
        browserRequirementMatch: null,
        shouldConsumePendingGeneralWorkbenchInitialPrompt: false,
        shouldDismissGeneralWorkbenchEntryPrompt: false,
      }),
      finalizeAfterSendSuccess: noop,
      rollbackAfterSendFailure: noop,
      resolveImageWorkbenchCommandRequest: () => null,
    });
    const scene = useWorkspaceInputbarSceneRuntime(
      createSceneProps({
        composerController: h.controller,
        composerDraftCoordinator: h.coordinator,
        sessionId: "session-1",
        threadId: "thread-1",
        projectId: "workspace-1",
        projectRootPath: "/workspace",
        isThemeWorkbench: false,
        input: snapshot.document.text,
        setInput,
        skills: [skill],
        handleSend: send.handleSend,
        isPreparingSend: send.isPreparingSend,
        isSending: stream.isSending,
        inputRestoreRequest: request,
        onInputRestoreRequestHandled: onHandled,
        pathReferences: [...snapshot.document.pathReferences],
        onClearPathReferences: () => h.controller.setPathReferences([]),
        handleStopSending: () => {
          stopping = stream.stopSending();
        },
        providerType: "openai",
        model: "fixture",
      }),
    );
    return (
      <>
        {scene.inputbarNode}
        {withEditor && (
          <ComposerEditor
            controller={h.controller}
            editorRef={editorRef}
            disabled={stream.isSending}
            sessionId="thread-1"
          />
        )}
      </>
    );
  }
  act(() => root.render(<Harness />));
  mounted.push({
    root,
    element: rootElement,
    h,
    detach: () => stream.detachStreamBindings(),
  });
  return {
    h,
    f,
    original,
    restoreRequests,
    editorRef,
    get rawOptions() {
      return rawOptions;
    },
    get active() {
      return observed.controller!.activeStreamRef.current;
    },
    detach: () => act(() => stream.detachStreamBindings()),
    async send() {
      await act(async () => {
        const result = await observed.inputbar!.handleSend();
        expect(result).toMatchObject({ kind: "runtime-accepted" });
        turnEvents.emitTurnStarted(original.text);
        await h.coordinator.idle();
      });
      expect(f.state.currentTurnId).toBe("turn-1");
    },
    async stop() {
      await act(async () => {
        rootElement
          .querySelector<HTMLButtonElement>("button[data-testid=stop]")!
          .click();
        await stopping;
      });
      // Restore is applied by the real Inputbar effect after the Stop update commits.
      await act(async () => {
        await h.coordinator.idle();
      });
    },
  };
}

describe("Workspace rich send metadata full chain", () => {
  it.each([false, true])(
    "retains the real token through scene/workspace/chat/stream and public Stop (detached=%s)",
    async (detached) => {
      const s = await setup();
      await s.send();
      const payload = observed.payload!;
      const token = payload.composerRestoreToken;
      expect(token).toBeDefined();
      expect(payload.composerDraft).toEqual(s.original);
      expect(s.rawOptions?.composerRestoreToken).toBe(token);
      expect(s.rawOptions?.composerDraft).toEqual(s.original);
      expect(s.rawOptions?.capabilityRoute).toEqual(
        s.original.inputCapabilityRoute,
      );
      expect(s.active?.composerRestoreToken).toBe(token);
      expect(s.active?.submittedDraft).toMatchObject(s.original);
      expect(observed.acceptance).toHaveBeenCalledOnce();
      expect(
        JSON.stringify(s.f.runtime.submitOp.mock.calls[0][0]).includes(
          "composerRestoreToken",
        ),
      ).toBe(false);
      expect(s.h.controller.getDocument().text).toBe("");
      expect(await s.h.read(a)).toBeNull();
      if (detached) s.detach();
      await s.stop();
      expect(s.f.runtime.interruptTurn).toHaveBeenCalledOnce();
      expect(s.restoreRequests).toHaveLength(1);
      expect(s.restoreRequests[0].composerRestoreToken).toBe(token);
      expect(s.restoreRequests[0].reason).toBe(
        detached
          ? "output_free_interrupted_turn"
          : "thinking_only_cancelled_turn",
      );
      expect(s.restoreRequests[0].draft).toMatchObject(s.original);
      expect(s.h.controller.captureDraft()).toEqual(s.original);
      expect(observed.acceptance).toHaveBeenCalledOnce();
      expect((await s.h.read(a)) === null).toBe(false);
    },
  );

  it("mounts real EditorView and verifies accepted clear, disabled DOM focus, editable Stop restore", async () => {
    const s = await setup(true);
    const editor = s.editorRef.current!.getElement()!;
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.textContent).toContain("原始中😀");
    expect(editor.querySelector("pre") === null).toBe(false);
    expect(editor.querySelector('[data-composer-token="skill"]') === null).toBe(
      false,
    );
    act(() => s.editorRef.current!.focus());
    expect(document.activeElement).toBe(editor);
    await s.send();
    const token = observed.payload!.composerRestoreToken;
    expect(token).toBeDefined();
    expect(s.rawOptions?.composerRestoreToken).toBe(token);
    expect(s.active?.composerRestoreToken).toBe(token);
    expect(observed.acceptance).toHaveBeenCalledOnce();
    expect(editor.textContent).toBe("");
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.getAttribute("aria-disabled")).toBe("true");
    act(() => {
      editor.blur();
      editor.focus();
    });
    expect(document.activeElement).toBe(editor);
    await s.stop();
    expect(s.f.runtime.interruptTurn).toHaveBeenCalledOnce();
    expect(s.restoreRequests).toHaveLength(1);
    expect(s.restoreRequests[0].composerRestoreToken).toBe(token);
    expect(s.h.controller.captureDraft()).toEqual(s.original);
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.getAttribute("aria-disabled")).toBe("false");
    expect(editor.textContent).toContain("原始中😀");
    act(() => s.editorRef.current!.focus());
    expect(document.activeElement).toBe(editor);
    expect(observed.acceptance).toHaveBeenCalledOnce();
    expect((await s.h.read(a)) === null).toBe(false);
  });
});
