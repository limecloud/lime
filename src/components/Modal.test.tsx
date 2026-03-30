import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./Modal";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function renderModal() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <Modal
        isOpen={true}
        onClose={() => {}}
        draggable={true}
        dragHandleSelector='[data-drag-handle="true"]'
      >
        <ModalHeader>
          <div data-drag-handle="true">拖拽头部</div>
        </ModalHeader>
        <ModalBody>
          <div>弹窗内容</div>
        </ModalBody>
        <ModalFooter>
          <button type="button">保存</button>
        </ModalFooter>
      </Modal>,
    );
  });

  const mounted = { container, root };
  mountedRoots.push(mounted);
  return mounted;
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
});

describe("Modal", () => {
  it("启用 draggable 时应支持通过手柄拖动弹窗", () => {
    renderModal();

    const dragHandle = document.body.querySelector(
      '[data-drag-handle="true"]',
    ) as HTMLDivElement | null;
    const modalSurface = document.body.querySelector(
      '[data-draggable="true"]',
    ) as HTMLDivElement | null;

    act(() => {
      dragHandle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 20,
          clientY: 30,
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 70,
          clientY: 90,
        }),
      );
    });

    expect(modalSurface?.style.transform).toBe("translate(50px, 60px)");

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  });

  it("应为小屏场景提供可滚动的遮罩层与内容区", () => {
    renderModal();

    const overlay = document.body.querySelector(
      '[data-testid="modal-overlay"]',
    ) as HTMLDivElement | null;
    const dialog = document.body.querySelector(
      '[role="dialog"]',
    ) as HTMLDivElement | null;
    const body = document.body.querySelector(
      '[data-testid="modal-body"]',
    ) as HTMLDivElement | null;

    expect(overlay?.className).toContain("overflow-y-auto");
    expect(dialog?.className).toContain("max-h-[calc(100vh-2rem)]");
    expect(dialog?.className).toContain("flex-col");
    expect(body?.className).toContain("flex-1");
    expect(body?.className).toContain("overflow-y-auto");
    expect(body?.className).toContain("min-h-0");
  });
});
