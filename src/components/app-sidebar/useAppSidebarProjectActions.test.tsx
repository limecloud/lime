import { act, type MouseEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  createProjectGitWorktree,
  ProjectGitWorktreeSetupError,
} from "@/lib/api/projectGit";
import { readLocalEnvironmentSelection } from "@/lib/api/localEnvironmentSelection";
import { ensureProjectWorkspace } from "@/lib/api/project";
import { useAppSidebarProjectActions } from "./useAppSidebarProjectActions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/projectGit", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/projectGit")>(
    "@/lib/api/projectGit",
  )),
  createProjectGitWorktree: vi.fn(),
}));
vi.mock("@/lib/api/localEnvironmentSelection", () => ({
  readLocalEnvironmentSelection: vi.fn(),
}));
vi.mock("@/lib/api/project", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/project")>(
    "@/lib/api/project",
  )),
  ensureProjectWorkspace: vi.fn(),
}));
vi.mock("@/components/agent/chat/hooks/agentProjectStorage", () => ({
  markProjectOpened: vi.fn(),
}));

const source = { id: "source", name: "Source", rootPath: "/source" };
const navigate = vi.fn();
let root: Root,
  container: HTMLDivElement,
  actions: ReturnType<typeof useAppSidebarProjectActions>;
function Probe() {
  actions = useAppSidebarProjectActions({
    onNavigate: navigate,
    refreshSidebarSessions: vi.fn(),
  });
  return null;
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.mocked(readLocalEnvironmentSelection).mockResolvedValue(null);
  vi.mocked(createProjectGitWorktree).mockResolvedValue({
    worktreePath: "/checkout",
  } as Awaited<ReturnType<typeof createProjectGitWorktree>>);
  vi.mocked(ensureProjectWorkspace).mockResolvedValue({
    id: "checkout",
    rootPath: "/checkout",
  } as Awaited<ReturnType<typeof ensureProjectWorkspace>>);
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it.each([null, "/source/.lime/environments/dev.toml"])(
  "creates with the current environment %s and opens the checkout",
  async (localEnvironmentConfigPath) => {
    vi.mocked(readLocalEnvironmentSelection).mockResolvedValueOnce(
      localEnvironmentConfigPath,
    );
    await act(async () => actions.handleCreateProjectWorktree(source));
    expect(createProjectGitWorktree).toHaveBeenCalledExactlyOnceWith(
      "/source",
      { localEnvironmentConfigPath },
    );
    expect(ensureProjectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: "/checkout" }),
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("agent", {
      agentEntry: "conversation",
      projectId: "checkout",
    });
  },
);

it("does not create a checkout if the environment preference cannot be read", async () => {
  vi.mocked(readLocalEnvironmentSelection).mockRejectedValueOnce(
    Error("unavailable"),
  );
  await act(async () => actions.handleCreateProjectWorktree(source));
  expect(createProjectGitWorktree).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledOnce();
});

it("opens the confirmed failed checkout on request and serializes repeated recovery clicks", async () => {
  vi.mocked(createProjectGitWorktree).mockRejectedValueOnce(
    new ProjectGitWorktreeSetupError("setup failed", "/checkout"),
  );
  await act(async () => actions.handleCreateProjectWorktree(source));
  expect(navigate).not.toHaveBeenCalled();
  expect(ensureProjectWorkspace).not.toHaveBeenCalled();
  const action = vi.mocked(toast.error).mock.calls.at(-1)![1]!.action;
  if (!action || !("onClick" in action)) throw Error("Missing recovery action");
  let resolve!: (
    project: Awaited<ReturnType<typeof ensureProjectWorkspace>>,
  ) => void;
  vi.mocked(ensureProjectWorkspace).mockImplementationOnce(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  await act(async () => {
    action.onClick({} as MouseEvent<HTMLButtonElement>);
    action.onClick({} as MouseEvent<HTMLButtonElement>);
  });
  expect(ensureProjectWorkspace).toHaveBeenCalledOnce();
  await act(async () =>
    resolve({ id: "checkout", rootPath: "/checkout" } as Awaited<
      ReturnType<typeof ensureProjectWorkspace>
    >),
  );
  expect(navigate).toHaveBeenCalledExactlyOnceWith("agent", {
    agentEntry: "conversation",
    projectId: "checkout",
  });
  expect(createProjectGitWorktree).toHaveBeenCalledOnce();
  expect(toast.success).not.toHaveBeenCalled();
});

it("keeps recovery available after the workspace owner fails, without opening a mismatched project", async () => {
  vi.mocked(createProjectGitWorktree).mockRejectedValueOnce(
    new ProjectGitWorktreeSetupError("setup failed", "/checkout"),
  );
  await act(async () => actions.handleCreateProjectWorktree(source));
  const action = vi.mocked(toast.error).mock.calls.at(-1)![1]!.action;
  if (!action || !("onClick" in action)) throw Error("Missing recovery action");
  vi.mocked(ensureProjectWorkspace).mockResolvedValueOnce({
    id: "wrong",
    rootPath: "/wrong",
  } as Awaited<ReturnType<typeof ensureProjectWorkspace>>);
  await act(async () => action.onClick({} as MouseEvent<HTMLButtonElement>));
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => action.onClick({} as MouseEvent<HTMLButtonElement>));
  expect(navigate).toHaveBeenCalledExactlyOnceWith("agent", {
    agentEntry: "conversation",
    projectId: "checkout",
  });
  expect(createProjectGitWorktree).toHaveBeenCalledOnce();
});
