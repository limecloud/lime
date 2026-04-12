import type { ComponentProps } from "react";
import { TeamWorkspaceBoardCanvasSection } from "./TeamWorkspaceBoardCanvasSection";
import { TeamWorkspaceBoardHeader } from "./TeamWorkspaceBoardHeader";

interface TeamWorkspaceBoardShellProps {
  boardBodyClassName: string;
  boardHeaderClassName: string;
  boardShellClassName: string;
  canvasSectionProps: Omit<
    ComponentProps<typeof TeamWorkspaceBoardCanvasSection>,
    "embedded"
  >;
  embedded: boolean;
  headerProps: Omit<
    ComponentProps<typeof TeamWorkspaceBoardHeader>,
    "className" | "dataTestId"
  >;
  style?: { maxHeight: string } | undefined;
}

export function TeamWorkspaceBoardShell({
  boardBodyClassName,
  boardHeaderClassName,
  boardShellClassName,
  canvasSectionProps,
  embedded,
  headerProps,
  style,
}: TeamWorkspaceBoardShellProps) {
  return (
    <section
      className={boardShellClassName}
      data-testid={embedded ? "team-workspace-board-embedded-shell" : undefined}
      style={style}
    >
      <TeamWorkspaceBoardHeader
        {...headerProps}
        className={boardHeaderClassName}
        dataTestId={embedded ? "team-workspace-board-header" : undefined}
      />

      <div
        className={boardBodyClassName}
        data-testid={embedded ? "team-workspace-board-body" : undefined}
      >
        <TeamWorkspaceBoardCanvasSection
          {...canvasSectionProps}
          embedded={embedded}
        />
      </div>
    </section>
  );
}
