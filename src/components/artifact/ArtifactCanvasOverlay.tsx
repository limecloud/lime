import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ArtifactDisplayOverlayState } from "@/components/agent/chat/hooks/useArtifactDisplayState";

interface ArtifactCanvasOverlayProps {
  overlay: ArtifactDisplayOverlayState;
  className?: string;
}

export function ArtifactCanvasOverlay({
  overlay,
  className,
}: ArtifactCanvasOverlayProps) {
  const isFailed = overlay.phase === "failed";
  const isCompleted = overlay.phase === "finalized_empty";

  return (
    <div
      data-testid="artifact-transition-overlay"
      data-overlay-phase={overlay.phase}
      className={cn(
        "pointer-events-none absolute inset-x-4 top-4 z-20",
        className,
      )}
    >
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-lg backdrop-blur">
        <div className="flex items-start gap-3 px-4 py-4">
          <div
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
              isFailed
                ? "bg-destructive/10 text-destructive"
                : isCompleted
                  ? "bg-slate-100 text-slate-700"
                  : "bg-primary/10 text-primary",
            )}
          >
            {isFailed ? (
              <AlertCircle className="h-5 w-5" />
            ) : overlay.showProgress ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-background/80 text-xs">
                {overlay.phaseLabel}
              </Badge>
              <span className="truncate text-sm font-medium text-foreground">
                {overlay.displayName}
              </span>
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {overlay.title}
            </div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {overlay.detail}
            </div>
            {overlay.filePath !== overlay.displayName ? (
              <div className="mt-2 truncate text-[11px] text-muted-foreground/90">
                {overlay.filePath}
              </div>
            ) : null}
          </div>
        </div>
        {overlay.showProgress ? (
          <div className="h-1.5 bg-muted/60">
            <div className="h-full w-2/5 rounded-r-full bg-primary/60 animate-pulse" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
