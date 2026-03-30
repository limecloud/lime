import React, { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputbarOverlayShell } from "./InputbarOverlayShell";
import type { A2UIResponse } from "@/lib/workspace/a2ui";

vi.mock("../../TaskFiles", () => ({
  TaskFileList: () => <div data-testid="task-file-list" />,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

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
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderShell(
  props?: Partial<React.ComponentProps<typeof InputbarOverlayShell>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InputbarOverlayShell
        showHintPopup={false}
        hintRoutes={[]}
        hintIndex={0}
        onHintSelect={vi.fn()}
        taskFiles={[
          {
            id: "file-1",
            name: "notes.md",
            type: "document",
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]}
        isSubmissionNoticeVisible={false}
        fileInputRef={createRef<HTMLInputElement>()}
        onFileSelect={vi.fn()}
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

function createPendingA2UIForm(): A2UIResponse {
  return {
    id: "a2ui-floating-form",
    version: "1.0",
    root: "root",
    data: {},
    components: [
      {
        id: "title",
        component: "Text",
        text: "请确认开始方式",
        variant: "body",
      },
      {
        id: "root",
        component: "Column",
        children: ["title"],
        gap: 12,
        align: "stretch",
      },
    ],
    submitAction: {
      label: "继续处理",
      action: { name: "submit" },
    },
  } as A2UIResponse;
}

describe("InputbarOverlayShell", () => {
  it("应把任务文件与额外浮层控件放进同一条透明 overlay row", () => {
    const container = renderShell({
      overlayAccessory: (
        <button type="button" data-testid="team-inline-toggle">
          查看协作进展 · 2
        </button>
      ),
    });

    const row = container.querySelector<HTMLElement>(
      '[data-testid="inputbar-secondary-controls"]',
    );

    expect(row).toBeTruthy();
    expect(getComputedStyle(row as HTMLElement).position).toBe("absolute");
    expect(getComputedStyle(row as HTMLElement).pointerEvents).toBe("none");
    expect(getComputedStyle(row as HTMLElement).zIndex).toBe("80");
    expect(
      row?.querySelector('[data-testid="task-files-panel-area"]'),
    ).toBeTruthy();
    expect(
      row?.querySelector('[data-testid="team-inline-toggle"]'),
    ).toBeTruthy();
  });

  it("没有任务文件和额外控件时不应渲染 overlay row", () => {
    const container = renderShell({
      taskFiles: [],
      overlayAccessory: null,
    });

    expect(
      container.querySelector('[data-testid="inputbar-secondary-controls"]'),
    ).toBeNull();
  });

  it("输入栏 overlay 不再承载 A2UI 表单与提交提示", () => {
    const container = renderShell({
      taskFiles: [],
      pendingA2UIForm: createPendingA2UIForm(),
      pendingA2UIFormStale: true,
      submissionNotice: {
        title: "补充信息已确认",
        summary: "已继续处理。",
      },
      isSubmissionNoticeVisible: true,
      onA2UISubmit: vi.fn(),
    });

    expect(container.textContent).not.toContain("继续处理");
    expect(container.textContent).not.toContain("同步中");
    expect(container.textContent).not.toContain("补充信息已确认");
  });
});
