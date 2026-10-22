import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileTreeResize } from "./useFileTreeResize";

let container: HTMLDivElement, root: Root, containerWidth: number;
let resize: ReturnType<typeof useFileTreeResize>;
function Harness() {
  const [open, setOpen] = useState(true);
  resize = useFileTreeResize(open, () => setOpen(false));
  return (
    <div
      data-testid="canvas-workbench-changes-content"
      data-file-tree-container
      style={resize.filesPanelGridStyle}
    >
      <input defaultValue="Retain selected diff state" />
      {open ? (
        <>
          <div
            role="separator"
            tabIndex={0}
            onPointerDown={resize.handleFilesPanelResizeStart}
            onPointerMove={resize.handleFilesPanelResizeMove}
            onPointerUp={resize.handleFilesPanelResizeEnd}
            onPointerCancel={resize.handleFilesPanelResizeEnd}
            onLostPointerCapture={resize.handleFilesPanelResizeEnd}
            onDoubleClick={resize.resetFilesPanelWidth}
            onKeyDown={resize.handleFilesPanelResizeKeyDown}
          />
          <div
            data-testid="canvas-workbench-changes-file-list"
            data-file-tree-panel
          />
        </>
      ) : null}
    </div>
  );
}
function pointer(type: string, x: number, id = 1, button = 0) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    button,
  });
  Object.defineProperties(event, {
    pointerId: { value: id },
    isPrimary: { value: true },
  });
  act(() =>
    container.querySelector('[role="separator"]')?.dispatchEvent(event),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  containerWidth = 600;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const width =
        this.dataset.testid === "canvas-workbench-changes-file-list"
          ? Math.min(containerWidth * 0.6, resize.filesPanelWidth)
          : containerWidth;
      return {
        x: 0,
        y: 0,
        width,
        height: 500,
        top: 0,
        left: 0,
        right: width,
        bottom: 500,
        toJSON: () => ({}),
      };
    },
  );
  vi.stubGlobal("innerWidth", 2000);
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
  act(() => resize.resetFilesPanelWidth());
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Review Files resize in its own pane", () => {
  it("shares the live width across file panes without persisting it", () => {
    function OtherPane() {
      const other = useFileTreeResize(true);
      return <output data-testid="other-width">{other.filesPanelWidth}</output>;
    }
    act(() =>
      root.render(
        <>
          <Harness />
          <OtherPane />
        </>,
      ),
    );
    pointer("pointerdown", 300);
    pointer("pointermove", 270);
    pointer("pointerup", 270);
    expect(resize.filesPanelWidth).toBe(280);
    expect(
      container.querySelector("[data-testid=other-width]")?.textContent,
    ).toBe("280");
    act(() => resize.resetFilesPanelWidth());
    expect(
      container.querySelector("[data-testid=other-width]")?.textContent,
    ).toBe("250");
  });

  it("clamps a drag to the pane instead of the wide window and keeps the same detail instance", () => {
    const detail = container.querySelector("input");
    pointer("pointerdown", 300);
    pointer("pointermove", 0);
    pointer("pointerup", 0);
    expect(resize.filesPanelWidth).toBe(360);
    expect(container.querySelector("input")).toBe(detail);
    expect(detail?.value).toBe("Retain selected diff state");
    act(() =>
      container
        .querySelector('[role="separator"]')!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(resize.filesPanelWidth).toBe(250);
  });

  it("resizes ten pixels with the keyboard and starts from the actual narrow-pane width", () => {
    const key = (value: string) =>
      act(() =>
        container.querySelector('[role="separator"]')!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: value,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    key("ArrowLeft");
    expect(resize.filesPanelWidth).toBe(260);
    key("ArrowRight");
    expect(resize.filesPanelWidth).toBe(250);
    containerWidth = 320;
    pointer("pointerdown", 300);
    pointer("pointermove", 305);
    pointer("pointerup", 305);
    expect(resize.filesPanelWidth).toBe(200);
    expect(container.firstElementChild?.getAttribute("style")).toContain(
      "min(60%, 200px)",
    );
  });

  it("ignores foreign pointers and non-primary buttons, ends cancelled drags, and closes only below the collapse threshold", () => {
    pointer("pointerdown", 300, 1, 2);
    pointer("pointermove", 0);
    expect(resize.filesPanelWidth).toBe(250);
    pointer("pointerdown", 300);
    pointer("pointermove", 0, 2);
    expect(resize.filesPanelWidth).toBe(250);
    pointer("pointercancel", 300);
    pointer("pointermove", 0);
    expect(resize.filesPanelWidth).toBe(250);
    pointer("pointerdown", 300);
    pointer("pointermove", 450); // exactly 100 stays open
    expect(container.querySelector('[role="separator"]')).not.toBeNull();
    pointer("pointermove", 451);
    expect(container.querySelector('[role="separator"]')).toBeNull();
    expect(container.querySelector("input")?.value).toBe(
      "Retain selected diff state",
    );
  });
});
