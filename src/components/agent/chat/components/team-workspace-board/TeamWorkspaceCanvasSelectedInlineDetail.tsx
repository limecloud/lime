import type { ComponentProps } from "react";
import { SelectedSessionInlineDetail } from "./SelectedSessionInlineDetail";

type TeamWorkspaceCanvasSelectedInlineDetailProps = ComponentProps<
  typeof SelectedSessionInlineDetail
>;

export function TeamWorkspaceCanvasSelectedInlineDetail({
  ...props
}: TeamWorkspaceCanvasSelectedInlineDetailProps) {
  return <SelectedSessionInlineDetail {...props} />;
}
