import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  GIT_PULL_REQUEST_MERGE_REQUEST_EVENT,
  GitPullRequestMergeDialogHost,
} from "./GitPullRequestMergeDialogHost";

const readProjectGitStatus = vi.hoisted(() => vi.fn());
const readProjectGitPullRequest = vi.hoisted(() => vi.fn());
const mergeProjectGitPullRequest = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/api/projectGit", () => ({
  readProjectGitStatus,
  readProjectGitPullRequest,
  mergeProjectGitPullRequest,
}));
vi.mock("sonner", () => ({ toast }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const pullRequest = {
  number: 42,
  url: "https://github.com/example/repo/pull/42",
  title: "feat: merge support",
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "feature/merge",
};

beforeEach(async () => {
  await changeLimeLocale("en-US");
  readProjectGitStatus.mockReset();
  readProjectGitPullRequest.mockReset();
  mergeProjectGitPullRequest.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  readProjectGitStatus.mockResolvedValue({
    rootPath: "/repo",
    hasGitRepository: true,
    currentBranch: "feature/merge",
    branches: ["main", "feature/merge"],
    uncommittedFileCount: 0,
  });
  readProjectGitPullRequest.mockResolvedValue({
    rootPath: "/repo",
    pullRequest,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderHost() {
  await act(async () => {
    root.render(<GitPullRequestMergeDialogHost />);
    await Promise.resolve();
  });
}

async function openDialog(detail: { rootPath?: string } = {}) {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(GIT_PULL_REQUEST_MERGE_REQUEST_EVENT, { detail }),
    );
  });
  await flush();
}

function testId<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`[data-testid="${id}"]`)!;
}

describe("GitPullRequestMergeDialogHost", () => {
  it("loads the current pull request and merges only after confirmation", async () => {
    mergeProjectGitPullRequest.mockResolvedValueOnce({
      rootPath: "/repo",
      method: "merge",
      deleteBranch: false,
      merged: true,
      number: 42,
      url: "https://github.com/example/repo/pull/42",
    });
    await renderHost();
    await openDialog({ rootPath: "  /repo  " });

    expect(readProjectGitStatus).toHaveBeenCalledWith("/repo");
    expect(readProjectGitPullRequest).toHaveBeenCalledWith("/repo");
    expect(testId("git-pull-request-merge-current").textContent).toContain(
      "Pull request #42",
    );
    expect(testId("git-pull-request-merge-branch").textContent).toBe(
      "Current branch: feature/merge",
    );
    expect(mergeProjectGitPullRequest).not.toHaveBeenCalled();

    await act(async () => {
      testId<HTMLButtonElement>("git-pull-request-merge-confirm").click();
      await Promise.resolve();
    });
    await flush();

    expect(mergeProjectGitPullRequest).toHaveBeenCalledWith("/repo", {
      method: "merge",
      deleteBranch: false,
    });
    expect(toast.success).toHaveBeenCalledWith("Merged pull request #42");
    expect(testId("git-pull-request-merge-success").textContent).toContain(
      "Pull request #42 merged",
    );
  });

  it("keeps the dialog open and shows a merge failure", async () => {
    mergeProjectGitPullRequest.mockRejectedValueOnce(
      new Error("Pull Request 存在合并冲突，无法合并。"),
    );
    await renderHost();
    await openDialog({ rootPath: "/repo" });

    await act(async () => {
      testId<HTMLButtonElement>("git-pull-request-merge-confirm").click();
      await Promise.resolve();
    });
    await flush();

    expect(testId("git-pull-request-merge-error").textContent).toBe(
      "Pull Request 存在合并冲突，无法合并。",
    );
    expect(
      testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled,
    ).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not allow merging when the branch has no pull request", async () => {
    readProjectGitPullRequest.mockResolvedValueOnce({
      rootPath: "/repo",
      pullRequest: null,
    });
    await renderHost();
    await openDialog({ rootPath: "/repo" });

    expect(testId("git-pull-request-merge-no-pull-request").textContent).toBe(
      "No pull request found for the current branch.",
    );
    expect(
      testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled,
    ).toBe(true);
    expect(mergeProjectGitPullRequest).not.toHaveBeenCalled();
  });

  it("shows a load error when gh status fails", async () => {
    readProjectGitPullRequest.mockRejectedValueOnce(
      new Error("GitHub CLI 未认证或认证已失效，请运行 `gh auth login`。"),
    );
    await renderHost();
    await openDialog({ rootPath: "/repo" });

    expect(testId("git-pull-request-merge-load-error").textContent).toBe(
      "GitHub CLI 未认证或认证已失效，请运行 `gh auth login`。",
    );
    expect(
      testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled,
    ).toBe(true);
  });

  it("reports a missing workspace without opening the dialog", async () => {
    await renderHost();
    await openDialog();

    expect(
      document.querySelector('[data-testid="git-pull-request-merge-dialog"]'),
    ).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "No workspace available to merge a pull request",
    );
    expect(readProjectGitPullRequest).not.toHaveBeenCalled();
  });
});
