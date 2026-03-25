import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface TooltipContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

const TooltipContext = createContext<TooltipContextType | undefined>(undefined);

interface TooltipProviderProps {
  children: React.ReactNode;
}

const TooltipProvider: React.FC<TooltipProviderProps> = ({ children }) => {
  return <>{children}</>;
};

interface TooltipProps {
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <TooltipContext.Provider value={{ open, setOpen, anchorRef }}>
      <div ref={anchorRef} className="relative">
        {children}
      </div>
    </TooltipContext.Provider>
  );
};

interface TooltipTriggerProps {
  asChild?: boolean;
  children: React.ReactNode;
}

const TooltipTrigger: React.FC<TooltipTriggerProps> = ({
  asChild,
  children,
}) => {
  const context = useContext(TooltipContext);
  if (!context) throw new Error("TooltipTrigger must be used within Tooltip");

  const { setOpen } = context;

  const handleMouseEnter = () => setOpen(true);
  const handleMouseLeave = () => setOpen(false);

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    });
  }

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {children}
    </div>
  );
};

interface TooltipContentProps {
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}

interface TooltipPosition {
  top: number;
  left: number;
  transform?: string;
}

const TOOLTIP_OFFSET = 8;

function resolveTooltipPosition(
  rect: DOMRect,
  side: "top" | "right" | "bottom" | "left",
  align: "start" | "center" | "end",
): TooltipPosition {
  if (side === "right") {
    return {
      top:
        align === "start"
          ? rect.top
          : align === "end"
            ? rect.bottom
            : rect.top + rect.height / 2,
      left: rect.right + TOOLTIP_OFFSET,
      transform:
        align === "center"
          ? "translateY(-50%)"
          : align === "end"
            ? "translateY(-100%)"
            : undefined,
    };
  }

  if (side === "left") {
    return {
      top:
        align === "start"
          ? rect.top
          : align === "end"
            ? rect.bottom
            : rect.top + rect.height / 2,
      left: rect.left - TOOLTIP_OFFSET,
      transform:
        align === "center"
          ? "translate(-100%, -50%)"
          : align === "end"
            ? "translate(-100%, -100%)"
            : "translateX(-100%)",
    };
  }

  if (side === "bottom") {
    return {
      top: rect.bottom + TOOLTIP_OFFSET,
      left:
        align === "start"
          ? rect.left
          : align === "end"
            ? rect.right
            : rect.left + rect.width / 2,
      transform:
        align === "center"
          ? "translateX(-50%)"
          : align === "end"
            ? "translateX(-100%)"
            : undefined,
    };
  }

  return {
    top: rect.top - TOOLTIP_OFFSET,
    left:
      align === "start"
        ? rect.left
        : align === "end"
          ? rect.right
          : rect.left + rect.width / 2,
    transform:
      align === "center"
        ? "translate(-50%, -100%)"
        : align === "end"
          ? "translate(-100%, -100%)"
          : "translateY(-100%)",
  };
}

const TooltipContent: React.FC<TooltipContentProps> = ({
  className,
  side = "top",
  align = "center",
  children,
}) => {
  const context = useContext(TooltipContext);
  if (!context) throw new Error("TooltipContent must be used within Tooltip");

  const { open, anchorRef } = context;
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || typeof window === "undefined") {
      return;
    }

    const updatePosition = () => {
      if (!anchorRef.current) {
        return;
      }

      setPosition(resolveTooltipPosition(anchorRef.current.getBoundingClientRect(), side, align));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, anchorRef, open, side]);

  if (!open || !mounted || !position) return null;

  return createPortal(
    <div
      role="tooltip"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        transform: position.transform,
      }}
      className={cn(
        "lime-tooltip pointer-events-none z-50 whitespace-nowrap",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
};

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
