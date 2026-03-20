import styled from "styled-components";
import { FolderOpen, ChevronUp } from "lucide-react";
import { TaskFileList, type TaskFile } from "../../TaskFiles";

interface TaskFilesPanelProps {
  files: TaskFile[];
  selectedFileId?: string;
  expanded?: boolean;
  onToggle?: () => void;
  onFileClick?: (file: TaskFile) => void;
}

const Area = styled.div`
  position: relative;
  display: flex;
  justify-content: flex-end;
  width: auto;
  max-width: 100%;
  margin: 0;
  padding: 0;
`;

const Wrapper = styled.div`
  position: relative;
`;

const TriggerButton = styled.button<{
  $expanded?: boolean;
  $hasFiles?: boolean;
}>`
  display: ${(props) => (props.$hasFiles ? "flex" : "none")};
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    color: hsl(var(--foreground));
  }

  ${(props) =>
    props.$expanded &&
    `
    border-color: hsl(var(--primary));
    color: hsl(var(--foreground));
    background: hsl(var(--primary) / 0.05);
  `}
`;

const FileCount = styled.span`
  font-weight: 500;
`;

const ChevronIcon = styled.span<{ $expanded?: boolean }>`
  display: flex;
  align-items: center;
  transform: ${(props) =>
    props.$expanded ? "rotate(0deg)" : "rotate(180deg)"};
  transition: transform 0.2s;
`;

export function TaskFilesPanel({
  files,
  selectedFileId,
  expanded = false,
  onToggle,
  onFileClick,
}: TaskFilesPanelProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <Area data-testid="task-files-panel-area">
      <Wrapper>
        <TaskFileList
          files={files}
          selectedFileId={selectedFileId}
          onFileClick={onFileClick}
          expanded={expanded}
          onExpandedChange={(nextExpanded) => {
            if (nextExpanded !== expanded) {
              onToggle?.();
            }
          }}
        />
        <TriggerButton
          $hasFiles={files.length > 0}
          $expanded={expanded}
          onClick={onToggle}
          data-task-files-trigger
        >
          <FolderOpen size={14} />
          任务文件
          <FileCount>({files.length})</FileCount>
          <ChevronIcon $expanded={expanded}>
            <ChevronUp size={14} />
          </ChevronIcon>
        </TriggerButton>
      </Wrapper>
    </Area>
  );
}
