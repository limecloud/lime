import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasWorkbenchChangeDiffList } from "./CanvasWorkbenchChangeDiffList";
import type { CanvasWorkbenchChangeItem } from "./CanvasWorkbenchChangesPanelViewModel";

const item: CanvasWorkbenchChangeItem = {
  id: "change-1",
  path: ".lime/qc/alignment-check.txt",
  absolutePath: "/tmp/alignment-check.txt",
  changeKind: "added",
  diffLines: [{ type: "add", value: "hello", newLineNumber: 1 }],
};

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
  document.body.innerHTML = "";
});

describe("CanvasWorkbenchChangeDiffList file actions", () => {
  it("opens the file actions menu and triggers reveal/delete", () => {
    const onRevealFile = vi.fn();
    const onDeleteFile = vi.fn();
    const onOpenFile = vi.fn();
    act(() =>
      root.render(
        <CanvasWorkbenchChangeDiffList
          items={[item]}
          selectedChangeItem={item}
          translateWorkbench={(key) => key}
          collapseDiffContext={false}
          textDiffEnabled
          panelClassName=""
          diffVariant="inline"
          showWhitespace={false}
          wordWrapEnabled
          onOpenFile={onOpenFile}
          onRevealFile={onRevealFile}
          onDeleteFile={onDeleteFile}
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="canvas-workbench-diff-more-change-1"]',
    );
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());

    const reveal = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((entry) => entry.textContent?.includes("revealFile"));
    expect(reveal).not.toBeUndefined();
    act(() => reveal?.click());
    expect(onRevealFile).toHaveBeenCalledWith(item);
  });
});
