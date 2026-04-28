/**
 * 设置侧边栏组件
 *
 * 显示分组的设置导航菜单
 * 参考成熟产品的设置侧边栏设计
 */

import styled from "styled-components";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  useSettingsCategory,
  // CategoryGroup,
} from "../hooks/useSettingsCategory";
import { SettingsTabs, SettingsGroupKey } from "@/types/settings";

const SidebarContainer = styled.aside`
  width: 240px;
  min-width: 240px;
  height: 100%;
  border-right: 1px solid var(--lime-sidebar-border, hsl(var(--border)));
  background: var(
    --lime-sidebar-surface,
    var(--lime-surface-subtle, hsl(var(--card)))
  );
  overflow-y: auto;
  padding: 16px 8px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--lime-sidebar-border, hsl(var(--border)));
    border-radius: 2px;
  }

  @media (max-width: 1200px) {
    width: 100%;
    min-width: 0;
    height: auto;
    max-height: min(40vh, 360px);
    border-right: none;
    border-bottom: 1px solid var(--lime-sidebar-border, hsl(var(--border)));
    padding: 12px;
  }

  @media (max-width: 640px) {
    max-height: min(44vh, 320px);
    padding: 10px;
  }
`;

const GroupContainer = styled.div`
  margin-bottom: 8px;
`;

const GroupHeader = styled.button<{ $expanded: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--lime-text-muted, hsl(var(--muted-foreground)));
  text-transform: uppercase;
  letter-spacing: 0.5px;

  svg {
    width: 14px;
    height: 14px;
    transition: transform 0.2s;
    transform: rotate(${({ $expanded }) => ($expanded ? "0deg" : "-90deg")});
  }

  &:hover {
    color: var(--lime-text-strong, hsl(var(--foreground)));
  }
`;

const GroupItems = styled.div<{ $expanded: boolean }>`
  display: ${({ $expanded }) => ($expanded ? "flex" : "none")};
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
`;

const NavItem = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: ${({ $active }) =>
    $active ? "var(--lime-sidebar-active, hsl(var(--accent)))" : "transparent"};
  cursor: pointer;
  font-size: 14px;
  color: ${({ $active }) =>
    $active
      ? "var(--lime-sidebar-active-text, var(--lime-text-strong, hsl(var(--foreground))))"
      : "var(--lime-text-muted, hsl(var(--muted-foreground)))"};
  transition: all 0.15s;
  text-align: left;

  &:hover {
    background: var(--lime-sidebar-hover, hsl(var(--accent)));
    color: var(--lime-text-strong, hsl(var(--foreground)));
  }

  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
`;

const ItemLabel = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ExperimentalBadge = styled.span`
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--lime-warning-border, hsl(var(--destructive) / 0.16));
  background: var(--lime-warning-soft, hsl(var(--destructive) / 0.1));
  color: var(--lime-warning, hsl(var(--destructive)));
  border-radius: 4px;
  flex-shrink: 0;
`;

interface SettingsSidebarProps {
  activeTab: SettingsTabs;
  onTabChange: (tab: SettingsTabs) => void;
  onTabPrefetch?: (tab: SettingsTabs) => void;
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
  onTabPrefetch,
}: SettingsSidebarProps) {
  const categoryGroups = useSettingsCategory();

  // 默认展开所有分组
  const [expandedGroups, setExpandedGroups] = useState<
    Record<SettingsGroupKey, boolean>
  >({
    [SettingsGroupKey.Overview]: true,
    [SettingsGroupKey.Account]: true,
    [SettingsGroupKey.General]: true,
    [SettingsGroupKey.Agent]: true,
    [SettingsGroupKey.System]: true,
  });

  const toggleGroup = (key: SettingsGroupKey) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <SidebarContainer data-testid="settings-sidebar">
      {categoryGroups.map((group) => (
        <GroupContainer key={group.key}>
          <GroupHeader
            $expanded={expandedGroups[group.key] ?? true}
            onClick={() => toggleGroup(group.key)}
          >
            {group.title}
            <ChevronDown />
          </GroupHeader>
          <GroupItems $expanded={expandedGroups[group.key] ?? true}>
            {group.items.map((item) => (
              <NavItem
                key={item.key}
                $active={activeTab === item.key}
                data-active={String(activeTab === item.key)}
                onMouseEnter={() => onTabPrefetch?.(item.key)}
                onMouseDown={() => onTabPrefetch?.(item.key)}
                onFocus={() => onTabPrefetch?.(item.key)}
                onClick={() => onTabChange(item.key)}
              >
                <item.icon />
                <ItemLabel>{item.label}</ItemLabel>
                {item.experimental && (
                  <ExperimentalBadge>实验</ExperimentalBadge>
                )}
              </NavItem>
            ))}
          </GroupItems>
        </GroupContainer>
      ))}
    </SidebarContainer>
  );
}
