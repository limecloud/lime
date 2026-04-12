import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { TeamWorkspaceCanvasStage } from "./TeamWorkspaceCanvasStage";
import { TeamWorkspaceCanvasToolbar } from "./TeamWorkspaceCanvasToolbar";
import { TeamWorkspaceFallbackDetailSection } from "./TeamWorkspaceFallbackDetailSection";
import { TeamWorkspaceTeamOverviewChrome } from "./TeamWorkspaceTeamOverviewChrome";

interface TeamWorkspaceBoardCanvasSectionProps {
  canvasStageProps: ComponentProps<typeof TeamWorkspaceCanvasStage>;
  canvasToolbarProps: ComponentProps<typeof TeamWorkspaceCanvasToolbar>;
  embedded: boolean;
  fallbackDetailProps?: ComponentProps<
    typeof TeamWorkspaceFallbackDetailSection
  > | null;
  overviewChromeProps: Omit<
    ComponentProps<typeof TeamWorkspaceTeamOverviewChrome>,
    "embedded" | "useCompactCanvasChrome"
  >;
  railCardClassName: string;
  useCompactCanvasChrome: boolean;
}

export function TeamWorkspaceBoardCanvasSection({
  canvasStageProps,
  canvasToolbarProps,
  embedded,
  fallbackDetailProps = null,
  overviewChromeProps,
  railCardClassName,
  useCompactCanvasChrome,
}: TeamWorkspaceBoardCanvasSectionProps) {
  return (
    <div className={railCardClassName}>
      <TeamWorkspaceTeamOverviewChrome
        {...overviewChromeProps}
        embedded={embedded}
        useCompactCanvasChrome={useCompactCanvasChrome}
      />

      <div
        className={cn(
          "mt-3",
          useCompactCanvasChrome ? "space-y-2.5" : "space-y-3",
        )}
      >
        {!useCompactCanvasChrome ? (
          <TeamWorkspaceCanvasToolbar {...canvasToolbarProps} />
        ) : null}
        <TeamWorkspaceCanvasStage {...canvasStageProps} />
      </div>

      {fallbackDetailProps ? (
        <TeamWorkspaceFallbackDetailSection
          {...fallbackDetailProps}
          detailCardClassName={cn("mt-3", fallbackDetailProps.detailCardClassName)}
        />
      ) : null}
    </div>
  );
}
