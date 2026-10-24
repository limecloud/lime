import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import {
  createDeferred,
  flushEffects,
  mockCreateAgentRuntimeSession,
  mockGetAgentRuntimeSession,
  mockSubmitAgentRuntimeTurn,
  mockSafeInvoke,
} from "../hooks/useAgentChat.testUtils";
import { useAgentChat } from "../hooks/useAgentChat";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";

const resources = vi.hoisted(() => ({
  git: vi.fn(),
  create: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock("@/lib/api/projectGit", () => ({
  readProjectGitStatus: resources.git,
  createProjectGitWorktree: resources.create,
}));
vi.mock("@/lib/api/project", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/project")>(
    "@/lib/api/project",
  )),
  ensureProjectWorkspace: resources.ensure,
}));
vi.mock("../skill-selection/runtimeInputCapabilityCatalog", () => ({
  useRuntimeMentionCommandCatalog: () => ({
    mentionAgentTurnRouteMap: {},
    mentionCommandSkillIdMap: {},
    mentionCommandPrefixKeyMap: {},
  }),
}));
vi.mock("@/lib/skills/skillInstallPrompt", async () => ({
  ...(await vi.importActual<typeof import("@/lib/skills/skillInstallPrompt")>(
    "@/lib/skills/skillInstallPrompt",
  )),
  installSkillFromPromptInstruction: vi.fn(async () => ({
    directory: "fixture-skill",
  })),
}));

function mount() {
  const git = {
    rootPath: "/a",
    currentBranch: "main",
    hasGitRepository: true,
    branches: ["main"],
    uncommittedFileCount: 0,
  };
  resources.git.mockReset().mockResolvedValue(git);
  resources.create.mockReset().mockResolvedValue({
    worktreePath: "/a-task",
    branch: "main",
    status: git,
  });
  resources.ensure
    .mockReset()
    .mockResolvedValue({ id: "b", rootPath: "/a-task" });
  mockCreateAgentRuntimeSession.mockResolvedValue("scope-session");
  mockGetAgentRuntimeSession.mockImplementation(async (id: string) => ({
    id,
    thread_id: id,
    working_dir: id === "scope-session" ? "/a-task" : "/a",
    workspace_id: id === "scope-session" ? "b" : "a",
    messages: [],
    thread_read: { thread_id: id, status: "idle" },
  }));
  const controller = new ComposerController({ text: "A😀 rich input" });
  const setInput = vi.fn((text: string) => controller.setText(text));
  const onAccepted = vi.fn();
  let value!: ReturnType<typeof useWorkspaceSendActions>;
  let chat!: ReturnType<typeof useAgentChat>;
  let navigationEpoch = 0;
  function Surface({ workspaceId }: { workspaceId: string }) {
    chat = useAgentChat({ workspaceId, workingDir: `/${workspaceId}` });
    value = useWorkspaceSendActions({
      input: controller.getDocument().text,
      setInput,
      mentionedCharacters: [],
      setMentionedCharacters: vi.fn(),
      chatToolPreferences: { task: false, subagent: false },
      setChatToolPreferences: vi.fn(),
      serviceSkills: [],
      activeTheme: "general",
      mappedTheme: "general",
      isThemeWorkbench: false,
      projectId: workspaceId,
      projectRootPath: `/${workspaceId}`,
      executionWorkspaceId: workspaceId,
      sessionId: chat.sessionId,
      executionStrategy: "react",
      accessMode: "current",
      currentGateKey: "default_gate",
      messages: chat.messages,
      setChatMessages: chat.setMessages,
      sendMessage: chat.sendMessage,
      cancelExecutionScope: chat.cancelExecutionScope,
      getComposerDraftNavigationEpoch: () => navigationEpoch,
      onExecutionScopeAccepted: onAccepted,
      resolveSendBoundary: (({ sourceText }) => ({
        sourceText,
        browserRequirementMatch: null,
        shouldConsumePendingGeneralWorkbenchInitialPrompt: false,
        shouldDismissGeneralWorkbenchEntryPrompt: false,
      })) as Parameters<
        typeof useWorkspaceSendActions
      >[0]["resolveSendBoundary"],
      finalizeAfterSendSuccess: vi.fn(),
      rollbackAfterSendFailure: vi.fn(),
      resolveImageWorkbenchCommandRequest: () => null,
    });
    return <output data-mode={value.composerMode}>{chat.sessionId}</output>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (workspaceId = "a") =>
    act(() => root.render(<Surface workspaceId={workspaceId} />));
  render();
  const stage = () => act(() => value.setComposerMode("worktree"));
  const submit = (
    text = controller.getDocument().text,
    target: "start" | "steer" = "start",
  ) => {
    const frozen = controller.submit("start");
    return value.handleSend([], false, false, text, "react", undefined, {
      composerDraft: frozen.draft,
      composerSubmission: { ...frozen.submission, text },
      composerTarget: target,
    });
  };
  const finish = async (text?: string, target?: "start" | "steer") => {
    let pending!: ReturnType<typeof submit>;
    await act(async () => {
      pending = submit(text, target);
    });
    let result!: Awaited<typeof pending>;
    await act(async () => {
      result = await pending;
    });
    return result;
  };
  return {
    finish,
    get: () => value,
    chat: () => chat,
    controller,
    setInput,
    onAccepted,
    render,
    stage,
    submit,
    navigateSameWorkspace() {
      navigationEpoch += 1;
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe("staged Worktree through send plan, current session and stream", () => {
  it("stages without resource creation, then sends the complete rich submission in committed target scope", async () => {
    const h = mount();
    try {
      await flushEffects();
      h.stage();
      expect(h.get().composerMode).toBe("worktree");
      expect(resources.create).not.toHaveBeenCalled();
      const frozen = h.controller.captureDraft();
      let result!: Awaited<ReturnType<typeof h.submit>>;
      result = await h.finish();
      expect(result).toMatchObject({
        kind: "runtime-accepted",
        receipt: {
          sessionId: "scope-session",
          executionScope: {
            sourceWorkspaceId: "a",
            workspaceId: "b",
            workingDir: "/a-task",
          },
        },
      });
      expect(resources.create).toHaveBeenCalledExactlyOnceWith(
        "/a",
        undefined,
        "main",
      );
      expect(mockCreateAgentRuntimeSession).toHaveBeenCalledExactlyOnceWith(
        "b",
        undefined,
        "react",
        expect.objectContaining({ workingDir: "/a-task" }),
      );
      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledOnce();
      expect(h.chat().sessionWorkingDir).toBe("/a-task");
      expect(h.get().composerMode).toBe("local");
      expect(h.onAccepted).toHaveBeenCalledOnce();
      expect(h.setInput).not.toHaveBeenCalled();
      expect(h.controller.captureDraft()).toEqual(frozen);
    } finally {
      h.unmount();
    }
  });
  it.each([
    "",
    "/status",
    "!",
    'Download and install a skill.\nSKILL_NAME="fixture-skill"\nDOWNLOAD_URL="https://limeai.run/skill-packages/fixture-skill/latest/fixture-skill.zip"\nExtract it into the Agent Skills directory.',
  ])(
    "does not create for empty input or local confirmation: %s",
    async (text) => {
      const h = mount();
      try {
        await flushEffects();
        h.stage();
        await h.finish(text);
        expect(resources.create).not.toHaveBeenCalled();
        expect(mockCreateAgentRuntimeSession).not.toHaveBeenCalled();
        expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
      } finally {
        h.unmount();
      }
    },
  );
  it("refuses steer before creating a checkout", async () => {
    const h = mount();
    try {
      await flushEffects();
      h.stage();
      expect((await h.finish("input", "steer")).kind).toBe("rejected");
      expect(resources.create).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });
  it("reuses worktree and session identities after canonical hydration fails", async () => {
    const h = mount();
    try {
      await flushEffects();
      h.stage();
      const original = mockGetAgentRuntimeSession.getMockImplementation()!;
      let fail = true;
      mockGetAgentRuntimeSession.mockImplementation(async (id: string) => {
        if (id === "scope-session" && fail) {
          fail = false;
          throw new Error("read failed");
        }
        return original(id);
      });
      expect((await h.finish()).kind).toBe("rejected");
      expect((await h.finish()).kind).toBe("runtime-accepted");
      expect(resources.create).toHaveBeenCalledOnce();
      expect(resources.ensure).toHaveBeenCalledOnce();
      expect(mockCreateAgentRuntimeSession).toHaveBeenCalledOnce();
      expect(mockSubmitAgentRuntimeTurn).toHaveBeenCalledOnce();
    } finally {
      h.unmount();
    }
  });
  it("retains unknown creation and submission outcomes without duplicate requests or navigation", async () => {
    const h = mount();
    try {
      await flushEffects();
      h.stage();
      mockCreateAgentRuntimeSession.mockRejectedValue(
        new Error("thread response lost"),
      );
      expect((await h.finish()).kind).toBe("unknown");
      expect((await h.finish()).kind).toBe("unknown");
      expect(resources.create).toHaveBeenCalledOnce();
      expect(mockCreateAgentRuntimeSession).toHaveBeenCalledOnce();
      expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
      expect(h.onAccepted).not.toHaveBeenCalled();
      expect(h.controller.getDocument().text).toBe("A😀 rich input");
    } finally {
      h.unmount();
    }
  });
  it("does not submit after a permission response arrives for an abandoned scope", async () => {
    const h = mount();
    const original = mockSafeInvoke.getMockImplementation()!;
    try {
      await flushEffects();
      h.stage();
      const permission = createDeferred<void>();
      let queried = false;
      mockSafeInvoke.mockImplementation(
        async (command: string, payload?: unknown) => {
          const lines =
            (payload as { request?: { lines?: string[] } })?.request?.lines ??
            [];
          if (
            lines.some(
              (line) => JSON.parse(line).method === "permissionProfile/list",
            )
          ) {
            queried = true;
            await permission.promise;
          }
          return original(command, payload);
        },
      );
      let pending!: ReturnType<typeof h.submit>;
      await act(async () => {
        pending = h.submit();
      });
      expect(queried).toBe(true);
      h.render("c");
      h.render("a");
      await act(async () => {
        permission.resolve();
        await pending;
      });
      expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
      expect(h.onAccepted).not.toHaveBeenCalled();
      expect(h.chat().sessionId).not.toBe("scope-session");
    } finally {
      mockSafeInvoke.mockImplementation(original);
      h.unmount();
    }
  });

  it.each(["workspace-aba", "mode-cancel", "same-workspace-navigation"])(
    "does not send a late created worktree after %s",
    async (change) => {
      const h = mount();
      try {
        await flushEffects();
        h.stage();
        const wait = createDeferred<{ worktreePath: string; branch: string }>();
        resources.create.mockReturnValueOnce(wait.promise);
        let pending!: ReturnType<typeof h.submit>;
        await act(async () => {
          pending = h.submit();
          await Promise.resolve();
        });
        expect(resources.create).toHaveBeenCalledOnce();
        if (change === "workspace-aba") {
          h.render("c");
          h.render("a");
        } else if (change === "mode-cancel")
          act(() => h.get().setComposerMode("local"));
        else h.navigateSameWorkspace();
        await act(async () => {
          wait.resolve({ worktreePath: "/a-task", branch: "main" });
          expect((await pending).kind).toBe("rejected");
        });
        expect(resources.ensure).not.toHaveBeenCalled();
        expect(mockCreateAgentRuntimeSession).not.toHaveBeenCalled();
        expect(mockSubmitAgentRuntimeTurn).not.toHaveBeenCalled();
        expect(h.onAccepted).not.toHaveBeenCalled();
      } finally {
        h.unmount();
      }
    },
  );
});
