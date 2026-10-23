import { useRef, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  APP_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from "./AppSidebar.constants";

const MIN_WIDTH = 240;
const MAX_WIDTH = 520;

function constrainWidth(width: number, minimumWidth = MIN_WIDTH) {
  return Math.round(
    Math.max(minimumWidth, Math.min(width, MAX_WIDTH, window.innerWidth - 320)),
  );
}

export function SidebarResizeHandle({
  width,
  onWidthChange,
  minimumWidth = MIN_WIDTH,
  defaultWidth = APP_SIDEBAR_WIDTH,
}: {
  width: number;
  minimumWidth?: number;
  defaultWidth?: number;
  onWidthChange: (width: number) => void;
}) {
  const { t } = useTranslation("navigation");
  const drag = useRef<{ width: number; pointerId: number } | null>(null);
  const currentWidth = useRef(width);
  currentWidth.current = width;
  const commit = (nextWidth: number) => {
    const constrained = constrainWidth(nextWidth, minimumWidth);
    onWidthChange(constrained);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(constrained));
  };
  const finishDrag = (
    event: PointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (cancelled) onWidthChange(drag.current.width);
    else commit(currentWidth.current);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={String(t("navigation.sidebar.actions.resize"))}
      aria-orientation="vertical"
      aria-valuemin={minimumWidth}
      aria-valuemax={Math.max(
        minimumWidth,
        Math.min(MAX_WIDTH, window.innerWidth - 320),
      )}
      aria-valuenow={constrainWidth(width, minimumWidth)}
      data-testid="app-sidebar-resize"
      className="absolute inset-y-0 -right-1 z-40 w-2 cursor-col-resize touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { width, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const left =
          event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
        onWidthChange(constrainWidth(event.clientX - left, minimumWidth));
      }}
      onPointerUp={(event) => finishDrag(event, false)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onLostPointerCapture={(event) => finishDrag(event, true)}
      onDoubleClick={() => commit(defaultWidth)}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowLeft"
            ? width - 8
            : event.key === "ArrowRight"
              ? width + 8
              : event.key === "Home"
                ? minimumWidth
                : event.key === "End"
                  ? MAX_WIDTH
                  : null;
        if (next === null) return;
        event.preventDefault();
        commit(next);
      }}
    />
  );
}
