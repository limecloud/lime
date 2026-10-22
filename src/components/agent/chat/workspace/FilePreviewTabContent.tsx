import { useCallback, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ArtifactNavigationContext } from "@/components/artifact/annotations/ArtifactNavigationContext";
import {
  FileEditLifecycleContext,
  type FileEditController,
} from "@/components/artifact/fileEditLifecycle";
import { FilePreviewPanel } from "./FilePreviewPanel";
import type { ThreadSidePanelTab } from "./right-surface/threadSidePanelTabs";
import { useWorkspaceFileActions } from "./right-surface/useWorkspaceFileActions";
import { useFileTabLifecycle } from "./text-file-editor/fileTabLifecycleContext";

export function FilePreviewTabContent({
  tab,
  active = true,
  ...props
}: Omit<ComponentProps<typeof FilePreviewPanel>, "download"> & {
  tab: ThreadSidePanelTab;
  active?: boolean;
}) {
  const { t } = useTranslation("workspace");
  const lifecycle = useFileTabLifecycle();
  const register = lifecycle?.register;
  const path = props.context?.selectionPath;
  const actions = useWorkspaceFileActions(
    tab,
    path ?? null,
    () => path === tab.filePath && (lifecycle?.isTabCurrent(tab) ?? true),
  );
  const registerEditor = useCallback(
    (editorPath: string, controller: FileEditController) => {
      if (!register || editorPath !== path || editorPath !== tab.filePath)
        return;
      let current = true;
      const unregister = register(tab, {
        hasUnsavedChanges: () => {
          const state = controller.getSnapshot();
          return state.dirty || state.saving;
        },
        saveUntilClean: async () => {
          do {
            if (!current || !(await controller.flushPublicFile())) return false;
            if (!current) return false;
          } while (controller.getSnapshot().dirty);
          return !controller.getSnapshot().saving;
        },
        discard: () => controller.discardEdits(),
      });
      return () => {
        current = false;
        unregister();
      };
    },
    [register, path, tab],
  );
  return (
    <ArtifactNavigationContext.Provider value={{ tabId: tab.tabId, active }}>
      <FileEditLifecycleContext.Provider value={registerEditor}>
        <FilePreviewPanel
          {...props}
          download={
            path && path === tab.filePath && actions.canSaveAs
              ? {
                  label: t("workspace.artifactToolbar.action.download"),
                  busy: actions.busy,
                  onSelect: actions.saveAs,
                }
              : undefined
          }
        />
      </FileEditLifecycleContext.Provider>
    </ArtifactNavigationContext.Provider>
  );
}
