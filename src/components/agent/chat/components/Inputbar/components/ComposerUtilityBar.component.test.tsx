import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerUtilityBar } from "./ComposerUtilityBar";
import { buildInputbarCoreCopy } from "./inputbarCoreCopy";
import { useComposerUtilityActions } from "./useComposerUtilityActions";
import type { ProjectGitStatus } from "@/lib/api/projectGit";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  projectsRoot: vi.fn(),
  resolveRoot: vi.fn(),
  ensureProject: vi.fn(),
  folder: vi.fn(),
  readGit: vi.fn(),
  checkout: vi.fn(),
  createBranch: vi.fn(),
  worktree: vi.fn(),
  markOpened: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/api/project", () => ({
  getProject: mocks.getProject,
  getWorkspaceProjectsRoot: mocks.projectsRoot,
  resolveProjectRootPath: mocks.resolveRoot,
  ensureProjectWorkspace: mocks.ensureProject,
  extractErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@/lib/api/projectGit", () => ({
  readProjectGitStatus: mocks.readGit,
  checkoutProjectGitBranch: mocks.checkout,
  createProjectGitBranch: mocks.createBranch,
  createProjectGitWorktree: mocks.worktree,
}));
vi.mock("@/components/agent/chat/host/chatHostCapabilities", () => ({
  requestChatHostOpenPath: mocks.folder,
}));
vi.mock("../../../hooks/agentProjectStorage", () => ({
  markProjectOpened: mocks.markOpened,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("../../WorktreeEnvironmentDropdown", () => ({
  WorktreeEnvironmentDropdown: ({
    workspaceRoot,
  }: {
    workspaceRoot: string;
  }) => (
    <span
      data-testid="worktree-environment-dropdown"
      data-workspace-root={workspaceRoot}
    />
  ),
}));
vi.mock("@/components/ui/popover", async () => {
  const { createContext, useContext, cloneElement } = await import("react");
  const Context = createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);
  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <Context.Provider value={{ open, onOpenChange }}>
        {children}
      </Context.Provider>
    ),
    PopoverTrigger: ({
      children,
    }: {
      children: React.ReactElement<{ onClick?: () => void }>;
    }) => {
      const context = useContext(Context)!;
      return cloneElement(children, {
        onClick: () => {
          children.props.onClick?.();
          context.onOpenChange(!context.open);
        },
      });
    },
    PopoverContent: ({
      children,
      className,
      "data-testid": testId,
    }: {
      children: React.ReactNode;
      className?: string;
      "data-testid"?: string;
    }) => {
      const context = useContext(Context)!;
      return context.open ? (
        <div className={className} data-testid={testId}>
          {children}
        </div>
      ) : null;
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function status(
  rootPath = "/workspace/a",
  branch = `${rootPath.split("/").pop()}-main`,
): ProjectGitStatus {
  return {
    rootPath,
    repositoryRoot: rootPath,
    hasGitRepository: true,
    currentBranch: branch,
    branches: [branch, "feature"],
    uncommittedFileCount: 0,
  };
}

const projects = [
  { id: "a", name: "Project A", rootPath: "/workspace/a" },
  { id: "b", name: "Project B", rootPath: "/workspace/b" },
];
const copy = buildInputbarCoreCopy((key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key,
).projectContext;
type Props = React.ComponentProps<typeof ComposerUtilityBar>;

let root: Root;
let container: HTMLDivElement;
let onProjectChange: ReturnType<typeof vi.fn>;

async function render(props: Partial<Props> = {}) {
  await act(async () => {
    root.render(
      <ComposerUtilityBar
        projectId="a"
        openedProjects={projects}
        copy={copy}
        onProjectChange={onProjectChange}
        {...props}
      />,
    );
  });
}

function bar() {
  return container.querySelector<HTMLElement>(
    '[data-testid="composer-utility-bar"]',
  )!;
}

function action(name: string, suffix = "") {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-utility-action="${name}"]${suffix}`,
  );
  expect(button).toBeTruthy();
  return button!;
}

async function click(name: string, suffix = "") {
  await act(async () => action(name, suffix).click());
}

async function setBranchSearch(text: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label="${copy.branchSearchPlaceholder}"]`,
  )!;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getProject.mockImplementation(async (id: string) => ({
    id,
    name: id,
    rootPath: `/workspace/${id}`,
  }));
  mocks.projectsRoot.mockResolvedValue("/projects");
  mocks.resolveRoot.mockImplementation(
    async (name: string, parent: string) => `${parent}/${name}`,
  );
  mocks.ensureProject.mockImplementation(
    async ({ rootPath, name }: { rootPath: string; name: string }) => ({
      id: "created",
      name,
      rootPath,
    }),
  );
  mocks.readGit.mockImplementation(async (path: string) => status(path));
  mocks.checkout.mockImplementation(async (path: string, branch: string) =>
    status(path, branch),
  );
  mocks.createBranch.mockImplementation(async (path: string, branch: string) =>
    status(path, branch),
  );
  mocks.worktree.mockResolvedValue({
    worktreePath: "/workspace/a-next",
    branch: "a-main",
    status: status("/workspace/a-next"),
  });
  mocks.folder.mockResolvedValue("/projects/folder");
  onProjectChange = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ComposerUtilityBar", () => {
  it("仅工作树模式且有项目目录时挂载同一环境选择组件", async () => {
    await render();
    expect(
      container.querySelector('[data-testid="worktree-environment-dropdown"]'),
    ).toBeNull();
    await render({ composerMode: "worktree" });
    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="worktree-environment-dropdown"]',
      )?.dataset.workspaceRoot,
    ).toBe("/workspace/a");
    await render({ composerMode: "worktree", projectId: "b" });
    expect(
      container.querySelector<HTMLElement>(
        '[data-testid="worktree-environment-dropdown"]',
      )?.dataset.workspaceRoot,
    ).toBe("/workspace/b");
    await render({ composerMode: "worktree", showModeControls: false });
    expect(
      container.querySelector('[data-testid="worktree-environment-dropdown"]'),
    ).toBeNull();
    await render({ composerMode: "worktree", projectId: null });
    expect(
      container.querySelector('[data-testid="worktree-environment-dropdown"]'),
    ).toBeNull();
  });
  it("同一 owner 的 project-only 呈现只选择项目，不读取 Git 或显示运行控件", async () => {
    await render({ projectId: " a ", showModeControls: false });
    expect(bar().dataset.projectId).toBe("a");
    expect(bar().dataset.workspaceRoot).toBe("/workspace/a");
    expect(bar().dataset.gitStatus).toBe("unavailable");
    expect(mocks.readGit).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="composer-utility-mode"]'),
    ).toBeNull();
    await click("project-picker");
    await click("select-project", '[data-project-id="b"]');
    expect(onProjectChange).toHaveBeenCalledWith("b");
    expect(mocks.markOpened).toHaveBeenCalledWith("b");
  });

  it("读取中的真实 busy 状态在成功后恢复可见分支", async () => {
    const read = deferred<ProjectGitStatus>();
    mocks.readGit.mockReturnValueOnce(read.promise);
    await render();
    expect(bar().getAttribute("aria-busy")).toBe("true");
    expect(bar().dataset.gitStatus).toBe("loading");
    expect(container.textContent).toContain(copy.gitStatusLoading);
    expect(
      container.querySelector('[data-testid="composer-utility-branch"]'),
    ).toBeNull();
    await act(async () => read.resolve(status()));
    expect(bar().getAttribute("aria-busy")).toBe("false");
    expect(bar().dataset.gitStatus).toBe("ready");
    expect(action("branch-picker").textContent).toBe("a-main");
  });

  it("Git 读取失败显式呈现本地化错误并可重试，不展示原始路径错误", async () => {
    mocks.readGit.mockRejectedValueOnce(new Error("/private/sensitive-path"));
    await render();
    expect(bar().dataset.gitStatus).toBe("error");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      copy.gitStatusFailed,
    );
    expect(container.textContent).not.toContain("/private/sensitive-path");
    await click("retry-git-status");
    expect(mocks.readGit).toHaveBeenCalledTimes(2);
    expect(bar().dataset.gitStatus).toBe("ready");
    expect(action("branch-picker").textContent).toBe("a-main");
  });

  it("A→B→A 的旧读取成功与失败不会结束新实例的 loading", async () => {
    const oldA = deferred<ProjectGitStatus>();
    const oldB = deferred<ProjectGitStatus>();
    const newA = deferred<ProjectGitStatus>();
    mocks.readGit
      .mockReturnValueOnce(oldA.promise)
      .mockReturnValueOnce(oldB.promise)
      .mockReturnValueOnce(newA.promise);
    await render();
    await render({ projectId: "b" });
    await render();
    await act(async () => {
      oldA.resolve(status("/workspace/a", "old-a"));
      oldB.reject(new Error("old-b"));
    });
    expect(bar().dataset.gitStatus).toBe("loading");
    expect(bar().getAttribute("aria-busy")).toBe("true");
    expect(
      container.querySelector('[data-testid="composer-utility-branch"]'),
    ).toBeNull();
    await act(async () => newA.resolve(status("/workspace/a", "new-a")));
    expect(action("branch-picker").textContent).toBe("new-a");
  });

  it.each(["success", "error"])(
    "A 的迟到 checkout %s 不影响 B 的分支草稿、菜单、状态或 toast",
    async (outcome) => {
      const checkout = deferred<ProjectGitStatus>();
      mocks.checkout.mockReturnValueOnce(checkout.promise);
      await render();
      await click("branch-picker");
      await click("checkout-branch", '[data-branch="feature"]');
      await render({ projectId: "b" });
      await click("branch-picker");
      const input = await setBranchSearch("b-draft");
      await act(async () => {
        if (outcome === "success")
          checkout.resolve(status("/workspace/a", "old-feature"));
        else checkout.reject(new Error("old failure"));
      });
      expect(action("branch-picker").textContent).toBe("b-main");
      expect(input.value).toBe("b-draft");
      expect(
        container.querySelector('[data-testid="composer-utility-branch-menu"]'),
      ).toBeTruthy();
      expect(bar().getAttribute("aria-busy")).toBe("false");
      expect(mocks.success).not.toHaveBeenCalled();
      expect(mocks.error).not.toHaveBeenCalled();
    },
  );

  it("A→B→A 旧 checkout 的 finally 不会解锁新 A 的请求或关闭新菜单", async () => {
    const oldRequest = deferred<ProjectGitStatus>();
    const newRequest = deferred<ProjectGitStatus>();
    mocks.checkout
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    await render();
    await click("branch-picker");
    await click("checkout-branch", '[data-branch="feature"]');
    await render({ projectId: "b" });
    await render();
    await click("branch-picker");
    await click("checkout-branch", '[data-branch="feature"]');
    await act(async () => oldRequest.resolve(status("/workspace/a", "old")));
    expect(bar().getAttribute("aria-busy")).toBe("true");
    expect(action("checkout-branch", '[data-branch="feature"]').disabled).toBe(
      true,
    );
    expect(action("branch-picker").textContent).toBe("a-main");
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => newRequest.resolve(status("/workspace/a", "new")));
    expect(action("branch-picker").textContent).toBe("new");
    expect(bar().getAttribute("aria-busy")).toBe("false");
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it("同一 projectId 更换 rootPath 会隔离旧 mutation 并重置局部草稿", async () => {
    const checkout = deferred<ProjectGitStatus>();
    mocks.checkout.mockReturnValueOnce(checkout.promise);
    await render();
    await click("branch-picker");
    await click("checkout-branch", '[data-branch="feature"]');
    await render({
      openedProjects: [{ ...projects[0], rootPath: "/workspace/replacement" }],
    });
    expect(bar().dataset.workspaceRoot).toBe("/workspace/replacement");
    expect(
      container.querySelector('[data-testid="composer-utility-branch-menu"]'),
    ).toBeNull();
    await act(async () => checkout.resolve(status("/workspace/a", "old")));
    expect(action("branch-picker").textContent).toBe("replacement-main");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("当前 checkout 失败保留菜单，释放锁后可重试并显示成功状态", async () => {
    mocks.checkout.mockRejectedValueOnce(new Error("checkout failed"));
    await render();
    await click("branch-picker");
    await click("checkout-branch", '[data-branch="feature"]');
    expect(mocks.error).toHaveBeenCalledWith(
      `${copy.branchSwitchFailed}: checkout failed`,
    );
    expect(action("branch-picker").textContent).toBe("a-main");
    expect(action("checkout-branch", '[data-branch="feature"]').disabled).toBe(
      false,
    );
    await click("checkout-branch", '[data-branch="feature"]');
    expect(action("branch-picker").textContent).toBe("feature");
    expect(
      container.querySelector('[data-testid="composer-utility-branch-menu"]'),
    ).toBeNull();
  });

  it("键盘 Enter 创建分支同步防重复，成功后清理草稿并刷新当前分支", async () => {
    const request = deferred<ProjectGitStatus>();
    mocks.createBranch.mockReturnValueOnce(request.promise);
    await render();
    await click("branch-picker");
    const input = await setBranchSearch("new-branch");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(mocks.createBranch).toHaveBeenCalledTimes(1);
    expect(mocks.createBranch).toHaveBeenCalledWith(
      "/workspace/a",
      "new-branch",
    );
    expect(action("create-branch").disabled).toBe(true);
    await act(async () =>
      request.resolve(status("/workspace/a", "new-branch")),
    );
    expect(action("branch-picker").textContent).toBe("new-branch");
    await click("branch-picker");
    expect(
      container.querySelector<HTMLInputElement>(
        `input[aria-label="${copy.branchSearchPlaceholder}"]`,
      )?.value,
    ).toBe("");
  });

  it("选择 Worktree 只暂存 mode，不创建 Git、Workspace 或导航", async () => {
    const setComposerMode = vi.fn();
    await render({ setComposerMode });
    await click("mode-picker");
    expect(action("select-local").getAttribute("aria-pressed")).toBe("true");
    await click("select-worktree");
    expect(setComposerMode).toHaveBeenCalledExactlyOnceWith("worktree");
    expect(mocks.worktree).not.toHaveBeenCalled();
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(mocks.markOpened).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="composer-utility-mode-menu"]'),
    ).toBeNull();
  });

  it("受控 Worktree 显示选中态，切回 local 也只更新 mode", async () => {
    const setComposerMode = vi.fn();
    await render({ composerMode: "worktree", setComposerMode });
    expect(action("mode-picker").textContent).toContain(copy.newWorktree);
    await click("mode-picker");
    expect(action("select-worktree").getAttribute("aria-pressed")).toBe("true");
    expect(action("select-local").getAttribute("aria-pressed")).toBe("false");
    await click("select-local");
    expect(setComposerMode).toHaveBeenCalledExactlyOnceWith("local");
    expect(mocks.worktree).not.toHaveBeenCalled();
    expect(mocks.ensureProject).not.toHaveBeenCalled();
  });

  it("旧目录选择完成后不注册 workspace；取消选择会释放当前锁", async () => {
    const selected = deferred<string | null>();
    mocks.folder.mockReturnValueOnce(selected.promise);
    await render({ projectOpen: true });
    // The add-project submenu opens when its trigger receives focus.
    const add = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-utility-add-project"]',
    )!;
    await act(async () => add.focus());
    await click("open-folder");
    await render({ projectId: "b", projectOpen: true });
    await act(async () => selected.resolve("/projects/old-folder"));
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(onProjectChange).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="composer-utility-add-project"]',
        )!
        .focus(),
    );
    mocks.folder.mockResolvedValueOnce(null);
    await click("open-folder");
    expect(bar().getAttribute("aria-busy")).toBe("false");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("旧空白项目的 projectsRoot 返回后不继续解析或创建", async () => {
    const pending = deferred<string>();
    mocks.projectsRoot.mockReturnValueOnce(pending.promise);
    await render({ projectOpen: true });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="composer-utility-add-project"]',
        )!
        .focus(),
    );
    await click("create-project");
    await render({ projectId: "b" });
    await act(async () => pending.resolve("/projects"));
    expect(mocks.resolveRoot).not.toHaveBeenCalled();
    expect(mocks.ensureProject).not.toHaveBeenCalled();
    expect(onProjectChange).not.toHaveBeenCalled();
  });

  it.each(["create-project", "open-folder"])(
    "旧 %s 的 ensure 完成后不会覆盖当前项目导航",
    async (name) => {
      const pending = deferred<{
        id: string;
        name: string;
        rootPath: string;
      }>();
      mocks.ensureProject.mockReturnValueOnce(pending.promise);
      await render({ projectOpen: true });
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="composer-utility-add-project"]',
          )!
          .focus(),
      );
      await click(name);
      expect(mocks.ensureProject).toHaveBeenCalledTimes(1);
      await render({ projectId: "b" });
      await act(async () =>
        pending.resolve({ id: "old", name: "old", rootPath: "/projects/old" }),
      );
      expect(bar().dataset.projectId).toBe("b");
      expect(mocks.markOpened).not.toHaveBeenCalled();
      expect(onProjectChange).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
    },
  );

  it("旧 createBranch 返回不会清空 B 的新分支名称", async () => {
    const pending = deferred<ProjectGitStatus>();
    mocks.createBranch.mockReturnValueOnce(pending.promise);
    await render();
    await click("branch-picker");
    await setBranchSearch("a-new");
    await click("create-branch");
    await render({ projectId: "b" });
    await click("branch-picker");
    const input = await setBranchSearch("b-new");
    await act(async () => pending.resolve(status("/workspace/a", "a-new")));
    expect(input.value).toBe("b-new");
    expect(action("branch-picker").textContent).toBe("b-main");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("所有项目/Git mutation 在重渲染前共享同步锁", async () => {
    let actions!: ReturnType<typeof useComposerUtilityActions>;
    const pending = deferred<string>();
    mocks.projectsRoot.mockReturnValueOnce(pending.promise);
    function Harness() {
      actions = useComposerUtilityActions({
        rootPath: "/workspace/a",
        showModeControls: true,
        copy,
        onProjectChange,
        onProjectOpenChange: vi.fn(),
        onBranchOpenChange: vi.fn(),
        onBranchSearchChange: vi.fn(),
      });
      return <span>{actions.mutation}</span>;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => {
      void actions.createBlankProject();
      void actions.createBlankProject();
      void actions.useExistingFolder();
      void actions.checkoutBranch("feature");
      void actions.createBranch("new");
    });
    expect(mocks.projectsRoot).toHaveBeenCalledTimes(1);
    for (const mock of [
      mocks.folder,
      mocks.checkout,
      mocks.worktree,
      mocks.createBranch,
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
    await act(async () => pending.resolve("/projects"));
    expect(actions.mutation).toBeNull();
    expect(onProjectChange).toHaveBeenCalledWith("created");
  });
});
