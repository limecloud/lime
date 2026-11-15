import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  GIT_BRANCH_CREATED_EVENT,
  GIT_BRANCH_CREATE_REQUEST_EVENT,
  GitBranchCreateDialogHost,
} from "./GitBranchCreateDialogHost";

const createProjectGitBranch = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api/projectGit", () => ({ createProjectGitBranch }));
vi.mock("sonner", () => ({ toast }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const STATUS = {
  rootPath: "/repo",
  repositoryRoot: "/repo",
  hasGitRepository: true,
  isWorktree: false,
  currentBranch: "feature/demo",
  branches: ["feature/demo", "main"],
  uncommittedFileCount: 0,
};

beforeEach(async () => {
  await changeLimeLocale("en-US");
  createProjectGitBranch.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function openDialog(rootPath?: string) {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(GIT_BRANCH_CREATE_REQUEST_EVENT, {
        detail: rootPath === undefined ? {} : { rootPath },
      }),
    );
    await Promise.resolve();
  });
}

function dialog() {
  return document.querySelector('[data-testid="git-branch-create-dialog"]');
}

function nameInput() {
  return document.querySelector<HTMLInputElement>(
    '[data-testid="git-branch-create-name"]',
  )!;
}

function confirmButton() {
  return document.querySelector<HTMLButtonElement>(
    '[data-testid="git-branch-create-confirm"]',
  )!;
}

async function typeBranch(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(nameInput(), value);
    nameInput().dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function renderHost() {
  await act(async () => {
    root.render(<GitBranchCreateDialogHost />);
    await Promise.resolve();
  });
}

describe("GitBranchCreateDialogHost", () => {
  it("waits for explicit confirmation and refreshes Git state after success", async () => {
    createProjectGitBranch.mockResolvedValueOnce(STATUS);
    const created: CustomEvent[] = [];
    const onCreated = (event: Event) => created.push(event as CustomEvent);
    window.addEventListener(GIT_BRANCH_CREATED_EVENT, onCreated);
    await renderHost();

    await openDialog("/repo/");
    expect(dialog()).not.toBeNull();
    expect(createProjectGitBranch).not.toHaveBeenCalled();

    await typeBranch("  feature/demo  ");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(createProjectGitBranch).toHaveBeenCalledTimes(1);
    expect(createProjectGitBranch).toHaveBeenCalledWith(
      "/repo/",
      "feature/demo",
    );
    expect(toast.success).toHaveBeenCalledWith("Created branch feature/demo");
    expect(created).toHaveLength(1);
    expect(created[0].detail).toEqual({
      rootPath: "/repo/",
      branch: "feature/demo",
      status: STATUS,
    });
    expect(dialog()).toBeNull();
    window.removeEventListener(GIT_BRANCH_CREATED_EVENT, onCreated);
  });

  it("keeps the dialog open and shows the backend error on failure", async () => {
    createProjectGitBranch.mockRejectedValueOnce(
      new Error("分支已存在: feature/demo"),
    );
    await renderHost();

    await openDialog("/repo");
    await typeBranch("feature/demo");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(dialog()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="git-branch-create-error"]')
        ?.textContent,
    ).toBe("分支已存在: feature/demo");
    expect(confirmButton().disabled).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("rejects invalid branch names without calling the API", async () => {
    await renderHost();
    await openDialog("/repo");
    await typeBranch("bad..branch");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(createProjectGitBranch).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("reports a missing workspace without opening the dialog", async () => {
    await renderHost();
    await openDialog();

    expect(dialog()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "No workspace available to create a branch",
    );
    expect(createProjectGitBranch).not.toHaveBeenCalled();
  });
});
