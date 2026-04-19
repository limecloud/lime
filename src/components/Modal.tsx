import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Modal 内容区的额外 className */
  className?: string;
  /** 是否显示关闭按钮，默认 true */
  showCloseButton?: boolean;
  /** 点击遮罩是否关闭，默认 true */
  closeOnOverlayClick?: boolean;
  /** 内容区最大宽度，默认 max-w-lg */
  maxWidth?: string;
  /** 是否允许拖拽弹窗 */
  draggable?: boolean;
  /** 指定拖拽手柄选择器，仅命中该区域时才允许拖拽 */
  dragHandleSelector?: string;
}

export function Modal({
  isOpen,
  onClose,
  children,
  className = "",
  showCloseButton = true,
  closeOnOverlayClick = true,
  maxWidth = "max-w-lg",
  draggable = false,
  dragHandleSelector,
}: ModalProps) {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setDragOffset({ x: 0, y: 0 });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayClick = () => {
    if (closeOnOverlayClick) {
      onClose();
    }
  };

  const handleDragStart = (e: MouseEvent<HTMLDivElement>) => {
    if (!draggable) {
      return;
    }

    const target = e.target as HTMLElement | null;
    if (
      dragHandleSelector &&
      (!target || !target.closest(dragHandleSelector))
    ) {
      return;
    }

    const insideInteractive = Boolean(
      target?.closest(
        'button, a, input, textarea, select, [role="button"], [role="link"]',
      ),
    );
    const insideHandle = dragHandleSelector
      ? Boolean(target?.closest(dragHandleSelector))
      : true;

    if (insideInteractive && !insideHandle) {
      return;
    }

    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    };

    const originalUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) {
        return;
      }

      setDragOffset({
        x: state.originX + (moveEvent.clientX - state.startX),
        y: state.originY + (moveEvent.clientY - state.startY),
      });
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[linear-gradient(180deg,rgba(240,249,255,0.82)_0%,rgba(236,253,245,0.74)_52%,rgba(255,255,255,0.86)_100%)] backdrop-blur-[2px]"
      data-testid="modal-overlay"
      onClick={handleOverlayClick}
    >
      <div className="flex min-h-full items-start justify-center p-3 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          className={`relative my-4 flex w-full ${maxWidth} max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg bg-background shadow-xl sm:my-6 sm:max-h-[calc(100vh-3rem)] ${className}`}
          data-draggable={draggable ? "true" : "false"}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={handleDragStart}
          style={{
            transform:
              dragOffset.x !== 0 || dragOffset.y !== 0
                ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
                : undefined,
          }}
        >
          {showCloseButton && (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 z-10 rounded-lg p-1 hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Modal 标题区 */
export function ModalHeader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`shrink-0 border-b px-6 py-4 pr-12 ${className}`}>
      <h2 className="text-lg font-semibold">{children}</h2>
    </div>
  );
}

/** Modal 内容区 */
export function ModalBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto p-6 ${className}`}
      data-testid="modal-body"
    >
      {children}
    </div>
  );
}

/** Modal 底部操作区 */
export function ModalFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`shrink-0 flex flex-wrap justify-end gap-2 border-t px-6 py-4 ${className}`}
    >
      {children}
    </div>
  );
}
