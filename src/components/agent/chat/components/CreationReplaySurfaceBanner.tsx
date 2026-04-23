import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreationReplaySurfaceModel } from "../utils/creationReplaySurface";

interface CreationReplaySurfaceBannerProps {
  surface: CreationReplaySurfaceModel;
  className?: string;
  testId?: string;
}

export function CreationReplaySurfaceBanner({
  surface,
  className,
  testId = "creation-replay-surface-banner",
}: CreationReplaySurfaceBannerProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-3 rounded-[20px] border border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.84)_0%,rgba(255,255,255,0.96)_100%)] px-4 py-3 text-sm text-slate-700 shadow-sm shadow-emerald-950/5",
        className,
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700">
        <Lightbulb className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-emerald-700">
            {surface.eyebrow}
          </span>
          <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            {surface.badgeLabel}
          </span>
          <span className="text-[11px] text-slate-500">{surface.hint}</span>
        </div>
        <div className="mt-1 text-sm font-semibold text-slate-900">
          {surface.title}
        </div>
        <div className="mt-1 text-xs leading-5 text-slate-600">
          {surface.summary}
        </div>
      </div>
    </div>
  );
}

export default CreationReplaySurfaceBanner;
