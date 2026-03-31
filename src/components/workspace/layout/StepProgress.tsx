/**
 * @file 步骤进度条组件
 * @description 显示工作流步骤进度
 * @module components/workspace/layout/StepProgress
 */

import React, { memo } from "react";
import styled from "styled-components";
import { Check, Circle } from "lucide-react";
import { WorkflowStep } from "@/lib/workspace/workflowTypes";

const Container = styled.div`
  display: flex;
  align-items: center;
  padding: 16px;
  background: hsl(var(--card));
  border-bottom: 1px solid hsl(var(--border));
  overflow-x: auto;

  &::-webkit-scrollbar {
    height: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.3);
    border-radius: 2px;
  }
`;

const StepItem = styled.button<{ $status: string; $clickable: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  cursor: ${({ $clickable }) => ($clickable ? "pointer" : "default")};
  opacity: ${({ $status }) => ($status === "pending" ? 0.5 : 1)};
  transition: opacity 0.2s;

  &:hover {
    opacity: ${({ $clickable }) => ($clickable ? 1 : undefined)};
  }
`;

const StepCircle = styled.div<{ $status: string }>`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s;

  ${({ $status }) => {
    switch ($status) {
      case "completed":
        return `
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
        `;
      case "active":
        return `
          background: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          border: 2px solid hsl(var(--primary));
        `;
      case "skipped":
        return `
          background: hsl(var(--muted));
          color: hsl(var(--muted-foreground));
          text-decoration: line-through;
        `;
      default:
        return `
          background: hsl(var(--muted));
          color: hsl(var(--muted-foreground));
        `;
    }
  }}
`;

const StepLabel = styled.span<{ $status: string }>`
  font-size: 12px;
  white-space: nowrap;
  color: ${({ $status }) =>
    $status === "active"
      ? "hsl(var(--primary))"
      : "hsl(var(--muted-foreground))"};
  font-weight: ${({ $status }) => ($status === "active" ? 500 : 400)};
`;

const Connector = styled.div<{ $completed: boolean }>`
  width: 32px;
  height: 2px;
  background: ${({ $completed }) =>
    $completed ? "hsl(var(--primary))" : "hsl(var(--border))"};
  transition: background 0.2s;
`;

interface StepProgressProps {
  /** 步骤列表 */
  steps: WorkflowStep[];
  /** 当前步骤索引 */
  currentIndex: number;
  /** 点击步骤回调 */
  onStepClick?: (index: number) => void;
}

/**
 * 步骤进度条组件
 *
 * 显示工作流步骤进度，支持点击跳转到已完成的步骤
 */
export const StepProgress: React.FC<StepProgressProps> = memo(
  ({ steps, currentIndex: _currentIndex, onStepClick }) => {
    const handleClick = (index: number) => {
      const step = steps[index];
      // 只能点击已完成或已跳过的步骤
      if (step.status === "completed" || step.status === "skipped") {
        onStepClick?.(index);
      }
    };

    return (
      <Container>
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <StepItem
              $status={step.status}
              $clickable={
                step.status === "completed" || step.status === "skipped"
              }
              onClick={() => handleClick(index)}
            >
              <StepCircle $status={step.status}>
                {step.status === "completed" ? (
                  <Check size={14} />
                ) : step.status === "active" ? (
                  <Circle size={14} />
                ) : (
                  index + 1
                )}
              </StepCircle>
              <StepLabel $status={step.status}>{step.title}</StepLabel>
            </StepItem>

            {index < steps.length - 1 && (
              <Connector
                $completed={
                  steps[index].status === "completed" ||
                  steps[index].status === "skipped"
                }
              />
            )}
          </React.Fragment>
        ))}
      </Container>
    );
  },
);

StepProgress.displayName = "StepProgress";
