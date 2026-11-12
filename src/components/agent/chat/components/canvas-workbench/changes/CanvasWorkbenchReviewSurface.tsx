import { type CSSProperties, type ReactNode } from "react";
import { CanvasWorkbenchChangesContent } from "./CanvasWorkbenchChangesContent";
import { CanvasWorkbenchViewedChangesProvider } from "./CanvasWorkbenchViewedChangesContext";
import {
  CanvasWorkbenchChangesToolbar,
  type CanvasWorkbenchChangesToolbarProps,
} from "./CanvasWorkbenchChangesToolbar";
import type {
  CanvasWorkbenchChangeItem,
  CanvasWorkbenchChangeTreeNode,
} from "./CanvasWorkbenchChangesPanelViewModel";
import type { CanvasWorkbenchTranslation } from "./CanvasWorkbenchChangesTypes";

export interface CanvasWorkbenchReviewSurfaceProps {
  toolbar: CanvasWorkbenchChangesToolbarProps;
  detail: ReactNode;
  notice?: ReactNode;
  filesPanelOpen: boolean;
  filesPanelGridStyle: CSSProperties | undefined;
  filesPanelResizeHandle: ReactNode;
  fileTree: CanvasWorkbenchChangeTreeNode[];
  selectedChangeItem?: CanvasWorkbenchChangeItem;
  fileFilter: string;
  fileListDisabled?: boolean;
  translateWorkbench: CanvasWorkbenchTranslation;
  onFileFilterChange?: (value: string) => void;
  onSelectChangeItem?: (item: CanvasWorkbenchChangeItem) => void;
  onOpenFile?: (path: string) => void | Promise<void>;
  onDeleteFile?: (
    item: CanvasWorkbenchChangeItem,
  ) => void | Promise<void>;
  onRevealFile?: (item: CanvasWorkbenchChangeItem) => void;
}

export function CanvasWorkbenchReviewSurface({
  toolbar,
  detail,
  notice,
  filesPanelOpen,
  filesPanelGridStyle,
  filesPanelResizeHandle,
  fileTree,
  selectedChangeItem,
  fileFilter,
  fileListDisabled,
  translateWorkbench,
  onFileFilterChange,
  onSelectChangeItem,
  onOpenFile,
  onDeleteFile,
  onRevealFile,
}: CanvasWorkbenchReviewSurfaceProps) {
  return (
    <CanvasWorkbenchViewedChangesProvider>
    <section
      data-testid="canvas-workbench-panel-changes"
      className={`grid h-full min-h-0 bg-[color:var(--lime-surface)] ${notice ? "grid-rows-[auto_auto_minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]"}`}
    >
      <CanvasWorkbenchChangesToolbar {...toolbar} />
      {notice}
      <CanvasWorkbenchChangesContent
        filesPanelOpen={filesPanelOpen}
        filesPanelGridStyle={filesPanelGridStyle}
        filesPanelResizeHandle={filesPanelResizeHandle}
        fileTree={fileTree}
        selectedChangeItem={selectedChangeItem}
        fileFilter={fileFilter}
        fileListDisabled={fileListDisabled}
        translateWorkbench={translateWorkbench}
        onFileFilterChange={onFileFilterChange}
        onSelectChangeItem={onSelectChangeItem}
        onOpenFile={onOpenFile}
        onDeleteFile={onDeleteFile}
        onRevealFile={onRevealFile}
        detail={detail}
      />
    </section>
    </CanvasWorkbenchViewedChangesProvider>
  );
}
