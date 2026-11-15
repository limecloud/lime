import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  GIT_COMMIT_COMPLETED_EVENT,
  GIT_COMMIT_REQUEST_EVENT,
  GitCommitDialogHost,
} from "./GitCommitDialogHost";

const commitProjectGitChanges = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api/projectGit", () => ({ commitProjectGitChanges }));
vi.mock("sonner", () => ({ toast }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  commitProjectGitChanges.mockReset();
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
      new CustomEvent(GIT_COMMIT_REQUEST_EVENT, {
        detail: rootPath === undefined ? {} : { rootPath },
      }),
    );
    await Promise.resolve();
  });
}

function dialog() {
  return document.querySelector('[data-testid="git-commit-dialog"]');
}

function messageInput() {
  return document.querySelector<HTMLTextAreaElement>(
    '[data-testid="git-commit-message"]',
  )!;
}

function confirmButton() {
  return document.querySelector<HTMLButtonElement>(
    '[data-testid="git-commit-confirm"]',
  )!;
}

async function typeMessage(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(messageInput(), value);
    messageInput().dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function renderHost() {
  await act(async () => {
    root.render(<GitCommitDialogHost />);
    await Promise.resolve();
  });
}

describe("GitCommitDialogHost", () => {
  it("opens from the command event and refreshes review after a confirmed commit", async () => {
    commitProjectGitChanges.mockResolvedValueOnce({
      rootPath: "/repo",
      sha: "1234567890abcdef",
      shortSha: "1234567",
      subject: "feat: host commit",
      status: "committed",
    });
    const completed: CustomEvent[] = [];
    const onCompleted = (event: Event) => completed.push(event as CustomEvent);
    window.addEventListener(GIT_COMMIT_COMPLETED_EVENT, onCompleted);
    await renderHost();

    await openDialog("/repo/");
    expect(dialog()).not.toBeNull();
    await typeMessage("  feat: host commit  ");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(commitProjectGitChanges).toHaveBeenCalledWith(
      "/repo/",
      "feat: host commit",
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Committed 1234567: feat: host commit",
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].detail).toEqual({
      rootPath: "/repo/",
      sha: "1234567890abcdef",
      shortSha: "1234567",
      subject: "feat: host commit",
    });
    expect(dialog()).toBeNull();
    window.removeEventListener(GIT_COMMIT_COMPLETED_EVENT, onCompleted);
  });

  it("keeps the dialog open and shows the backend error on failure", async () => {
    commitProjectGitChanges.mockRejectedValueOnce(
      new Error("pre-commit hook failed"),
    );
    await renderHost();

    await openDialog("/repo");
    await typeMessage("feat: broken");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(dialog()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="git-commit-error"]')?.textContent,
    ).toBe("pre-commit hook failed");
    expect(confirmButton().disabled).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports a missing workspace without opening the dialog", async () => {
    await renderHost();
    await openDialog();

    expect(dialog()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "No workspace available to commit",
    );
    expect(commitProjectGitChanges).not.toHaveBeenCalled();
  });
});
