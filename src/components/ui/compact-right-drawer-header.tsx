import React, {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const COMPACT_RIGHT_DRAWER_ICON_BUTTON_CLASSNAME =
  "inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/90 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50";

interface CompactRightDrawerHeaderProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow: string;
  heading: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function CompactRightDrawerHeader({
  eyebrow,
  heading,
  subtitle,
  meta,
  icon,
  actions,
  children,
  className,
  ...props
}: CompactRightDrawerHeaderProps) {
  return (
    <div
      className={cn(
        "border-b border-slate-200/80 bg-gradient-to-b from-white via-white to-slate-50/90 px-3 py-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-500">
            {icon ? (
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-slate-500">
                {icon}
              </span>
            ) : null}
            <span className="truncate">{eyebrow}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {heading}
          </div>
          {subtitle ? (
            <div className="mt-1 line-clamp-2 text-xs text-slate-500">
              {subtitle}
            </div>
          ) : null}
          {meta ? (
            <div className="mt-1 line-clamp-2 break-all text-xs text-slate-500">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

interface CompactRightDrawerIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function CompactRightDrawerIconButton({
  className,
  type = "button",
  children,
  ...props
}: CompactRightDrawerIconButtonProps) {
  return (
    <button
      type={type}
      className={cn(COMPACT_RIGHT_DRAWER_ICON_BUTTON_CLASSNAME, className)}
      {...props}
    >
      {children}
    </button>
  );
}
