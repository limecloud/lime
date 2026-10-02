/**
 * 设置侧边栏组件
 *
 * 显示分组的设置导航菜单
 * 参考成熟产品的设置侧边栏设计
 */

import styled from "styled-components";
import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useSettingsCategory,
  type CategoryGroup,
  type CategoryItem,
} from "../hooks/useSettingsCategory";
import { SettingsTabs, SettingsGroupKey } from "@/types/settings";

const SidebarContainer = styled.aside`
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
  padding: 0 10px 12px;

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

  @media (max-width: 640px) {
    display: none;
  }
`;

const SearchWrap = styled.div`
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 0 0 10px;
  background: var(
    --lime-sidebar-surface,
    var(--lime-surface-subtle, hsl(var(--card)))
  );
`;

const SearchField = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--lime-sidebar-border, hsl(var(--border)));
  border-radius: 8px;
  background: var(--lime-sidebar-search-bg, hsl(var(--background)));
  color: var(--lime-sidebar-muted, hsl(var(--muted-foreground)));
  &:focus-within {
    border-color: var(--lime-sidebar-active-text, hsl(var(--ring)));
    box-shadow: 0 0 0 2px hsl(var(--ring) / 0.12);
  }
  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--lime-sidebar-foreground, hsl(var(--foreground)));
    font-size: 13px;
  }
  input::placeholder {
    color: var(--lime-sidebar-muted, hsl(var(--muted-foreground)));
  }
  button {
    display: inline-flex;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
`;

const NoResults = styled.div`
  padding: 14px 9px;
  color: var(--lime-sidebar-muted, hsl(var(--muted-foreground)));
  font-size: 13px;
`;

const FloatingNavRoot = styled.div`
  display: none;

  @media (max-width: 640px) {
    display: block;
    position: fixed;
    top: 96px;
    right: 20px;
    z-index: 40;
  }

  @media (max-width: 640px) {
    top: 88px;
    right: 14px;
  }
`;

const GroupContainer = styled.div`
  margin-bottom: 10px;
`;

const GroupHeader = styled.button<{ $expanded: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 9px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--lime-text-muted, hsl(var(--muted-foreground)));

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
  min-height: 32px;
  padding: 6px 9px;
  border: none;
  border-radius: 7px;
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

const FloatingNavButton = styled.button`
  display: inline-flex;
  min-width: 0;
  max-width: min(58vw, 260px);
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--lime-surface-border, hsl(var(--border)));
  border-radius: 999px;
  background: var(--lime-surface, hsl(var(--card)));
  color: var(--lime-text-strong, hsl(var(--foreground)));
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  box-shadow:
    0 10px 28px rgba(15, 23, 42, 0.12),
    0 1px 2px rgba(15, 23, 42, 0.06);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;

  &:hover {
    border-color: var(
      --lime-surface-border-strong,
      hsl(var(--foreground) / 0.18)
    );
    background: var(--lime-surface-hover, hsl(var(--accent)));
  }

  &:active {
    transform: translateY(1px);
  }

  svg {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
  }
`;

const FloatingButtonLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FloatingNavPanel = styled.div`
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: min(420px, calc(100vw - 28px));
  max-height: min(72vh, 640px);
  overflow-y: auto;
  border: 1px solid var(--lime-surface-border, hsl(var(--border)));
  border-radius: 22px;
  background: var(--lime-surface, hsl(var(--card)));
  padding: 10px;
  box-shadow:
    0 24px 56px rgba(15, 23, 42, 0.16),
    0 2px 8px rgba(15, 23, 42, 0.08);

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--lime-sidebar-border, hsl(var(--border)));
    border-radius: 3px;
  }
`;

const FloatingGroup = styled.div`
  padding: 6px 0 8px;

  & + & {
    border-top: 1px solid var(--lime-surface-border, hsl(var(--border)));
  }
`;

const FloatingGroupTitle = styled.div`
  padding: 6px 10px;
  color: var(--lime-text-muted, hsl(var(--muted-foreground)));
  font-size: 12px;
  font-weight: 700;
`;

interface SettingsSidebarProps {
  activeTab: SettingsTabs;
  onTabChange: (tab: SettingsTabs) => void;
  onTabPrefetch?: (tab: SettingsTabs) => void;
}

function findActiveItem(
  groups: CategoryGroup[],
  activeTab: SettingsTabs,
): CategoryItem | null {
  for (const group of groups) {
    const item = group.items.find((candidate) => candidate.key === activeTab);
    if (item) {
      return item;
    }
  }
  return null;
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
  onTabPrefetch,
}: SettingsSidebarProps) {
  const { t } = useTranslation("settings");
  const categoryGroups = useSettingsCategory();
  const floatingPanelId = useId();
  const floatingRootRef = useRef<HTMLDivElement | null>(null);
  const floatingButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const activeItem = useMemo(
    () => findActiveItem(categoryGroups, activeTab),
    [activeTab, categoryGroups],
  );
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return categoryGroups;
    return categoryGroups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLocaleLowerCase().includes(query) ||
            group.title.toLocaleLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [categoryGroups, searchQuery]);

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

  const handleFloatingItemClick = (tab: SettingsTabs) => {
    onTabChange(tab);
    setFloatingOpen(false);
    floatingButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!floatingOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && floatingRootRef.current?.contains(target)) {
        return;
      }
      setFloatingOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setFloatingOpen(false);
      floatingButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [floatingOpen]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };

    document.addEventListener("keydown", handleSearchShortcut);
    return () => {
      document.removeEventListener("keydown", handleSearchShortcut);
    };
  }, []);

  const ActiveIcon = activeItem?.icon;

  return (
    <>
      <SidebarContainer data-testid="settings-sidebar">
        <SearchWrap>
          <SearchField>
            <Search aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t(
                "settings.layout.sidebar.search.placeholder",
                "搜索设置",
              )}
              aria-label={t("settings.layout.sidebar.search.label", "搜索设置")}
              data-testid="settings-sidebar-search"
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label={t(
                  "settings.layout.sidebar.search.clear",
                  "清除搜索",
                )}
                onClick={() => setSearchQuery("")}
              >
                <X aria-hidden />
              </button>
            ) : null}
          </SearchField>
        </SearchWrap>
        {filteredGroups.length === 0 ? (
          <NoResults data-testid="settings-sidebar-no-results">
            {t("settings.layout.sidebar.search.noResults", "没有匹配的设置")}
          </NoResults>
        ) : null}
        {filteredGroups.map((group) => (
          <GroupContainer key={group.key}>
            <GroupHeader
              $expanded={expandedGroups[group.key] ?? true}
              onClick={() => toggleGroup(group.key)}
            >
              {group.title}
              <ChevronDown />
            </GroupHeader>
            <GroupItems
              $expanded={
                Boolean(searchQuery) || (expandedGroups[group.key] ?? true)
              }
            >
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
        ))}
      </SidebarContainer>

      <FloatingNavRoot
        ref={floatingRootRef}
        data-testid="settings-floating-nav"
      >
        <FloatingNavButton
          ref={floatingButtonRef}
          type="button"
          aria-expanded={floatingOpen}
          aria-controls={floatingPanelId}
          aria-label={t("settings.layout.sidebar.floatingNav.openAria")}
          data-testid="settings-floating-nav-button"
          onClick={() => setFloatingOpen((value) => !value)}
        >
          {ActiveIcon ? <ActiveIcon /> : null}
          <FloatingButtonLabel>
            {activeItem?.label ??
              t("settings.layout.sidebar.floatingNav.fallbackLabel")}
          </FloatingButtonLabel>
          <ChevronDown />
        </FloatingNavButton>

        {floatingOpen ? (
          <FloatingNavPanel
            id={floatingPanelId}
            data-testid="settings-floating-nav-panel"
          >
            {filteredGroups.map((group) => (
              <FloatingGroup key={group.key}>
                <FloatingGroupTitle>{group.title}</FloatingGroupTitle>
                <GroupItems $expanded>
                  {group.items.map((item) => (
                    <NavItem
                      key={item.key}
                      $active={activeTab === item.key}
                      aria-current={activeTab === item.key ? "page" : undefined}
                      data-active={String(activeTab === item.key)}
                      data-testid={`settings-floating-tab-${item.key}`}
                      onMouseEnter={() => onTabPrefetch?.(item.key)}
                      onMouseDown={() => onTabPrefetch?.(item.key)}
                      onFocus={() => onTabPrefetch?.(item.key)}
                      onClick={() => handleFloatingItemClick(item.key)}
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
              </FloatingGroup>
            ))}
          </FloatingNavPanel>
        ) : null}
      </FloatingNavRoot>
    </>
  );
}
