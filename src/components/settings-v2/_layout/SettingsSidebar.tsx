/**
 * 设置侧边栏组件
 *
 * 显示分组的设置导航菜单
 * 参考成熟产品的设置侧边栏设计
 */

import styled from "styled-components";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCommand } from "@/lib/commands/useCommand";
import { useSettingsCategory } from "../hooks/useSettingsCategory";
import { SettingsTabs } from "@/types/settings";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import { searchSettings, type SettingsSearchResult } from "../settingsSearch";
import { SettingsSearch } from "./SettingsSearch";

const SidebarContainer = styled.div`
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  border: none;
  background: var(
    --lime-sidebar-surface,
    var(--lime-surface-subtle, hsl(var(--card)))
  );
  overflow-y: auto;
  padding: 4px 8px 16px;

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
`;

const GroupContainer = styled.div`
  margin-bottom: 16px;
`;

const GroupHeader = styled.div`
  padding: 0 8px 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--lime-text-muted, hsl(var(--muted-foreground)));
`;

const GroupItems = styled.div`
  display: flex;
  flex-direction: column;
`;

const NavItem = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 10px;
  background: ${({ $active }) =>
    $active ? "var(--lime-sidebar-active, hsl(var(--accent)))" : "transparent"};
  cursor: pointer;
  font-size: 13px;
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
    width: 16px;
    height: 16px;
    stroke-width: 1.7;
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
  onSearchSelect?: (result: SettingsSearchResult) => void;
  searchRequestKey?: number;
  navigationPending?: boolean;
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
  onTabPrefetch,
  onSearchSelect,
  searchRequestKey,
  navigationPending,
}: SettingsSidebarProps) {
  const { t } = useTranslation("settings");
  const categoryGroups = useSettingsCategory();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const localProfile = !resolveOemCloudRuntimeContext();
  const results = useMemo(
    () => searchSettings(searchQuery, categoryGroups, t, localProfile),
    [searchQuery, categoryGroups, t, localProfile],
  );
  const selectResult = (result: SettingsSearchResult) => {
    if (onSearchSelect) onSearchSelect(result);
    else onTabChange(result.section);
  };
  const searchProps = {
    query: searchQuery,
    results,
    onQueryChange: setSearchQuery,
    onSelect: selectResult,
    onPrefetch: onTabPrefetch,
  };

  useEffect(() => {
    setSearchQuery("");
  }, [activeTab, searchRequestKey]);

  useCommand({
    id: "searchSettings",
    titleKey: "commands.searchSettings.title",
    descriptionKey: "commands.searchSettings.description",
    section: "configure",
    bindings: ["CommandOrControl+F"],
    target: document,
    enabled: !navigationPending,
    allowInInput: true,
    handler: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
  });

  return (
    <SidebarContainer data-testid="settings-sidebar">
      <SettingsSearch {...searchProps} inputRef={searchInputRef} />
      {!searchQuery.trim()
        ? categoryGroups.map((group) => (
            <GroupContainer key={group.key}>
              <GroupHeader>{group.title}</GroupHeader>
              <GroupItems>
                {group.items.map((item) => (
                  <NavItem
                    key={item.key}
                    $active={activeTab === item.key}
                    aria-current={activeTab === item.key ? "page" : undefined}
                    data-active={String(activeTab === item.key)}
                    data-testid={`settings-sidebar-tab-${item.key}`}
                    onMouseEnter={() => onTabPrefetch?.(item.key)}
                    onMouseDown={() => onTabPrefetch?.(item.key)}
                    onFocus={() => onTabPrefetch?.(item.key)}
                    onClick={() => onTabChange(item.key)}
                  >
                    <item.icon />
                    <ItemLabel>{item.label}</ItemLabel>
                    {item.experimental && (
                      <ExperimentalBadge>
                        {t("settings.layout.sidebar.experimentalBadge")}
                      </ExperimentalBadge>
                    )}
                  </NavItem>
                ))}
              </GroupItems>
            </GroupContainer>
          ))
        : null}
    </SidebarContainer>
  );
}
