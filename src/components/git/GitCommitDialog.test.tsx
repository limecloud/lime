import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  GitCommitDialog,
  GIT_COMMIT_MESSAGE_MAX_LENGTH,
} from "./GitCommitDialog";

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

function renderDialog(props: Partial<Parameters<typeof GitCommitDialog>[0]>) {
  act(() =>
    root.render(
      <GitCommitDialog
        open
        rootPath="/repo"
        onOpenChange={() => {}}
        onConfirm={() => {}}
        {...props}
      />,
    ),
  );
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
    const input = messageInput();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("GitCommitDialog", () => {
  it("requires a non-empty message before confirmation", async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });

    expect(confirmButton().disabled).toBe(true);
    await typeMessage("   ");
    expect(confirmButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Commit message is required");

    await typeMessage("  feat: real commit  ");
    expect(confirmButton().disabled).toBe(false);
    await act(async () => confirmButton().click());
    expect(onConfirm).toHaveBeenCalledWith("feat: real commit");
  });

  it("renders pending and error states without allowing a second submit", async () => {
    const onConfirm = vi.fn();
    renderDialog({
      pending: true,
      error: "pre-commit hook failed",
      onConfirm,
    });

    expect(messageInput().disabled).toBe(true);
    expect(confirmButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Committing…");
    expect(document.body.textContent).toContain("pre-commit hook failed");
    await act(async () => confirmButton().click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("caps the message length and submits with the keyboard shortcut", async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });

    expect(messageInput().maxLength).toBe(GIT_COMMIT_MESSAGE_MAX_LENGTH);
    await typeMessage("fix: keyboard");
    await act(async () => {
      messageInput().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onConfirm).toHaveBeenCalledWith("fix: keyboard");
  });
});
