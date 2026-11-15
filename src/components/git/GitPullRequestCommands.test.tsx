import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { runCommand } from "@/lib/commands/registry";
import { GitPullRequestCommands } from "./GitPullRequestCommands";
import { GIT_PULL_REQUEST_CREATE_REQUEST_EVENT } from "./GitPullRequestDialogHost";
import { GIT_PULL_REQUEST_MERGE_REQUEST_EVENT } from "./GitPullRequestMergeDialogHost";

const openProjectGitPullRequest = vi.hoisted(() => vi.fn());
const readProjectGitPullRequest = vi.hoisted(() => vi.fn());
const readProjectGitStatus = vi.hoisted(() => vi.fn());
const mergeProjectGitPullRequest = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/api/projectGit", () => ({
  openProjectGitPullRequest,
  readProjectGitPullRequest,
  readProjectGitStatus,
  mergeProjectGitPullRequest,
}));
vi.mock("sonner", () => ({ toast }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  openProjectGitPullRequest.mockReset();
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

describe("GitPullRequestCommands", () => {
  it("registers both create commands with the active workspace and draft flag", () => {
    const requests: CustomEvent[] = [];
    const onRequest = (event: Event) => requests.push(event as CustomEvent);
    window.addEventListener(GIT_PULL_REQUEST_CREATE_REQUEST_EVENT, onRequest);
    act(() => root.render(<GitPullRequestCommands cwd="  /repo  " />));

    let ran = false;
    act(() => {
      ran = runCommand("git.createPullRequest");
    });
    expect(ran).toBe(true);
    act(() => {
      ran = runCommand("git.createDraftPullRequest");
    });
    expect(ran).toBe(true);

    expect(requests).toHaveLength(2);
    expect(requests[0].detail).toEqual({ rootPath: "/repo", draft: false });
    expect(requests[1].detail).toEqual({ rootPath: "/repo", draft: true });
    window.removeEventListener(GIT_PULL_REQUEST_CREATE_REQUEST_EVENT, onRequest);
  });

  it("opens the merge dialog without invoking the merge API", () => {
    const requests: CustomEvent[] = [];
    const onRequest = (event: Event) => requests.push(event as CustomEvent);
    window.addEventListener(GIT_PULL_REQUEST_MERGE_REQUEST_EVENT, onRequest);
    act(() => root.render(<GitPullRequestCommands cwd="  /repo  " />));

    let ran = false;
    act(() => {
      ran = runCommand("git.mergePullRequest");
    });

    expect(ran).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].detail).toEqual({ rootPath: "/repo" });
    expect(mergeProjectGitPullRequest).not.toHaveBeenCalled();
    window.removeEventListener(
      GIT_PULL_REQUEST_MERGE_REQUEST_EVENT,
      onRequest,
    );
  });

  it("opens the current branch pull request through the App Server API", async () => {
    openProjectGitPullRequest.mockResolvedValueOnce({
      rootPath: "/repo",
      url: "https://github.com/example/repo/pull/9",
    });
    act(() => root.render(<GitPullRequestCommands cwd="/repo" />));

    let ran = false;
    act(() => {
      ran = runCommand("git.openPullRequest");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ran).toBe(true);
    expect(openProjectGitPullRequest).toHaveBeenCalledWith("/repo");
    expect(toast.success).toHaveBeenCalledWith(
      "Opened https://github.com/example/repo/pull/9",
    );
  });

  it("shows the backend error when opening fails", async () => {
    openProjectGitPullRequest.mockRejectedValueOnce(
      new Error("no pull requests found for branch"),
    );
    act(() => root.render(<GitPullRequestCommands cwd="/repo" />));

    act(() => {
      runCommand("git.openPullRequest");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "no pull requests found for branch",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("stays unavailable without a workspace root", () => {
    act(() => root.render(<GitPullRequestCommands cwd="   " />));
    for (const command of [
      "git.createPullRequest",
      "git.createDraftPullRequest",
      "git.mergePullRequest",
      "git.openPullRequest",
    ]) {
      let ran = false;
      act(() => {
        ran = runCommand(command);
      });
      expect(ran).toBe(false);
    }
  });
});
