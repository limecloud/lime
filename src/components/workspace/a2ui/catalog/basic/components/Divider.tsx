import { cn } from "@/lib/utils";
import type { DividerComponent } from "../../../types";
import { A2UI_LAYOUT_TOKENS } from "../../../layoutTokens";

interface DividerRendererProps {
  component: DividerComponent;
}

export function DividerRenderer({ component }: DividerRendererProps) {
  const isVertical = component.axis === "vertical";
  return (
    <div
      className={cn(
        A2UI_LAYOUT_TOKENS.dividerBase,
        isVertical
          ? A2UI_LAYOUT_TOKENS.dividerVertical
          : A2UI_LAYOUT_TOKENS.dividerHorizontal,
      )}
    />
  );
}

export const Divider = DividerRenderer;
