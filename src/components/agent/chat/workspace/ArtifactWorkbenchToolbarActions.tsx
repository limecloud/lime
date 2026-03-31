import React, { memo } from "react";
import { Code, FileClock, FileCode2, Save, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "accent" | "warning";
  testId: string;
}

function resolveToneClassName(tone: ActionButtonProps["tone"]): string {
  switch (tone) {
    case "accent":
      return "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100";
    default:
      return "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900";
  }
}

const ActionButton: React.FC<ActionButtonProps> = memo(
  ({ icon, label, onClick, disabled = false, tone = "default", testId }) => (
    <button
      data-testid={testId}
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        resolveToneClassName(tone),
        disabled &&
          "cursor-not-allowed opacity-50 hover:bg-inherit hover:text-inherit",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  ),
);
ActionButton.displayName = "ActionButton";

export interface ArtifactWorkbenchToolbarActionsProps {
  showSaveToProject: boolean;
  saveToProjectDisabled: boolean;
  isSavingToProject: boolean;
  onSaveToProject: () => void;
  onExportJson: () => void;
  onExportHtml: () => void;
  onExportMarkdown: () => void;
  showArchiveToggle: boolean;
  isUpdatingArchive: boolean;
  archiveLabel: string;
  onToggleArchive: () => void;
}

export const ArtifactWorkbenchToolbarActions: React.FC<ArtifactWorkbenchToolbarActionsProps> =
  memo(
    ({
      showSaveToProject,
      saveToProjectDisabled,
      isSavingToProject,
      onSaveToProject,
      onExportJson,
      onExportHtml,
      onExportMarkdown,
      showArchiveToggle,
      isUpdatingArchive,
      archiveLabel,
      onToggleArchive,
    }) => (
      <div className="flex items-center gap-1.5">
        {showSaveToProject ? (
          <ActionButton
            testId="artifact-workbench-save-to-project"
            icon={<Save className="h-3.5 w-3.5" />}
            label={isSavingToProject ? "保存中" : "项目复用"}
            onClick={() => {
              void onSaveToProject();
            }}
            disabled={saveToProjectDisabled || isSavingToProject}
            tone="accent"
          />
        ) : null}
        <ActionButton
          testId="artifact-workbench-export-html"
          icon={<FileCode2 className="h-3.5 w-3.5" />}
          label="导出 HTML"
          onClick={() => {
            void onExportHtml();
          }}
        />
        <ActionButton
          testId="artifact-workbench-export-markdown"
          icon={<ScrollText className="h-3.5 w-3.5" />}
          label="导出 MD"
          onClick={() => {
            void onExportMarkdown();
          }}
        />
        <ActionButton
          testId="artifact-workbench-export-json"
          icon={<Code className="h-3.5 w-3.5" />}
          label="导出 JSON"
          onClick={() => {
            void onExportJson();
          }}
        />
        {showArchiveToggle ? (
          <ActionButton
            testId="artifact-workbench-archive-toggle"
            icon={<FileClock className="h-3.5 w-3.5" />}
            label={isUpdatingArchive ? "处理中" : archiveLabel}
            onClick={() => {
              void onToggleArchive();
            }}
            disabled={isUpdatingArchive}
            tone="warning"
          />
        ) : null}
      </div>
    ),
  );
ArtifactWorkbenchToolbarActions.displayName = "ArtifactWorkbenchToolbarActions";
