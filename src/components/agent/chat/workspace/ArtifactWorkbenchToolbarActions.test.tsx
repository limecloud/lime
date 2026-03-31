import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactWorkbenchToolbarActions } from "./ArtifactWorkbenchToolbarActions";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderActions(
  overrides: Partial<
    React.ComponentProps<typeof ArtifactWorkbenchToolbarActions>
  > = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const props: React.ComponentProps<typeof ArtifactWorkbenchToolbarActions> = {
    showSaveToProject: true,
    saveToProjectDisabled: false,
    isSavingToProject: false,
    onSaveToProject: vi.fn(),
    onExportJson: vi.fn(),
    onExportHtml: vi.fn(),
    onExportMarkdown: vi.fn(),
    showArchiveToggle: true,
    isUpdatingArchive: false,
    archiveLabel: "归档",
    onToggleArchive: vi.fn(),
    ...overrides,
  };

  act(() => {
    root.render(<ArtifactWorkbenchToolbarActions {...props} />);
  });

  mountedRoots.push({ root, container });
  return {
    container,
    props,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.restoreAllMocks();
});

describe("ArtifactWorkbenchToolbarActions", () => {
  it("应渲染项目复用、导出与归档按钮", () => {
    const { container } = renderActions();

    expect(
      container.querySelector(
        '[data-testid="artifact-workbench-save-to-project"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-workbench-export-html"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="artifact-workbench-export-markdown"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="artifact-workbench-export-json"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="artifact-workbench-archive-toggle"]',
      ),
    ).not.toBeNull();
  });

  it("点击按钮时应回调对应动作", async () => {
    const onSaveToProject = vi.fn().mockResolvedValue(undefined);
    const onExportJson = vi.fn().mockResolvedValue(undefined);
    const onExportHtml = vi.fn().mockResolvedValue(undefined);
    const onExportMarkdown = vi.fn().mockResolvedValue(undefined);
    const onToggleArchive = vi.fn().mockResolvedValue(undefined);
    const { container } = renderActions({
      onSaveToProject,
      onExportJson,
      onExportHtml,
      onExportMarkdown,
      onToggleArchive,
    });

    const click = async (testId: string) => {
      const element = container.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLButtonElement | null;
      expect(element).not.toBeNull();
      await act(async () => {
        element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
    };

    await click("artifact-workbench-save-to-project");
    await click("artifact-workbench-export-html");
    await click("artifact-workbench-export-markdown");
    await click("artifact-workbench-export-json");
    await click("artifact-workbench-archive-toggle");

    expect(onSaveToProject).toHaveBeenCalledTimes(1);
    expect(onExportHtml).toHaveBeenCalledTimes(1);
    expect(onExportMarkdown).toHaveBeenCalledTimes(1);
    expect(onExportJson).toHaveBeenCalledTimes(1);
    expect(onToggleArchive).toHaveBeenCalledTimes(1);
  });

  it("保存中或处理中时应更新按钮文案", () => {
    const { container } = renderActions({
      isSavingToProject: true,
      isUpdatingArchive: true,
      archiveLabel: "取消归档",
    });

    expect(container.textContent).toContain("保存中");
    expect(container.textContent).toContain("处理中");
  });
});
