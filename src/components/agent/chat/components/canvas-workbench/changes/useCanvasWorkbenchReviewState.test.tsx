import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasWorkbenchReviewState } from "./useCanvasWorkbenchReviewState";
import type { HarnessFilePreviewResult } from "../../HarnessStatusPanel";
import { parseCanvasWorkbenchPatchDiffLines } from "./CanvasWorkbenchChangesPanelViewModel";

const git = vi.hoisted(() => ({
  diff: vi.fn(),
  status: vi.fn(),
  commits: vi.fn(),
}));
vi.mock("@/lib/api/projectGit", () => ({
  readProjectGitDiff: git.diff,
  readProjectGitStatus: git.status,
  listProjectGitCommits: git.commits,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

type Input = Parameters<typeof useCanvasWorkbenchReviewState>[0];
type State = ReturnType<typeof useCanvasWorkbenchReviewState>;
const roots: Array<{ root: Root; container: HTMLDivElement }> = [];
const translateWorkbench = (key: string) => key;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function mount(input: Partial<Input> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let state!: State;
  function Harness(props: Partial<Input>) {
    state = useCanvasWorkbenchReviewState({
      changeView: null,
      workspaceRoot: "/workspace",
      translateWorkbench,
      ...props,
    });
    return null;
  }
  const render = (props: Partial<Input>) =>
    act(() => root.render(<Harness {...props} />));
  render(input);
  roots.push({ root, container });
  return {
    get state() {
      return state;
    },
    render,
  };
}
function patch(path: string, value: string) {
  return {
    hasGitRepository: true,
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${value}`,
    uncommittedFileCount: 1,
  };
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  git.status.mockResolvedValue({
    hasGitRepository: true,
    currentBranch: "main",
    repositoryRoot: "/workspace",
    uncommittedFileCount: 1,
  });
});
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.resetAllMocks();
});

describe("useCanvasWorkbenchReviewState request identity", () => {
  it("全文与 patch 不匹配时展示错误，重试成功后才启用全文", async () => {
    const loadFilePreview = vi
      .fn()
      .mockResolvedValueOnce({ content: "different" })
      .mockResolvedValueOnce({ content: "new\ntail" });
    const item = {
      id: "patch",
      path: "old.ts",
      destinationPath: "file.ts",
      diffLines: parseCanvasWorkbenchPatchDiffLines("@@ -1 +1 @@\n-old\n+new"),
    };
    const hook = mount({ loadFilePreview });
    await act(async () => {
      await hook.state.toggleLoadFullFile(item);
    });
    expect(loadFilePreview).toHaveBeenLastCalledWith("/workspace/file.ts");
    expect(hook.state.requestError).toBe(
      "agentChat.canvasWorkbench.coding.changes.toast.fullFileLoadFailed",
    );
    expect(hook.state.loadFullFile).toBe(false);
    expect(hook.state.fullFileContentById).toEqual({});
    await act(async () => {
      await hook.state.retryRequest();
    });
    expect(hook.state.requestError).toBeNull();
    expect(hook.state.loadFullFile).toBe(true);
    expect(hook.state.fullFileContentById).toEqual({ patch: "new\ntail" });
  });
  it("新基准请求开始后旧请求不覆盖内容、错误或 busy 状态", async () => {
    const old = deferred<ReturnType<typeof patch>>();
    const current = deferred<ReturnType<typeof patch>>();
    git.diff
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const hook = mount();
    act(() => {
      void hook.state.selectBase("staged");
    });
    act(() => {
      void hook.state.selectBase("branch");
    });
    await act(async () => {
      old.reject(new Error("stale failure"));
    });
    expect(hook.state.selectedBase).toBe("branch");
    expect(hook.state.reviewActionBusy).toBe(true);
    expect(hook.state.requestError).toBeNull();
    await act(async () => current.resolve(patch("branch.ts", "BRANCH")));
    expect(hook.state.changeItems.map((item) => item.path)).toEqual([
      "branch.ts",
    ]);
    expect(hook.state.reviewActionBusy).toBe(false);
  });

  it("commit SHA 切换使旧 commit diff 失效", async () => {
    const first = deferred<ReturnType<typeof patch>>();
    const second = deferred<ReturnType<typeof patch>>();
    git.diff
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = mount();
    act(() =>
      hook.state.selectCommit({ sha: "one", shortSha: "one", subject: "One" }),
    );
    act(() =>
      hook.state.selectCommit({ sha: "two", shortSha: "two", subject: "Two" }),
    );
    await act(async () => second.resolve(patch("two.ts", "SECOND")));
    await act(async () => first.resolve(patch("one.ts", "FIRST")));
    expect(hook.state.selectedCommitSha).toBe("two");
    expect(hook.state.changeItems.map((item) => item.path)).toEqual(["two.ts"]);
  });

  it("workspace/thread 切换使旧 commit list 失效并允许新菜单重试", async () => {
    const old = deferred<{
      commits: Array<{ sha: string; shortSha: string; subject: string }>;
    }>();
    git.commits.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      commits: [{ sha: "new", shortSha: "new", subject: "New" }],
    });
    const hook = mount({
      workspaceRoot: "/old",
      changeView: { reviewThreadId: "old", items: [] },
    });
    act(() => hook.state.openCommitMenu());
    hook.render({
      workspaceRoot: "/new",
      changeView: { reviewThreadId: "new", items: [] },
    });
    act(() => hook.state.openCommitMenu());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () =>
      old.resolve({
        commits: [{ sha: "old", shortSha: "old", subject: "Old" }],
      }),
    );
    expect(hook.state.commitOptions.map((commit) => commit.sha)).toEqual([
      "new",
    ]);
    expect(git.commits).toHaveBeenLastCalledWith("/new", 30);
  });

  it("选择其他文件使迟到的全文结果失效且不终止新请求", async () => {
    const first = deferred<HarnessFilePreviewResult>();
    const second = deferred<HarnessFilePreviewResult>();
    const loadFilePreview = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = mount({ loadFilePreview });
    act(() => {
      void hook.state.toggleLoadFullFile({ id: "one", path: "one.ts" });
    });
    act(() => hook.state.invalidateFileRequest());
    act(() => {
      void hook.state.toggleLoadFullFile({ id: "two", path: "two.ts" });
    });
    await act(async () =>
      first.resolve({ content: "STALE" } as HarnessFilePreviewResult),
    );
    expect(hook.state.fullFileContentById).toEqual({});
    expect(hook.state.reviewActionBusy).toBe(true);
    await act(async () =>
      second.resolve({ content: "CURRENT" } as HarnessFilePreviewResult),
    );
    expect(hook.state.fullFileContentById).toEqual({ two: "CURRENT" });
    expect(hook.state.loadFullFile).toBe(true);
  });

  it("提交成功后只刷新对应工作区的审阅投影", async () => {
    git.diff.mockResolvedValue(patch("a.ts", "committed"));
    const hook = mount();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("lime:git-commit-completed", {
          detail: { rootPath: "/other" },
        }),
      );
      await Promise.resolve();
    });
    expect(git.diff).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("lime:git-commit-completed", {
          detail: { rootPath: "/workspace/" },
        }),
      );
      await Promise.resolve();
    });
    expect(git.diff).toHaveBeenCalledWith("/workspace", 3);
    expect(git.status).toHaveBeenCalledWith("/workspace");
    expect(hook.state.gitUncommittedFileCount).toBe(1);
  });

  it("创建分支成功后只刷新对应工作区的审阅投影", async () => {
    git.diff.mockResolvedValue(patch("a.ts", "created-branch"));
    const hook = mount();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("lime:git-branch-created", {
          detail: { rootPath: "/other" },
        }),
      );
      await Promise.resolve();
    });
    expect(git.diff).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("lime:git-branch-created", {
          detail: { rootPath: "/workspace/" },
        }),
      );
      await Promise.resolve();
    });
    expect(git.diff).toHaveBeenCalledWith("/workspace", 3);
    expect(git.status).toHaveBeenCalledWith("/workspace");
    expect(hook.state.gitUncommittedFileCount).toBe(1);
  });

  it("全文失败可重试；新 turn 不复用相同 id 的全文缓存", async () => {
    const loadFilePreview = vi
      .fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce({ content: "CURRENT" });
    const items = [{ id: "same", path: "same.ts" }];
    const hook = mount({
      loadFilePreview,
      changeView: { reviewThreadId: "thread", currentTurnId: "one", items },
    });
    await act(async () => {
      await hook.state.toggleLoadFullFile(items[0]);
    });
    expect(hook.state.requestError).toBe("read failed");
    await act(async () => {
      await hook.state.retryRequest();
    });
    expect(hook.state.fullFileContentById).toEqual({ same: "CURRENT" });
    hook.render({
      loadFilePreview,
      changeView: { reviewThreadId: "thread", currentTurnId: "two", items },
    });
    expect(hook.state.fullFileContentById).toEqual({});
    expect(hook.state.loadFullFile).toBe(false);
  });
});
