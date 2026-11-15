import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { GitPullRequestMergeDialog } from "./GitPullRequestMergeDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

const pullRequest = {
  number: 42,
  url: "https://github.com/example/repo/pull/42",
  title: "feat: merge support",
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "feature/merge",
};

function renderDialog(
  props: Partial<Parameters<typeof GitPullRequestMergeDialog>[0]>,
) {
  act(() =>
    root.render(
      <GitPullRequestMergeDialog
        open
        rootPath="/repo"
        branch="feature/merge"
        pullRequest={pullRequest}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        {...props}
      />,
    ),
  );
}

function testId<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`[data-testid="${id}"]`)!;
}

describe("GitPullRequestMergeDialog", () => {
  it("shows the current pull request and branch before confirmation", () => {
    renderDialog({});

    expect(testId("git-pull-request-merge-dialog").textContent).toContain(
      "Merge pull request",
    );
    expect(testId("git-pull-request-merge-current").textContent).toContain(
      "Pull request #42",
    );
    expect(testId("git-pull-request-merge-current").textContent).toContain(
      "feat: merge support",
    );
    expect(testId("git-pull-request-merge-current").textContent).toContain(
      "feature/merge → main",
    );
    expect(testId("git-pull-request-merge-branch").textContent).toBe(
      "Current branch: feature/merge",
    );
    expect(testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled).toBe(
      false,
    );
  });

  it("does not confirm without a current pull request", () => {
    renderDialog({ pullRequest: null });

    expect(testId("git-pull-request-merge-no-pull-request").textContent).toBe(
      "No pull request found for the current branch.",
    );
    expect(testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled).toBe(
      true,
    );
  });

  it("submits the selected merge method and delete-branch option", async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    const select = testId<HTMLSelectElement>("git-pull-request-merge-method");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(select, "squash");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      testId<HTMLButtonElement>(
        "git-pull-request-merge-delete-branch",
      ).click();
      await Promise.resolve();
    });
    await act(async () => {
      testId<HTMLButtonElement>("git-pull-request-merge-confirm").click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith({
      method: "squash",
      deleteBranch: true,
    });
  });

  it("keeps the dialog open and shows the backend error on failure", () => {
    renderDialog({
      error: "Pull Request 存在合并冲突，无法合并。",
    });

    expect(testId("git-pull-request-merge-error").textContent).toBe(
      "Pull Request 存在合并冲突，无法合并。",
    );
    expect(testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled).toBe(
      false,
    );
  });

  it("disables confirmation while pending and shows the pending label", () => {
    renderDialog({ pending: true });

    expect(testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled).toBe(
      true,
    );
    expect(
      testId("git-pull-request-merge-confirm").textContent,
    ).toContain("Merging…");
  });

  it("shows the merged success state and closes without another merge", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({
      onConfirm,
      onOpenChange,
      merged: {
        rootPath: "/repo",
        method: "merge",
        deleteBranch: false,
        merged: true,
        number: 42,
        url: "https://github.com/example/repo/pull/42",
      },
    });

    expect(testId("git-pull-request-merge-success").textContent).toContain(
      "Pull request #42 merged",
    );
    expect(
      document.querySelector('[data-testid="git-pull-request-merge-confirm"]'),
    ).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => {
      testId<HTMLButtonElement>("git-pull-request-merge-close").click();
      await Promise.resolve();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a load error and disables confirmation", () => {
    renderDialog({
      pullRequest: null,
      loadError: "GitHub CLI 未认证或认证已失效，请运行 `gh auth login`。",
    });

    expect(testId("git-pull-request-merge-load-error").textContent).toBe(
      "GitHub CLI 未认证或认证已失效，请运行 `gh auth login`。",
    );
    expect(testId<HTMLButtonElement>("git-pull-request-merge-confirm").disabled).toBe(
      true,
    );
  });
});
