import { memo, type ReactNode } from "react";
import { Copy, Download, ExternalLink, FolderOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasWorkbenchDiffLine } from "../../utils/canvasWorkbenchDiff";
import type {
  CanvasWorkbenchLayoutMode,
  CanvasWorkbenchTab,
} from "../CanvasWorkbenchLayout";
import type { HarnessFilePreviewResult } from "../HarnessStatusPanel";
import type { CanvasWorkbenchResolvedSelection } from "../CanvasWorkbenchLayoutViewModel";
import { CanvasWorkbenchChangesPanel } from "./changes/CanvasWorkbenchChangesPanel";
import type { CanvasWorkbenchChangeView } from "./changes/CanvasWorkbenchChangesPanelViewModel";
import { FilePreviewPanel } from "../../workspace/FilePreviewPanel";
import {
  isFilePreviewMode,
  type FilePreviewMode,
  type FilePreviewModeState,
} from "../../workspace/filePreviewModel";
import {
  CanvasWorkbenchTopTabs,
  type CanvasWorkbenchTopTab,
} from "./tabs/CanvasWorkbenchTopTabs";

type CanvasWorkbenchTranslation = (
  key: string,
  options?: Record<string, unknown>,
) => string;

interface CanvasWorkbenchShellProps {
  shellRef: (node: HTMLElement | null) => void;
  layoutMode: CanvasWorkbenchLayoutMode;
  activeTab: CanvasWorkbenchTab;
  contentTab: CanvasWorkbenchTab;
  tabs: CanvasWorkbenchTopTab[];
  topRightTools?: ReactNode;
  detailHeaderVisible?: boolean;
  translateWorkbench: CanvasWorkbenchTranslation;
  onSelectTab: (tab: CanvasWorkbenchTab) => void;
  onClose?: () => void;
  closeWorkbenchLabel: string;
  headerActionsVisible: boolean;
  activeSelectionPath?: string;
  activeContent: string;
  downloadEnabled?: boolean;
  fileActionBusy?: boolean;
  onCopyPath: () => void;
  onOpenPath: (path: string) => void;
  onRevealPath: (path: string) => void;
  onDownload: () => void;
  documentContext: CanvasWorkbenchResolvedSelection | null;
  documentDiffLines: CanvasWorkbenchDiffLine[];
  previewModeState: FilePreviewModeState;
  changeView?: CanvasWorkbenchChangeView | null;
  changesFilesPanelOpen: boolean;
  loadFilePreview?: (path: string) => Promise<HarnessFilePreviewResult>;
  workspaceRoot?: string | null;
  shellClassName: string;
  panelClassName: string;
  mutedPanelClassName: string;
  ghostButtonClassName: string;
  onSelectPreviewMode: (mode: FilePreviewMode) => void;
  onToggleChangesFilesPanel?: () => void;
}

function HeaderActionButton({
  label,
  onClick,
  disabled,
  icon,
  ghostButtonClassName,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
  ghostButtonClassName: string;
}) {
  if (disabled) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-[7px] border text-[color:var(--lime-text-muted)] transition-colors",
        ghostButtonClassName,
      )}
    >
      {icon}
    </button>
  );
}

export const CanvasWorkbenchShell = memo(function CanvasWorkbenchShell({
  shellRef,
  layoutMode,
  activeTab,
  contentTab,
  tabs,
  topRightTools = null,
  detailHeaderVisible = true,
  translateWorkbench,
  onSelectTab,
  onClose,
  closeWorkbenchLabel,
  headerActionsVisible,
  activeSelectionPath,
  activeContent,
  downloadEnabled = Boolean(activeContent.trim()),
  fileActionBusy = false,
  onCopyPath,
  onOpenPath,
  onRevealPath,
  onDownload,
  documentContext,
  documentDiffLines,
  previewModeState,
  changeView,
  changesFilesPanelOpen,
  loadFilePreview,
  workspaceRoot,
  shellClassName,
  panelClassName,
  mutedPanelClassName,
  ghostButtonClassName,
  onSelectPreviewMode,
  onToggleChangesFilesPanel,
}: CanvasWorkbenchShellProps) {
  return (
    <section
      ref={shellRef}
      data-testid="canvas-workbench-shell"
      data-layout-mode={layoutMode}
      className={cn(
        "lime-workbench-theme-scope",
        "lime-workbench-surface-scope",
        shellClassName,
        "relative flex h-full min-h-0 flex-col overflow-hidden",
      )}
    >
      <header className="relative z-[90] shrink-0 overflow-visible border-b border-slate-200 bg-white">
        <div
          data-testid="canvas-workbench-header-row"
          className="flex h-10 min-w-0 items-center justify-between gap-2 px-2.5"
        >
          <div
            className="min-w-0 flex-1 overflow-visible"
            data-testid="canvas-workbench-top-tabs-slot"
          >
            <CanvasWorkbenchTopTabs
              activeTab={activeTab}
              tabs={tabs}
              translateWorkbench={translateWorkbench}
              onSelectTab={onSelectTab}
            />
          </div>

          <div
            className="flex shrink-0 items-center gap-1"
            data-testid="canvas-workbench-top-right-tools"
          >
            {topRightTools}
          </div>
        </div>

        {detailHeaderVisible ? (
          <div className="flex h-10 min-w-0 items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate px-1 font-mono text-[12px] font-medium text-slate-600">
                {documentContext?.title ||
                  translateWorkbench(
                    "agentChat.canvasWorkbench.title.fallback",
                  )}
              </span>
            </div>
            {headerActionsVisible || onClose ? (
              <div className="flex shrink-0 items-center justify-end gap-1">
                {headerActionsVisible ? (
                  <div
                    className="flex shrink-0 items-center justify-end gap-1"
                    data-testid="canvas-workbench-header-actions"
                  >
                    <HeaderActionButton
                      label={translateWorkbench(
                        "agentChat.canvasWorkbench.actions.copyPath",
                      )}
                      disabled={!activeSelectionPath}
                      onClick={onCopyPath}
                      icon={<Copy className="h-4 w-4" />}
                      ghostButtonClassName={ghostButtonClassName}
                    />
                    <HeaderActionButton
                      label={translateWorkbench(
                        "agentChat.canvasWorkbench.actions.revealPath",
                      )}
                      disabled={!activeSelectionPath}
                      onClick={() => {
                        if (activeSelectionPath) {
                          onRevealPath(activeSelectionPath);
                        }
                      }}
                      icon={<FolderOpen className="h-4 w-4" />}
                      ghostButtonClassName={ghostButtonClassName}
                    />
                    <HeaderActionButton
                      label={translateWorkbench(
                        "agentChat.canvasWorkbench.actions.openPath",
                      )}
                      disabled={!activeSelectionPath || fileActionBusy}
                      onClick={() => {
                        if (activeSelectionPath) {
                          onOpenPath(activeSelectionPath);
                        }
                      }}
                      icon={<ExternalLink className="h-4 w-4" />}
                      ghostButtonClassName={ghostButtonClassName}
                    />
                    <HeaderActionButton
                      label={translateWorkbench(
                        "agentChat.canvasWorkbench.actions.download",
                      )}
                      disabled={!downloadEnabled || fileActionBusy}
                      onClick={onDownload}
                      icon={<Download className="h-4 w-4" />}
                      ghostButtonClassName={ghostButtonClassName}
                    />
                  </div>
                ) : null}

                {onClose ? (
                  <button
                    type="button"
                    aria-label={closeWorkbenchLabel}
                    title={closeWorkbenchLabel}
                    onClick={onClose}
                    className={cn(
                      "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border transition-colors",
                      ghostButtonClassName,
                    )}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <div
        data-testid="canvas-workbench-layout"
        data-panel-placement="canvas"
        className="relative z-0 min-h-0 flex-1 overflow-hidden bg-[image:var(--lime-stage-surface-soft)]"
      >
        {isFilePreviewMode(contentTab) ? (
          <FilePreviewPanel
            context={documentContext}
            mode={contentTab}
            modeState={previewModeState}
            translate={translateWorkbench}
            onSelectMode={onSelectPreviewMode}
          />
        ) : (
          <CanvasWorkbenchChangesPanel
            changeView={changeView}
            documentContext={documentContext}
            documentDiffLines={documentDiffLines}
            translateWorkbench={translateWorkbench}
            panelClassName={panelClassName}
            mutedPanelClassName={mutedPanelClassName}
            workspaceRoot={workspaceRoot}
            loadFilePreview={loadFilePreview}
            filesPanelOpen={changesFilesPanelOpen}
            onToggleFilesPanel={onToggleChangesFilesPanel}
          />
        )}
      </div>
    </section>
  );
});

CanvasWorkbenchShell.displayName = "CanvasWorkbenchShell";
