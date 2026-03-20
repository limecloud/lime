import React, { type ChangeEvent, type RefObject } from "react";
import styled from "styled-components";
import type { TaskFile } from "../../TaskFiles";
import type { A2UIResponse, A2UIFormData } from "@/components/content-creator/a2ui/types";
import {
  A2UISubmissionNotice,
  type A2UISubmissionNoticeData,
} from "./A2UISubmissionNotice";
import { A2UIFloatingForm } from "./A2UIFloatingForm";
import { HintRoutePopup } from "./HintRoutePopup";
import { TaskFilesPanel } from "./TaskFilesPanel";
import type { HintRouteItem } from "../hooks/useHintRoutes";

interface InputbarOverlayShellProps {
  showHintPopup: boolean;
  hintRoutes: HintRouteItem[];
  hintIndex: number;
  onHintSelect: (hint: string) => void;
  taskFiles: TaskFile[];
  selectedFileId?: string;
  taskFilesExpanded?: boolean;
  onToggleTaskFiles?: () => void;
  onTaskFileClick?: (file: TaskFile) => void;
  overlayAccessory?: React.ReactNode;
  submissionNotice?: A2UISubmissionNoticeData | null;
  isSubmissionNoticeVisible: boolean;
  pendingA2UIForm?: A2UIResponse | null;
  onA2UISubmit?: (formData: A2UIFormData) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}

const SecondaryControlsRow = styled.div`
  position: absolute;
  right: 8px;
  bottom: calc(100% + 8px);
  left: 8px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
  z-index: 80;

  > * {
    pointer-events: auto;
    max-width: 100%;
  }
`;

export const InputbarOverlayShell: React.FC<InputbarOverlayShellProps> = ({
  showHintPopup,
  hintRoutes,
  hintIndex,
  onHintSelect,
  taskFiles,
  selectedFileId,
  taskFilesExpanded = false,
  onToggleTaskFiles,
  onTaskFileClick,
  overlayAccessory,
  submissionNotice,
  isSubmissionNoticeVisible,
  pendingA2UIForm,
  onA2UISubmit,
  fileInputRef,
  onFileSelect,
}) => (
  <>
    {showHintPopup ? (
      <HintRoutePopup
        routes={hintRoutes}
        activeIndex={hintIndex}
        onSelect={onHintSelect}
      />
    ) : null}
    {taskFiles.length > 0 || overlayAccessory ? (
      <SecondaryControlsRow data-testid="inputbar-secondary-controls">
        <TaskFilesPanel
          files={taskFiles}
          selectedFileId={selectedFileId}
          expanded={taskFilesExpanded}
          onToggle={onToggleTaskFiles}
          onFileClick={onTaskFileClick}
        />
        {overlayAccessory}
      </SecondaryControlsRow>
    ) : null}
    {submissionNotice ? (
      <A2UISubmissionNotice
        notice={submissionNotice}
        visible={isSubmissionNoticeVisible}
      />
    ) : null}
    {pendingA2UIForm && onA2UISubmit ? (
      <A2UIFloatingForm response={pendingA2UIForm} onSubmit={onA2UISubmit} />
    ) : null}
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      style={{ display: "none" }}
      onChange={onFileSelect}
    />
  </>
);
