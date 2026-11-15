import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { GIT_BLAME_TOGGLE_EVENT } from "./GitBlameCommand";
import { GitBlameDialogHost } from "./GitBlameDialogHost";

const readProjectGitBlame = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/projectGit", () => ({ readProjectGitBlame }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const blameLine = {
  lineNumber: 7,
  sha: "0123456789abcdef0123456789abcdef01234567",
  shortSha: "0123456",
  author: "Blame Author",
  authorTime: "2020-01-02T03:04:05Z",
  summary: "feat: real blame",
  content: "const value = 1;",
};

beforeEach(async () => {
  await changeLimeLocale("en-US");
  readProjectGitBlame.mockReset();
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
    root.render(<GitBlameDialogHost />);
    await Promise.resolve();
  });
}

async function toggle(detail: { rootPath?: string; path?: string } = {}) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(GIT_BLAME_TOGGLE_EVENT, { detail }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dialog() {
  return document.querySelector('[data-testid="git-blame-dialog"]');
}

describe("GitBlameDialogHost", () => {
  it("loads the current file through readProjectGitBlame and renders every line", async () => {
    readProjectGitBlame.mockResolvedValueOnce({
      rootPath: "/repo",
      repositoryRoot: "/repo",
      lines: [blameLine],
    });
    await renderHost();

    await toggle({ rootPath: "  /repo  ", path: "src/main.ts" });

    expect(readProjectGitBlame).toHaveBeenCalledWith("/repo", "src/main.ts");
    expect(dialog()).not.toBeNull();
    expect(
      document.querySelector('[data-testid="git-blame-path"]')?.textContent,
    ).toBe("src/main.ts");
    const rows = document.querySelectorAll('[data-testid="git-blame-line"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("7");
    expect(rows[0].textContent).toContain("Blame Author");
    expect(rows[0].textContent).toContain("0123456");
    expect(
      rows[0].querySelector('[data-testid="git-blame-summary"]')?.textContent,
    ).toBe("feat: real blame");
    expect(
      rows[0].querySelector('[data-testid="git-blame-content"]')?.textContent,
    ).toBe("const value = 1;");
  });

  it("toggles the same file closed on a second command", async () => {
    readProjectGitBlame.mockResolvedValue({
      rootPath: "/repo",
      lines: [blameLine],
    });
    await renderHost();

    await toggle({ rootPath: "/repo", path: "src/main.ts" });
    expect(dialog()).not.toBeNull();

    await toggle({ rootPath: "/repo", path: "src/main.ts" });
    expect(dialog()).toBeNull();
  });

  it("switches to another file when a different path is requested", async () => {
    readProjectGitBlame.mockResolvedValue({
      rootPath: "/repo",
      lines: [blameLine],
    });
    await renderHost();

    await toggle({ rootPath: "/repo", path: "src/main.ts" });
    await toggle({ rootPath: "/repo", path: "src/other.ts" });

    expect(readProjectGitBlame).toHaveBeenLastCalledWith(
      "/repo",
      "src/other.ts",
    );
    expect(
      document.querySelector('[data-testid="git-blame-path"]')?.textContent,
    ).toBe("src/other.ts");
  });

  it("shows the empty state when Git returns no lines", async () => {
    readProjectGitBlame.mockResolvedValueOnce({
      rootPath: "/repo",
      lines: [],
    });
    await renderHost();

    await toggle({ rootPath: "/repo", path: "empty.ts" });

    expect(
      document.querySelector('[data-testid="git-blame-empty"]')?.textContent,
    ).toContain("no blame lines");
    expect(document.querySelector('[data-testid="git-blame-line"]')).toBeNull();
  });

  it("shows the backend error and retries the same file", async () => {
    readProjectGitBlame
      .mockRejectedValueOnce(new Error("文件未纳入 Git 跟踪"))
      .mockResolvedValueOnce({ rootPath: "/repo", lines: [blameLine] });
    await renderHost();

    await toggle({ rootPath: "/repo", path: "untracked.ts" });

    expect(
      document.querySelector('[data-testid="git-blame-error"]')?.textContent,
    ).toContain("文件未纳入 Git 跟踪");

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="git-blame-retry"]')!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readProjectGitBlame).toHaveBeenCalledTimes(2);
    expect(readProjectGitBlame).toHaveBeenLastCalledWith(
      "/repo",
      "untracked.ts",
    );
    expect(
      document.querySelectorAll('[data-testid="git-blame-line"]'),
    ).toHaveLength(1);
  });
});
