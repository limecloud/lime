import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  GIT_PULL_REQUEST_BODY_MAX_BYTES,
  GIT_PULL_REQUEST_TITLE_MAX_LENGTH,
  GitPullRequestDialog,
} from "./GitPullRequestDialog";

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

function renderDialog(
  props: Partial<Parameters<typeof GitPullRequestDialog>[0]>,
) {
  act(() =>
    root.render(
      <GitPullRequestDialog
        open
        rootPath="/repo"
        onOpenChange={() => {}}
        onConfirm={() => {}}
        onOpenCreated={() => {}}
        {...props}
      />,
    ),
  );
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

function baseInput() {
  return document.querySelector<HTMLInputElement>(
    '[data-testid="git-pull-request-base"]',
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

describe("GitPullRequestDialog", () => {
  it("validates title, body and base before allowing creation", async () => {
    renderDialog({});
    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="git-pull-request-validation"]')
        ?.textContent,
    ).toBe("Pull request title is required");

    await typeInto(titleInput(), "bad\u0007line");
    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="git-pull-request-validation"]')
        ?.textContent,
    ).toBe("Title cannot contain control characters or line breaks");

    await typeInto(titleInput(), "a".repeat(GIT_PULL_REQUEST_TITLE_MAX_LENGTH + 1));
    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="git-pull-request-validation"]')
        ?.textContent,
    ).toContain("256 characters or fewer");

    await typeInto(titleInput(), "feat: demo");
    await typeInto(bodyInput(), "a".repeat(GIT_PULL_REQUEST_BODY_MAX_BYTES + 1));
    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="git-pull-request-validation"]')
        ?.textContent,
    ).toContain("65536 bytes or fewer");

    await typeInto(bodyInput(), "Body");
    await typeInto(baseInput(), "-leading");
    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="git-pull-request-validation"]')
        ?.textContent,
    ).toContain("valid base branch");
  });

  it("trims the title and base and submits the draft preset", async () => {
    const onConfirm = vi.fn();
    renderDialog({ initialDraft: true, onConfirm });
    expect(
      document.querySelector('[data-testid="git-pull-request-dialog"]')
        ?.textContent,
    ).toContain("Create draft pull request");

    await typeInto(titleInput(), "  feat: demo  ");
    await typeInto(bodyInput(), "Body");
    await typeInto(baseInput(), "  main  ");
    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith({
      title: "feat: demo",
      body: "Body",
      draft: true,
      base: "main",
    });
  });

  it("shows the created URL and opens it in the browser", async () => {
    const onOpenCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({
      created: {
        url: "https://github.com/example/repo/pull/42",
        number: 42,
        title: "feat: demo",
        draft: false,
      },
      onOpenCreated,
      onOpenChange,
    });

    expect(
      document.querySelector('[data-testid="git-pull-request-created"]')
        ?.textContent,
    ).toContain("Pull request #42 created");
    expect(
      document.querySelector('[data-testid="git-pull-request-created-url"]')
        ?.textContent,
    ).toBe("https://github.com/example/repo/pull/42");

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="git-pull-request-open"]',
        )!
        .click();
      await Promise.resolve();
    });
    expect(onOpenCreated).toHaveBeenCalledWith(
      "https://github.com/example/repo/pull/42",
    );

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="git-pull-request-close"]',
        )!
        .click();
      await Promise.resolve();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
