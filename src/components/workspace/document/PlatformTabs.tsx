/**
 * @file 平台切换标签组件
 * @description 切换不同平台的预览样式
 * @module components/workspace/document/PlatformTabs
 */

import React, { memo } from "react";
import styled from "styled-components";
import type { PlatformTabsProps, PlatformType } from "./types";
import { PLATFORM_CONFIGS } from "./types";

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  background: hsl(var(--muted) / 0.3);
  border-top: 1px solid hsl(var(--border));
`;

const TabButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  background: ${({ $active }) =>
    $active ? "hsl(var(--background))" : "transparent"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
  box-shadow: ${({ $active }) =>
    $active ? "0 1px 3px rgba(0, 0, 0, 0.1)" : "none"};

  &:hover {
    background: ${({ $active }) =>
      $active ? "hsl(var(--background))" : "hsl(var(--muted) / 0.5)"};
    color: hsl(var(--foreground));
  }
`;

const TabIcon = styled.span`
  font-size: 14px;
`;

const TabLabel = styled.span`
  font-weight: 500;
`;

/**
 * 平台切换标签组件
 */
export const PlatformTabs: React.FC<PlatformTabsProps> = memo(
  ({ currentPlatform, onPlatformChange }) => {
    return (
      <Container>
        {PLATFORM_CONFIGS.map((platform) => (
          <TabButton
            key={platform.id}
            $active={currentPlatform === platform.id}
            onClick={() => onPlatformChange(platform.id as PlatformType)}
            title={platform.description}
          >
            <TabIcon>{platform.icon}</TabIcon>
            <TabLabel>{platform.name}</TabLabel>
          </TabButton>
        ))}
      </Container>
    );
  },
);

PlatformTabs.displayName = "PlatformTabs";
