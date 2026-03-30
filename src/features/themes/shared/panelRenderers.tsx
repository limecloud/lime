import {
  MaterialTab,
  PublishTab,
  SettingsTab,
} from "@/components/projects/tabs";
import type { ThemeWorkspaceRendererProps } from "@/features/themes/types";

export function DefaultMaterialPanel({
  projectId,
}: ThemeWorkspaceRendererProps) {
  if (!projectId) {
    return null;
  }
  return <MaterialTab projectId={projectId} />;
}

export function DefaultPublishPanel({
  projectId,
}: ThemeWorkspaceRendererProps) {
  if (!projectId) {
    return null;
  }
  return <PublishTab projectId={projectId} />;
}

export function DefaultSettingsPanel({
  projectId,
  workspaceType,
}: ThemeWorkspaceRendererProps) {
  if (!projectId) {
    return null;
  }
  return <SettingsTab projectId={projectId} workspaceType={workspaceType} />;
}
