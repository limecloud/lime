import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { SettingsGroup, SettingsSection } from "../../SettingsPrimitives";

interface SurfacePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  tipAriaLabel: string;
  aside?: ReactNode;
  searchTarget?: string;
  children: ReactNode;
}

interface FieldBlockProps {
  label: string;
  htmlFor: string;
  hint?: string;
  tipAriaLabel?: string;
  children: ReactNode;
}

export function SurfacePanel({
  title,
  description,
  aside,
  searchTarget,
  children,
}: SurfacePanelProps) {
  return (
    <SettingsSection
      title={title}
      actions={aside}
      data-settings-search-target={searchTarget}
      tabIndex={searchTarget ? -1 : undefined}
    >
      <SettingsGroup>
        <div className="py-4">
          <p className="mb-4 text-xs leading-4 text-muted-foreground">
            {description}
          </p>
          {children}
        </div>
      </SettingsGroup>
    </SettingsSection>
  );
}

export function FieldBlock({
  label,
  htmlFor,
  hint,
  tipAriaLabel,
  children,
}: FieldBlockProps) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-2 text-sm font-medium text-foreground"
      >
        <span>{label}</span>
        {hint ? (
          <WorkbenchInfoTip
            ariaLabel={tipAriaLabel || label}
            content={hint}
            tone="slate"
          />
        ) : null}
      </label>
      {children}
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-6 pb-8">
      <div className="h-[132px] animate-pulse rounded-[26px] border border-border bg-background" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(320px,0.84fr)]">
        <div className="space-y-6">
          <div className="h-[290px] animate-pulse rounded-[26px] border border-border bg-background" />
          <div className="h-[360px] animate-pulse rounded-[26px] border border-border bg-background" />
        </div>
        <div className="space-y-6">
          <div className="h-[240px] animate-pulse rounded-[26px] border border-border bg-background" />
          <div className="h-[220px] animate-pulse rounded-[26px] border border-border bg-background" />
        </div>
      </div>
      <div className="h-[360px] animate-pulse rounded-[26px] border border-border bg-background" />
    </div>
  );
}
