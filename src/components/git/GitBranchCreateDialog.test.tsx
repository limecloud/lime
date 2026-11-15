import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { GitBranchCreateDialog } from "./GitBranchCreateDialog";
import {
  GIT_BRANCH_NAME_MAX_LENGTH,
  validateGitBranchName,
} from "./gitBranchName";

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
  props: Partial<Parameters<typeof GitBranchCreateDialog>[0]>,
) {
  act(() =>
    root.render(
      <GitBranchCreateDialog
        open
        rootPath="/repo"
        onOpenChange={() => {}}
        onConfirm={() => {}}
        {...props}
      />,
    ),
  );
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

describe("GitBranchCreateDialog", () => {
  it("validates branch names before allowing creation", async () => {
    renderDialog({});
    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="git-branch-create-validation"]')
        ?.textContent,
    ).toBe("Branch name is required");

    for (const invalid of [
      "bad name",
      "-leading-dash",
      "bad..name",
      "bad\u0007name",
    ]) {
      await typeBranch(invalid);
      expect(confirmButton().disabled).toBe(true);
      expect(
        document.querySelector('[data-testid="git-branch-create-validation"]')
          ?.textContent,
      ).toContain("without whitespace");
    }

    await typeBranch("a".repeat(GIT_BRANCH_NAME_MAX_LENGTH + 1));
    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="git-branch-create-validation"]')
        ?.textContent,
    ).toContain("200 characters or fewer");
  });

  it("trims the branch before confirming", async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });

    await typeBranch("  feature/demo  ");
    expect(confirmButton().disabled).toBe(false);
    expect(
      document.querySelector('[data-testid="git-branch-create-name-count"]')
        ?.textContent,
    ).toBe("16/200");

    await act(async () => {
      confirmButton().click();
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledWith("feature/demo");
  });

  it("shows pending and backend error states without closing", async () => {
    renderDialog({ pending: true, error: "branch already exists" });

    expect(nameInput().disabled).toBe(true);
    expect(confirmButton().disabled).toBe(true);
    expect(confirmButton().textContent).toContain("Creating…");
    expect(
      document.querySelector('[data-testid="git-branch-create-error"]')
        ?.textContent,
    ).toBe("branch already exists");
  });
});

describe("validateGitBranchName", () => {
  it("matches the App Server branch-name contract", () => {
    expect(validateGitBranchName("   ")).toBe("required");
    expect(validateGitBranchName("-feature")).toBe("invalid");
    expect(validateGitBranchName("feature..next")).toBe("invalid");
    expect(validateGitBranchName("feature next")).toBe("invalid");
    expect(validateGitBranchName("feature\nnext")).toBe("invalid");
    expect(
      validateGitBranchName("a".repeat(GIT_BRANCH_NAME_MAX_LENGTH + 1)),
    ).toBe("tooLong");
    expect(validateGitBranchName("feature/demo")).toBeNull();
    expect(validateGitBranchName("  feature/demo  ")).toBeNull();
  });
});
