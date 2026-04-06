import { useState } from "react";
import {
  ChevronDown,
  Loader2,
  Clock3,
  AlertCircle,
  Sparkles,
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
  renderGeneratingPanel: boolean;
  onQuickAction: (prompt: string) => void;
  onStop?: () => void;
}

const GateStrip = styled.div`
  margin: 0 12px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 10px;
  padding: 8px 10px;
  border-radius: 14px;
  border: 1px solid hsl(var(--border) / 0.92);
  background: hsl(var(--muted) / 0.78);
  box-shadow: none;
  opacity: 1;

  @media (prefers-color-scheme: dark) {
    background: hsl(222 18% 14% / 0.96);
    border-color: hsl(217 18% 24% / 0.95);
  }
`;

const GateMeta = styled.div`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`;

const GateIcon = styled.span`
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border) / 0.9);
  flex-shrink: 0;
`;

const GateTitle = styled.span`
  font-size: 12px;
  color: hsl(var(--foreground) / 0.86);
  font-weight: 600;
  line-height: 1.4;
`;

const GateStatus = styled.span<{
  $status: "running" | "waiting" | "idle";
}>`
  font-size: 11px;
  line-height: 1;
  border-radius: 999px;
  padding: 4px 8px;
  color: ${({ $status }) =>
    $status === "waiting"
      ? "hsl(var(--destructive))"
      : $status === "running"
        ? "hsl(var(--primary))"
        : "hsl(var(--muted-foreground))"};
  background: ${({ $status }) =>
    $status === "waiting"
      ? "hsl(var(--destructive) / 0.08)"
      : $status === "running"
        ? "hsl(var(--primary) / 0.1)"
        : "hsl(var(--muted) / 0.7)"};
`;

const QuickActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
`;

const QuickButton = styled.button`
  border: 1px solid hsl(var(--border) / 0.88);
  border-radius: 999px;
  background: hsl(var(--background));
  color: hsl(var(--foreground) / 0.82);
  font-size: 11px;
  line-height: 1.2;
  padding: 5px 10px;
  cursor: pointer;

  &:hover {
    border-color: hsl(var(--primary) / 0.22);
    color: hsl(var(--foreground));
    background: hsl(var(--background));
  }
`;

const GeneratingWrap = styled.div`
  margin: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const TaskCard = styled.div`
  border: 1px solid hsl(var(--border) / 0.78);
  border-radius: 15px;
  background: hsl(var(--background));
  box-shadow: 0 8px 20px hsl(var(--foreground) / 0.05);
  padding: 11px 12px 10px;
`;

const TaskHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  margin-bottom: 8px;
`;

const TaskHeadButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
`;

const TaskHeadChevron = styled.span<{ $collapsed: boolean }>`
  display: inline-flex;
  transition: transform 0.2s ease;
  transform: ${({ $collapsed }) =>
    $collapsed ? "rotate(-90deg)" : "rotate(0deg)"};
`;

const TaskList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TaskRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  min-width: 0;
`;

const TaskIcon = styled.span<{ $kind: "active" | "pending" | "error" }>`
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ $kind }) =>
    $kind === "active"
      ? "hsl(var(--primary) / 0.12)"
      : $kind === "error"
        ? "hsl(var(--destructive) / 0.1)"
        : "hsl(38 100% 92%)"};
  color: ${({ $kind }) =>
    $kind === "active"
      ? "hsl(var(--primary))"
      : $kind === "error"
        ? "hsl(var(--destructive))"
        : "hsl(30 90% 42%)"};
  flex-shrink: 0;
`;

const TaskText = styled.span`
  flex: 1;
  font-size: 14px;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TaskStatus = styled.span<{ $kind: "active" | "pending" | "error" }>`
  font-size: 11px;
  border-radius: 999px;
  padding: 4px 10px;
  line-height: 1;
  font-weight: 600;
  color: ${(props) =>
    props.$kind === "active"
      ? "hsl(var(--primary))"
      : props.$kind === "error"
        ? "hsl(var(--destructive))"
        : "hsl(35 95% 35%)"};
  background: ${(props) =>
    props.$kind === "active"
      ? "hsl(var(--primary) / 0.14)"
      : props.$kind === "error"
        ? "hsl(var(--destructive) / 0.12)"
        : "hsl(36 100% 90%)"};
`;

const RunningBar = styled.div`
  min-height: 44px;
  border: 1px solid hsl(var(--border));
  border-radius: 11px;
  background: hsl(var(--background));
  box-shadow: 0 4px 14px hsl(var(--foreground) / 0.04);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
`;

const RunningIcon = styled.span`
  color: hsl(var(--primary));
  display: inline-flex;
  flex-shrink: 0;
`;

const RunningSub = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RunningMain = styled.span`
  color: hsl(var(--primary));
  font-weight: 600;
  margin-right: 2px;
  font-size: 14px;
`;

const StopButton = styled.button`
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.28);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
  position: relative;

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

export function InputbarWorkflowStatusPanel({
  gate,
  quickActions,
  queueItems,
  renderGeneratingPanel,
  onQuickAction,
  onStop,
}: InputbarWorkflowStatusPanelProps) {
  const [queueCollapsed, setQueueCollapsed] = useState(false);

  if (renderGeneratingPanel) {
    return (
      <GeneratingWrap>
        <TaskCard>
          <TaskHead>
            <TaskHeadButton
              type="button"
              onClick={() => setQueueCollapsed((prev) => !prev)}
              aria-label={queueCollapsed ? "展开待办列表" : "折叠待办列表"}
            >
              <span>当前待办</span>
              <TaskHeadChevron $collapsed={queueCollapsed}>
                <ChevronDown size={14} />
              </TaskHeadChevron>
            </TaskHeadButton>
          </TaskHead>
          {!queueCollapsed ? (
            <TaskList>
              {queueItems.length === 0 ? (
                <TaskRow>
                  <TaskIcon $kind="active">
                    <Loader2 size={14} className="animate-spin" />
                  </TaskIcon>
                  <TaskText>正在编排任务节点...</TaskText>
                  <TaskStatus $kind="active">进行中</TaskStatus>
                </TaskRow>
              ) : (
                queueItems.map((item) => {
                  const statusKind =
                    item.status === "active"
                      ? "active"
                      : item.status === "error"
                        ? "error"
                        : "pending";
                  return (
                    <TaskRow key={item.id}>
                      <TaskIcon $kind={statusKind}>
                        {statusKind === "active" ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : statusKind === "error" ? (
                          <AlertCircle size={14} />
                        ) : (
                          <Clock3 size={14} />
                        )}
                      </TaskIcon>
                      <TaskText>{item.title}</TaskText>
                      <TaskStatus $kind={statusKind}>
                        {statusKind === "active"
                          ? "进行中"
                          : statusKind === "error"
                            ? "异常"
                            : "待处理"}
                      </TaskStatus>
                    </TaskRow>
                  );
                })
              )}
            </TaskList>
          ) : null}
        </TaskCard>
        <RunningBar>
          <RunningIcon>
            <Sparkles size={13} />
          </RunningIcon>
          <RunningMain>正在生成中 • • •</RunningMain>
          <RunningSub>切换项目或关闭网页将中断任务</RunningSub>
          <StopButton
            type="button"
            data-testid="workflow-stop"
            onClick={() => onStop?.()}
            aria-label="停止生成"
          >
            <StopGlyph />
          </StopButton>
        </RunningBar>
      </GeneratingWrap>
    );
  }

  if (!gate || gate.status === "idle") {
    return null;
  }

  return (
    <GateStrip>
      <GateMeta>
        <GateIcon>
          <Sparkles size={13} />
        </GateIcon>
        <GateTitle>{gate.title}</GateTitle>
        <GateStatus $status={gate.status}>
          {gate.status === "waiting"
            ? "等待决策"
            : gate.status === "running"
              ? "自动执行中"
              : "待启动"}
        </GateStatus>
      </GateMeta>
      {quickActions.length > 0 ? (
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
    </GateStrip>
  );
}
