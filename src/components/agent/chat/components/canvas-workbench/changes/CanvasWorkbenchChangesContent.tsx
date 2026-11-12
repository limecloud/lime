import { type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CanvasWorkbenchChangesFileList } from "./CanvasWorkbenchChangesFileList";
import type {
  CanvasWorkbenchChangeItem,
  CanvasWorkbenchChangeTreeNode,
} from "./CanvasWorkbenchChangesPanelViewModel";
import type { CanvasWorkbenchTranslation } from "./CanvasWorkbenchChangesTypes";

interface CanvasWorkbenchChangesContentProps {
  filesPanelOpen: boolean;
  filesPanelGridStyle: CSSProperties | undefined;
  filesPanelResizeHandle: ReactNode;
  detail: ReactNode;
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

export function CanvasWorkbenchChangesContent({
  filesPanelOpen,
  filesPanelGridStyle,
  filesPanelResizeHandle,
  detail,
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
}: CanvasWorkbenchChangesContentProps) {
  return (
    <div
      data-testid="canvas-workbench-changes-content"
      data-file-tree-container
      className={cn(
        "grid min-h-0 min-w-0 gap-0",
        filesPanelOpen
          ? "grid-cols-[minmax(0,1fr)_min(60%,250px)]"
          : "grid-cols-1",
      )}
      style={filesPanelGridStyle}
    >
      <div className="relative min-h-0 min-w-0 overflow-hidden">
        {filesPanelResizeHandle}
        {detail}
      </div>

      {filesPanelOpen ? (
        <CanvasWorkbenchChangesFileList
          fileTree={fileTree}
          selectedChangeItem={selectedChangeItem}
          fileFilter={fileFilter}
          disabled={fileListDisabled}
          translateWorkbench={translateWorkbench}
          onFileFilterChange={onFileFilterChange}
          onSelectChangeItem={onSelectChangeItem}
          onOpenFile={onOpenFile}
          onDeleteFile={onDeleteFile}
          onRevealFile={onRevealFile}
        />
      ) : null}
    </div>
  );
}
