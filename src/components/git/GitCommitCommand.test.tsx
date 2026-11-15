import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "@/lib/commands/registry";
import { GitCommitCommand } from "./GitCommitCommand";
import { GIT_COMMIT_REQUEST_EVENT } from "./GitCommitDialogHost";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("GitCommitCommand", () => {
  it("registers git.commit and forwards the active workspace root", async () => {
    const requests: CustomEvent[] = [];
    const onRequest = (event: Event) => requests.push(event as CustomEvent);
    window.addEventListener(GIT_COMMIT_REQUEST_EVENT, onRequest);
    act(() => root.render(<GitCommitCommand cwd="  /repo  " />));

    let ran = false;
    act(() => {
      ran = runCommand("git.commit");
    });

    expect(ran).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].detail).toEqual({ rootPath: "/repo" });
    window.removeEventListener(GIT_COMMIT_REQUEST_EVENT, onRequest);
  });

  it("stays unavailable without a workspace root", () => {
    act(() => root.render(<GitCommitCommand cwd="   " />));
    let ran = false;
    act(() => {
      ran = runCommand("git.commit");
    });
    expect(ran).toBe(false);
  });
});
