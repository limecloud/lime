import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  GIT_PULL_REQUEST_CREATE_REQUEST_EVENT,
  GIT_PULL_REQUEST_CREATED_EVENT,
  GitPullRequestDialogHost,
} from "./GitPullRequestDialogHost";

const createProjectGitPullRequest = vi.hoisted(() => vi.fn());
const openExternalUrlWithSystemBrowser = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/api/projectGit", () => ({ createProjectGitPullRequest }));
vi.mock("@/lib/api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser,
}));
vi.mock("sonner", () => ({ toast }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  createProjectGitPullRequest.mockReset();
  openExternalUrlWithSystemBrowser.mockReset();
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

async function renderHost() {
  await act(async () => {
    root.render(<GitPullRequestDialogHost />);
    await Promise.resolve();
  });
}

async function openDialog(detail: { rootPath?: string; draft?: boolean } = {}) {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(GIT_PULL_REQUEST_CREATE_REQUEST_EVENT, { detail }),
    );
    await Promise.resolve();
  });
}

function dialog() {
  return document.querySelector('[data-testid="git-pull-request-dialog"]');
}

function titleInput() {
  return document.querySelector<HTMLInputElement>(
    '[data-testid="git-pull-request-title"]',
  )!;
}

function bodyInput() {
  return document.querySelector<HTMLTextAreaElement>(
    '[data-testid="git-pull-request-body"]',
  )!;
}

function confirmButton() {
  return document.querySelector<HTMLButtonElement>(
    '[data-testid="git-pull-request-confirm"]',
  )!;
}

async function typeInto(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("GitPullRequestDialogHost", () => {
  it("opens from the draft command, creates the PR and exposes the URL", async () => {
    createProjectGitPullRequest.mockResolvedValueOnce({
      rootPath: "/repo",
      url: "https://github.com/example/repo/pull/42",
      number: 42,
      title: "feat: host",
      draft: true,
    });
    const completed: CustomEvent[] = [];
    const onCompleted = (event: Event) => completed.push(event as CustomEvent);
    window.addEventListener(GIT_PULL_REQUEST_CREATED_EVENT, onCompleted);
    await renderHost();

    await openDialog({ rootPath: "/repo/", draft: true });
    expect(dialog()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="git-pull-request-dialog"]')
        ?.textContent,
    ).toContain("Create draft pull request");

    await typeInto(titleInput(), "  feat: host  ");
    await typeInto(bodyInput(), "Body");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(createProjectGitPullRequest).toHaveBeenCalledWith("/repo/", {
      title: "feat: host",
      body: "Body",
      draft: true,
      base: null,
    });
    expect(toast.success).toHaveBeenCalledWith("Created pull request #42");
    expect(completed).toHaveLength(1);
    expect(completed[0].detail).toMatchObject({
      rootPath: "/repo/",
      created: {
        rootPath: "/repo",
        number: 42,
        url: "https://github.com/example/repo/pull/42",
        draft: true,
      },
    });
    expect(
      document.querySelector('[data-testid="git-pull-request-created-url"]')
        ?.textContent,
    ).toBe("https://github.com/example/repo/pull/42");

    openExternalUrlWithSystemBrowser.mockResolvedValueOnce(undefined);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="git-pull-request-open"]',
        )!
        .click();
      await Promise.resolve();
    });
    expect(openExternalUrlWithSystemBrowser).toHaveBeenCalledWith(
      "https://github.com/example/repo/pull/42",
    );
    window.removeEventListener(GIT_PULL_REQUEST_CREATED_EVENT, onCompleted);
  });

  it("keeps the dialog open and shows the backend error on failure", async () => {
    createProjectGitPullRequest.mockRejectedValueOnce(
      new Error("GitHub CLI 未认证或认证已失效，请运行 `gh auth login`。"),
    );
    await renderHost();

    await openDialog({ rootPath: "/repo" });
    await typeInto(titleInput(), "feat: broken");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(dialog()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="git-pull-request-error"]')
        ?.textContent,
    ).toBe("GitHub CLI 未认证或认证已失效，请运行 `gh auth login`。");
    expect(confirmButton().disabled).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports a missing workspace without opening the dialog", async () => {
    await renderHost();
    await openDialog();

    expect(dialog()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "No workspace available to create a pull request",
    );
    expect(createProjectGitPullRequest).not.toHaveBeenCalled();
  });
});
