import React, { type ReactNode } from "react";
import { Loader2, Sparkles, type LucideIcon } from "lucide-react";
import { A2UI_TASK_CARD_TOKENS } from "./taskCardTokens";
import { cn } from "@/lib/utils";

export type A2UITaskCardSurface = "default" | "embedded";

export interface A2UITaskCardShellProps {
  children: ReactNode;
  compact?: boolean;
  className?: string;
  preview?: boolean;
  testId?: string;
  surface?: A2UITaskCardSurface;
}

export interface A2UITaskCardHeaderProps {
  title: string;
  subtitle: string;
  compact?: boolean;
  statusLabel?: string;
  statusIcon?: LucideIcon;
  headerActions?: React.ReactNode;
  surface?: A2UITaskCardSurface;
}

export interface A2UITaskCardBodyProps {
  children: ReactNode;
  compact?: boolean;
  className?: string;
  surface?: A2UITaskCardSurface;
}

export function A2UITaskCardShell({
  children,
  compact = false,
  className,
  preview = false,
  testId,
  surface = "default",
}: A2UITaskCardShellProps) {
  return (
    <div
      className={cn(
        surface === "embedded"
          ? A2UI_TASK_CARD_TOKENS.shellEmbedded
          : A2UI_TASK_CARD_TOKENS.shell,
        surface === "embedded"
          ? A2UI_TASK_CARD_TOKENS.shellEmbeddedPadding
          : compact
            ? A2UI_TASK_CARD_TOKENS.shellCompactPadding
            : A2UI_TASK_CARD_TOKENS.shellDefaultPadding,
        preview &&
          "[&_.a2ui-container_button]:pointer-events-none [&_.a2ui-container_input]:pointer-events-none [&_.a2ui-container_textarea]:pointer-events-none [&_.a2ui-container_input]:bg-slate-100 [&_.a2ui-container_textarea]:bg-slate-100 [&_.a2ui-container_button]:opacity-70",
        className,
      )}
      data-testid={testId}
      data-surface={surface}
    >
      {children}
    </div>
  );
}

export function A2UITaskCardStatusBadge({
  label,
  icon: Icon = Sparkles,
  compact = false,
  surface = "default",
}: {
  label: string;
  icon?: LucideIcon;
  compact?: boolean;
  surface?: A2UITaskCardSurface;
}) {
  return (
    <div
      className={cn(
        A2UI_TASK_CARD_TOKENS.statusBadge,
        compact &&
          surface === "embedded" &&
          "gap-1.5 px-2.5 py-0.5 text-[11px] leading-4",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

export function A2UITaskCardHeader({
  title,
  subtitle,
  compact = false,
  statusLabel,
  statusIcon,
  headerActions,
  surface = "default",
}: A2UITaskCardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1.5">
        <div
          className={cn(
            "font-semibold tracking-tight text-slate-900",
            compact && surface === "embedded"
              ? "text-base leading-6"
              : compact
                ? "text-lg"
                : "text-xl",
          )}
        >
          {title}
        </div>
        <div
          className={cn(
            "text-slate-500",
            compact && surface === "embedded"
              ? "text-[11px] leading-4"
              : compact
                ? "text-xs leading-5"
                : "text-sm leading-6",
          )}
        >
          {subtitle}
        </div>
      </div>

      {headerActions ? (
        headerActions
      ) : statusLabel ? (
        <A2UITaskCardStatusBadge
          label={statusLabel}
          icon={statusIcon}
          compact={compact}
          surface={surface}
        />
      ) : null}
    </div>
  );
}

export function A2UITaskCardBody({
  children,
  compact = false,
  className,
  surface = "default",
}: A2UITaskCardBodyProps) {
  return (
    <div
      className={cn(
        surface === "embedded"
          ? A2UI_TASK_CARD_TOKENS.contentPanelEmbedded
          : A2UI_TASK_CARD_TOKENS.contentPanel,
        surface === "embedded"
          ? compact
            ? A2UI_TASK_CARD_TOKENS.contentPanelEmbeddedCompactPadding
            : A2UI_TASK_CARD_TOKENS.contentPanelEmbeddedDefaultPadding
          : compact
            ? A2UI_TASK_CARD_TOKENS.contentPanelCompactPadding
            : A2UI_TASK_CARD_TOKENS.contentPanelDefaultPadding,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function A2UITaskCardLoadingBody({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        A2UI_TASK_CARD_TOKENS.loadingPanel,
        compact
          ? A2UI_TASK_CARD_TOKENS.loadingPanelCompactPadding
          : A2UI_TASK_CARD_TOKENS.loadingPanelDefaultPadding,
      )}
    >
      <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
      <span>{text}</span>
    </div>
  );
}
