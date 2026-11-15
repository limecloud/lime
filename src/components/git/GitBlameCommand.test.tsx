import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { runCommand } from "@/lib/commands/registry";
import {
  GIT_BLAME_TOGGLE_EVENT,
  GitBlameCommand,
  type GitBlameToggleDetail,
} from "./GitBlameCommand";

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

describe("GitBlameCommand", () => {
  it("registers git.toggleBlame for the active file and dispatches its path", () => {
    const requests: GitBlameToggleDetail[] = [];
    const onRequest = (event: Event) =>
      requests.push((event as CustomEvent<GitBlameToggleDetail>).detail);
    window.addEventListener(GIT_BLAME_TOGGLE_EVENT, onRequest);
    act(() =>
      root.render(
        <GitBlameCommand rootPath="  /repo  " filePath="src/main.ts" />,
      ),
    );

    let ran = false;
    act(() => {
      ran = runCommand("git.toggleBlame");
    });

    expect(ran).toBe(true);
    expect(requests).toEqual([{ rootPath: "/repo", path: "src/main.ts" }]);
    window.removeEventListener(GIT_BLAME_TOGGLE_EVENT, onRequest);
  });

  it("converts an absolute workspace file path to a repository-relative path", () => {
    const requests: GitBlameToggleDetail[] = [];
    const onRequest = (event: Event) =>
      requests.push((event as CustomEvent<GitBlameToggleDetail>).detail);
    window.addEventListener(GIT_BLAME_TOGGLE_EVENT, onRequest);
    act(() =>
      root.render(
        <GitBlameCommand rootPath="/repo" filePath="/repo/src/main.ts" />,
      ),
    );

    act(() => {
      runCommand("git.toggleBlame");
    });

    expect(requests).toEqual([{ rootPath: "/repo", path: "src/main.ts" }]);
    window.removeEventListener(GIT_BLAME_TOGGLE_EVENT, onRequest);
  });

  it("has no command for a file outside the workspace root", () => {
    act(() =>
      root.render(
        <GitBlameCommand rootPath="/repo" filePath="/elsewhere/main.ts" />,
      ),
    );
    let ran = false;
    act(() => {
      ran = runCommand("git.toggleBlame");
    });
    expect(ran).toBe(false);
  });

  it("has no command when no file is open", () => {
    act(() =>
      root.render(<GitBlameCommand rootPath="/repo" filePath={null} />),
    );
    let ran = false;
    act(() => {
      ran = runCommand("git.toggleBlame");
    });
    expect(ran).toBe(false);
  });

  it("has no command for a hidden file tab", () => {
    act(() =>
      root.render(
        <GitBlameCommand
          rootPath="/repo"
          filePath="src/main.ts"
          active={false}
        />,
      ),
    );
    let ran = false;
    act(() => {
      ran = runCommand("git.toggleBlame");
    });
    expect(ran).toBe(false);
  });

  it("has no command without a workspace root", () => {
    act(() =>
      root.render(<GitBlameCommand rootPath=" " filePath="src/main.ts" />),
    );
    let ran = false;
    act(() => {
      ran = runCommand("git.toggleBlame");
    });
    expect(ran).toBe(false);
  });
});
