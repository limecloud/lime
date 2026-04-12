import { useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Clock3,
  Loader2,
} from "lucide-react";
import styled from "styled-components";
import type {
  WorkflowGateState,
  WorkflowQuickAction,
  WorkflowStep,
} from "../../../utils/workflowInputState";

interface InputbarWorkflowStatusPanelProps {
  gate?: WorkflowGateState | null;
  quickActions: WorkflowQuickAction[];
  queueItems: WorkflowStep[];
  activeItem: WorkflowStep | null;
  queueTotalCount: number;
  completedCount: number;
  totalCount: number;
  progressLabel: string;
  summaryLabel: string;
  renderGeneratingPanel: boolean;
  onQuickAction: (prompt: string) => void;
  onStop?: () => void;
}

type WorkflowTone = "active" | "pending" | "error";

const PanelWrap = styled.div`
  margin: 0 10px 10px;
`;

const StatusCard = styled.div`
  border: 1px solid hsl(var(--border) / 0.84);
  border-radius: 18px;
  background: hsl(var(--background));
  box-shadow: 0 10px 24px hsl(var(--foreground) / 0.05);
  overflow: hidden;
`;

const SummaryRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
`;

const SummaryIcon = styled.span<{ $tone: WorkflowTone }>`
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: ${({ $tone }) =>
    $tone === "error"
      ? "hsl(var(--destructive) / 0.1)"
      : $tone === "pending"
        ? "hsl(38 100% 92%)"
        : "hsl(var(--primary) / 0.12)"};
  color: ${({ $tone }) =>
    $tone === "error"
      ? "hsl(var(--destructive))"
      : $tone === "pending"
        ? "hsl(30 90% 42%)"
        : "hsl(var(--primary))"};
`;

const SummaryBody = styled.div`
  min-width: 0;
  flex: 1;
`;

const SummaryEyebrow = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: hsl(var(--muted-foreground));
`;

const SummaryTitle = styled.div`
  margin-top: 2px;
  font-size: 15px;
  line-height: 1.35;
  font-weight: 600;
  color: hsl(var(--foreground));
  word-break: break-word;
`;

const SummaryDescription = styled.div`
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: hsl(var(--muted-foreground));
`;

const SummaryAside = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const SummaryStatus = styled.span<{ $tone: WorkflowTone }>`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  color: ${({ $tone }) =>
    $tone === "error"
      ? "hsl(var(--destructive))"
      : $tone === "pending"
        ? "hsl(35 95% 35%)"
        : "hsl(var(--primary))"};
  background: ${({ $tone }) =>
    $tone === "error"
      ? "hsl(var(--destructive) / 0.12)"
      : $tone === "pending"
        ? "hsl(36 100% 90%)"
        : "hsl(var(--primary) / 0.14)"};
`;

const QueueSection = styled.div`
  border-top: 1px solid hsl(var(--border) / 0.66);
  padding: 0 12px 12px;
`;

const QueueToggleButton = styled.button`
  width: 100%;
  border: none;
  background: transparent;
  padding: 10px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
`;

const QueueToggleLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.88);
`;

const QueueCount = styled.span`
  min-width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  background: hsl(var(--muted) / 0.75);
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 700;
`;

const QueueHint = styled.span`
  margin-left: auto;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const QueueChevron = styled.span<{ $collapsed: boolean }>`
  display: inline-flex;
  transition: transform 0.2s ease;
  transform: ${({ $collapsed }) =>
    $collapsed ? "rotate(-90deg)" : "rotate(0deg)"};
`;

const TaskList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
`;

const TaskRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  border-radius: 13px;
  border: 1px solid hsl(var(--border) / 0.74);
  background: hsl(var(--muted) / 0.2);
  padding: 9px 10px;
`;

const TaskIcon = styled.span<{ $tone: WorkflowTone }>`
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: ${({ $tone }) =>
    $tone === "error"
      ? "hsl(var(--destructive) / 0.1)"
      : $tone === "pending"
        ? "hsl(38 100% 92%)"
        : "hsl(var(--primary) / 0.12)"};
  color: ${({ $tone }) =>
    $tone === "error"
      ? "hsl(var(--destructive))"
      : $tone === "pending"
        ? "hsl(30 90% 42%)"
        : "hsl(var(--primary))"};
`;

const TaskBody = styled.div`
  min-width: 0;
  flex: 1;
`;

const TaskTitle = styled.div`
  font-size: 13px;
  line-height: 1.4;
  color: hsl(var(--foreground));
  word-break: break-word;
`;

const TaskMeta = styled.div`
  margin-top: 3px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const QuickActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 12px 12px;
`;

const QuickButton = styled.button`
  border: 1px solid hsl(var(--border) / 0.88);
  border-radius: 999px;
  background: hsl(var(--background));
  color: hsl(var(--foreground) / 0.82);
  font-size: 11px;
  line-height: 1.2;
  padding: 6px 11px;
  cursor: pointer;

  &:hover {
    border-color: hsl(var(--primary) / 0.22);
    color: hsl(var(--foreground));
  }
`;

const StopButton = styled.button`
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.28);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;

  &:hover {
    color: hsl(var(--destructive));
    border-color: hsl(var(--destructive) / 0.5);
    background: hsl(var(--destructive) / 0.06);
  }
`;

const StopGlyph = styled.span`
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &::after {
    content: "";
    width: 3px;
    height: 3px;
    border-radius: 999px;
    background: currentColor;
  }
`;

function resolveWorkflowTone(
  status: WorkflowStep["status"] | WorkflowGateState["status"] | undefined,
): WorkflowTone {
  if (status === "error") {
    return "error";
  }
  if (status === "pending" || status === "waiting") {
    return "pending";
  }
  return "active";
}

function getStatusLabel(tone: WorkflowTone): string {
  if (tone === "error") {
    return "异常";
  }
  if (tone === "pending") {
    return "待处理";
  }
  return "进行中";
}

function renderToneIcon(tone: WorkflowTone) {
  if (tone === "error") {
    return <AlertCircle size={14} />;
  }
  if (tone === "pending") {
    return <Clock3 size={14} />;
  }
  return <Loader2 size={14} className="animate-spin" />;
}

export function InputbarWorkflowStatusPanel({
  gate,
  quickActions,
  queueItems,
  activeItem,
  queueTotalCount,
  completedCount,
  totalCount,
  progressLabel,
  summaryLabel,
  renderGeneratingPanel,
  onQuickAction,
  onStop,
}: InputbarWorkflowStatusPanelProps) {
  const [queueCollapsed, setQueueCollapsed] = useState(false);

  if (!renderGeneratingPanel && (!gate || gate.status === "idle")) {
    return null;
  }

  const summaryTone = renderGeneratingPanel
    ? resolveWorkflowTone(activeItem?.status)
    : resolveWorkflowTone(gate?.status);
  const summaryTitle = renderGeneratingPanel
    ? activeItem?.title || "正在编排任务节点"
    : gate?.title || "等待继续";
  const queueHiddenCount = Math.max(queueTotalCount - queueItems.length, 0);
  const queueHintLabel =
    queueHiddenCount > 0
      ? `${progressLabel} · 另有 ${queueHiddenCount} 项收纳`
      : progressLabel;

  return (
    <PanelWrap>
      <StatusCard data-testid="workflow-status-card">
        <SummaryRow>
          <SummaryIcon $tone={summaryTone}>{renderToneIcon(summaryTone)}</SummaryIcon>
          <SummaryBody>
            <SummaryEyebrow>
              任务视图
            </SummaryEyebrow>
            <SummaryTitle data-testid="workflow-current-title">
              {summaryTitle}
            </SummaryTitle>
            <SummaryDescription>{summaryLabel}</SummaryDescription>
          </SummaryBody>
          <SummaryAside>
            <SummaryStatus $tone={summaryTone}>
              {renderGeneratingPanel
                ? getStatusLabel(summaryTone)
                : gate?.status === "waiting"
                  ? "等待决策"
                  : gate?.status === "running"
                    ? "自动执行中"
                    : "待启动"}
            </SummaryStatus>
            {renderGeneratingPanel ? (
              <StopButton
                type="button"
                data-testid="workflow-stop"
                onClick={() => onStop?.()}
                aria-label="停止生成"
              >
                <StopGlyph />
              </StopButton>
            ) : null}
          </SummaryAside>
        </SummaryRow>

        {renderGeneratingPanel && queueTotalCount > 0 ? (
          <QueueSection>
            <QueueToggleButton
              type="button"
              onClick={() => setQueueCollapsed((previous) => !previous)}
              aria-label={queueCollapsed ? "展开任务队列" : "折叠任务队列"}
            >
              <QueueToggleLabel>任务队列</QueueToggleLabel>
              <QueueCount>{queueTotalCount}</QueueCount>
              <QueueHint>{queueHintLabel}</QueueHint>
              <QueueChevron $collapsed={queueCollapsed}>
                <ChevronDown size={14} />
              </QueueChevron>
            </QueueToggleButton>
            {!queueCollapsed ? (
              <TaskList>
                {queueItems.length === 0 ? (
                  <TaskRow>
                    <TaskIcon $tone="active">
                      <Loader2 size={13} className="animate-spin" />
                    </TaskIcon>
                    <TaskBody>
                      <TaskTitle>正在编排任务节点...</TaskTitle>
                      <TaskMeta>进行中</TaskMeta>
                    </TaskBody>
                  </TaskRow>
                ) : (
                  queueItems.map((item) => {
                    const tone = resolveWorkflowTone(item.status);
                    return (
                      <TaskRow
                        key={item.id}
                        data-testid="workflow-queue-item"
                        data-status={item.status}
                      >
                        <TaskIcon $tone={tone}>{renderToneIcon(tone)}</TaskIcon>
                        <TaskBody>
                          <TaskTitle>{item.title}</TaskTitle>
                          <TaskMeta>
                            {getStatusLabel(tone)}
                            {totalCount > 0 ? ` · ${completedCount}/${totalCount}` : ""}
                          </TaskMeta>
                        </TaskBody>
                      </TaskRow>
                    );
                  })
                )}
              </TaskList>
            ) : null}
          </QueueSection>
        ) : null}

        {!renderGeneratingPanel && quickActions.length > 0 ? (
          <QuickActions>
            {quickActions.map((action) => (
              <QuickButton
                key={action.id}
                type="button"
                onClick={() => onQuickAction(action.prompt)}
              >
                {action.label}
              </QuickButton>
            ))}
          </QuickActions>
        ) : null}
      </StatusCard>
    </PanelWrap>
  );
}
