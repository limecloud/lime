import React, { memo } from "react";
import styled from "styled-components";
import { ChevronRight, Home } from "lucide-react";

export interface CanvasBreadcrumbHeaderProps {
  label: string;
  onBackHome?: () => void;
  backTitle?: string;
}

const Header = styled.div`
  height: 26px;
  display: flex;
  align-items: center;
  gap: 4px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  padding: 0 2px;
`;

const HomeButton = styled.button`
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--accent));
  }
`;

const CurrentLabel = styled.span`
  font-weight: 600;
  color: hsl(var(--muted-foreground));
`;

export const CanvasBreadcrumbHeader: React.FC<CanvasBreadcrumbHeaderProps> =
  memo(({ label, onBackHome, backTitle = "返回新建任务" }) => {
    return (
      <Header>
        <HomeButton
          type="button"
          onClick={onBackHome}
          title={backTitle}
          aria-label={backTitle}
        >
          <Home size={12} />
        </HomeButton>
        <ChevronRight size={12} />
        <CurrentLabel>{label}</CurrentLabel>
      </Header>
    );
  });

CanvasBreadcrumbHeader.displayName = "CanvasBreadcrumbHeader";
