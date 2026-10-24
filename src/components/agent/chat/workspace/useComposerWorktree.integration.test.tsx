import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { RuntimeSubmissionResult } from "../hooks/agentSendResult";
import type { ExecutionScope } from "../hooks/executionScope";
import { useComposerWorktree } from "./useComposerWorktree";

const resources = vi.hoisted(() => ({
  git: vi.fn(),
  create: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock("@/lib/api/projectGit", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/projectGit")>(
    "@/lib/api/projectGit",
  )),
  readProjectGitStatus: resources.git,
  createProjectGitWorktree: resources.create,
}));
vi.mock("@/lib/api/project", () => ({
  ensureProjectWorkspace: resources.ensure,
}));
vi.mock("@/lib/api/localEnvironmentSelection", () => ({
  readLocalEnvironmentSelection: vi.fn(async () => null),
}));

it.each(["accepted-target", "foreign-target", "mode-cancel", "workspace-aba"])(
  "commits acceptance only for the canonical navigation transition: %s",
  async (transition) => {
    resources.git.mockResolvedValue({
      hasGitRepository: true,
      currentBranch: "main",
    });
    resources.create.mockResolvedValue({ worktreePath: "/target" });
    resources.ensure.mockResolvedValue({ id: "target", rootPath: "/target" });
    const onAccepted = vi.fn();
    let epoch = 0;
    let targetCurrent = false;
    let value!: ReturnType<typeof useComposerWorktree>;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Surface({ workspaceId }: { workspaceId: string }) {
      value = useComposerWorktree({
        workspaceId,
        workingDir: `/${workspaceId}`,
        getNavigationEpoch: () => epoch,
        isAcceptedTargetCurrent: () => targetCurrent,
        onAccepted,
      });
      return null;
    }
    const render = (workspaceId: string) =>
      act(() => root.render(<Surface workspaceId={workspaceId} />));
    let resolve!: (result: RuntimeSubmissionResult) => void;
    const accepted = new Promise<RuntimeSubmissionResult>((yes) => {
      resolve = yes;
    });
    let scope!: ExecutionScope;
    const execute = vi.fn(async (target: typeof scope) => {
      scope = target;
      return accepted;
    });
    try {
      render("source");
      act(() => value.setComposerMode("worktree"));
      let pending!: Promise<RuntimeSubmissionResult>;
      await act(async () => {
        pending = value.capture()!.submit(execute);
      });
      expect(execute).toHaveBeenCalledOnce();
      epoch += 1;
      targetCurrent = true;
      if (transition === "mode-cancel")
        act(() => value.setComposerMode("local"));
      else render(transition === "foreign-target" ? "foreign" : "target");
      if (transition === "workspace-aba") {
        render("foreign");
        render("target");
      }
      await act(async () => {
        resolve({
          kind: "runtime-accepted",
          receipt: {
            kind: "start",
            sessionId: "session-target",
            threadId: "thread-target",
            turnId: "turn-target",
            executionScope: scope,
          },
        });
        await pending;
      });
      expect(onAccepted).toHaveBeenCalledTimes(
        transition === "accepted-target" ? 1 : 0,
      );
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  },
);
