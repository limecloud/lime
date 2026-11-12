import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasWorkbenchChangesFileList } from "./CanvasWorkbenchChangesFileList";
import type {
  CanvasWorkbenchChangeItem,
  CanvasWorkbenchChangeTreeNode,
} from "./CanvasWorkbenchChangesPanelViewModel";

function buildNode(
  changeKind: string,
  overrides: Partial<CanvasWorkbenchChangeItem> = {},
): CanvasWorkbenchChangeTreeNode {
  return {
    type: "file",
    id: "file-1",
    name: "alignment-check.txt",
    path: ".lime/qc/alignment-check.txt",
    depth: 0,
    item: {
      id: "change-1",
      path: ".lime/qc/alignment-check.txt",
      absolutePath: "/tmp/alignment-check.txt",
      changeKind,
      diffLines: [
        { type: "add", value: "hello", newLineNumber: 1 },
      ],
      ...overrides,
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function openContextMenuOnRow() {
  const row = container.querySelector<HTMLButtonElement>(
    '[data-testid="canvas-workbench-change-item"]',
  );
  expect(row).not.toBeNull();
  act(() => {
    row?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
  });
}

describe("CanvasWorkbenchChangesFileList delete action", () => {
  it("offers reveal and delete for an added file and calls the handlers", () => {
    const onDeleteFile = vi.fn();
    const onRevealFile = vi.fn();
    act(() =>
      root.render(
        <CanvasWorkbenchChangesFileList
          fileTree={[buildNode("added")]}
          selectedChangeItem={undefined}
          fileFilter=""
          translateWorkbench={(key) => key}
          onDeleteFile={onDeleteFile}
          onRevealFile={onRevealFile}
        />,
      ),
    );
    openContextMenuOnRow();
    const deleteButton = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-workbench-change-context-delete"]',
    );
    expect(deleteButton).not.toBeNull();
    const revealButton = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-workbench-change-context-reveal"]',
    );
    expect(revealButton).not.toBeNull();
    act(() => revealButton?.click());
    expect(onRevealFile).toHaveBeenCalledTimes(1);

    openContextMenuOnRow();
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="canvas-workbench-change-context-delete"]',
        )
        ?.click(),
    );
    expect(onDeleteFile).toHaveBeenCalledTimes(1);
  });

  it("does not offer delete for a modified file", () => {
    act(() =>
      root.render(
        <CanvasWorkbenchChangesFileList
          fileTree={[buildNode("modified")]}
          selectedChangeItem={undefined}
          fileFilter=""
          translateWorkbench={(key) => key}
          onDeleteFile={vi.fn()}
        />,
      ),
    );
    openContextMenuOnRow();
    expect(
      document.body.querySelector(
        '[data-testid="canvas-workbench-change-context-delete"]',
      ),
    ).toBeNull();
  });
});
