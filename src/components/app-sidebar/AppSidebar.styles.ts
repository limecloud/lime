import styled from "styled-components";
import {
  APP_SIDEBAR_WIDTH,
  APP_SIDEBAR_MIN_WIDTH,
  APP_SIDEBAR_MAX_WIDTH,
} from "./AppSidebar.constants";

export const Container = styled.aside<{
  $collapsed?: boolean;
}>`
  --sidebar-surface-top: var(--lime-sidebar-surface-top);
  --sidebar-surface-middle: var(--lime-sidebar-surface-middle);
  --sidebar-surface-bottom: var(--lime-sidebar-surface-bottom);
  --sidebar-surface: var(--lime-sidebar-surface);
  --sidebar-foreground: var(--lime-text);
  --sidebar-muted: var(--lime-text-muted);
  --sidebar-border: var(--lime-sidebar-border);
  --sidebar-card-border: var(--lime-sidebar-card-border);
  --sidebar-divider: var(--lime-sidebar-divider);
  --sidebar-hover: var(--lime-sidebar-hover);
  --sidebar-active: var(--lime-sidebar-active);
  --sidebar-active-foreground: var(--lime-sidebar-active-text);
  --sidebar-search-bg: var(--lime-sidebar-search-bg);
  --sidebar-search-hover: var(--lime-sidebar-search-hover);
  --sidebar-search-border-hover: var(--lime-sidebar-search-border-hover);
  --sidebar-card-surface: var(--lime-sidebar-card-surface);
  --sidebar-card-shadow: var(--lime-sidebar-card-shadow);
  --sidebar-card-highlight: var(--lime-sidebar-card-highlight);
  display: flex;
  width: ${({ $collapsed }) =>
    $collapsed
      ? "52px"
      : `clamp(${APP_SIDEBAR_MIN_WIDTH}px, var(--sidebar-preferred-width, ${APP_SIDEBAR_WIDTH}px), min(${APP_SIDEBAR_MAX_WIDTH}px, calc(100vw - 320px)))`};
  min-width: ${({ $collapsed }) =>
    $collapsed ? "52px" : `${APP_SIDEBAR_MIN_WIDTH}px`};
  flex-shrink: 0;
  height: calc(100vh - 48px);
  margin-top: 44px;
  position: relative;
  isolation: isolate;
  z-index: 20;
  background: var(--sidebar-surface);
  border-right: none;
  transition:
    width 180ms ease,
    min-width 180ms ease,
    border-color 180ms ease;
`;

export const SidebarSurface = styled.div<{ $collapsed?: boolean }>`
  flex: 1;
  width: 0;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "flex")};
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 8px 8px")};
  overflow: hidden;
  background: var(--sidebar-surface);
`;

export const HeaderArea = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-bottom: 4px;
`;

export const HeaderTopRow = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 52px;
  ${({ $collapsed }) =>
    $collapsed
      ? `
        flex-direction: column;
      `
      : ""}
`;

export const UserButton = styled.button<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  width: ${({ $collapsed }) => ($collapsed ? "38px" : "100%")};
  min-width: 0;
  flex: ${({ $collapsed }) => ($collapsed ? "0 0 auto" : "1 1 auto")};
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: ${({ $collapsed }) => ($collapsed ? "8px" : "5px 7px")};
  cursor: pointer;
  color: var(--sidebar-foreground);
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
  }
`;

export const UserName = styled.div<{ $collapsed?: boolean }>`
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

export const SearchButton = styled.button<{
  $collapsed?: boolean;
  $inline?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: ${({ $inline }) => ($inline ? "26px" : "100%")};
  flex-shrink: 0;
  height: 30px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--sidebar-muted);
  padding: ${({ $inline }) => ($inline ? "0" : "0 8px")};
  cursor: pointer;
  justify-content: ${({ $inline }) => ($inline ? "center" : "flex-start")};
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
  box-shadow: none;

  &:hover {
    border-color: ${({ $inline }) =>
      $inline ? "transparent" : "var(--sidebar-search-border-hover)"};
    background: var(--sidebar-search-hover);
    color: var(--sidebar-foreground);
  }

  span {
    display: ${({ $inline }) => ($inline ? "none" : "inline")};
    font-size: 14px;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }
`;

export const SidebarSearchSurface = styled.div`
  display: flex;
  min-height: min(620px, calc(100vh - 96px));
  max-height: calc(100vh - 96px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.9));
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text, #1a3b2b);
  box-shadow:
    0 32px 80px rgba(15, 23, 42, 0.18),
    0 1px 0 rgba(255, 255, 255, 0.78) inset;
`;

export const SidebarSearchHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px 26px 18px;
  color: var(--lime-text-muted, #6b826b);

  svg {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }
`;

export const SidebarSearchInput = styled.input`
  min-width: 0;
  flex: 1;
  border: none;
  background: transparent;
  color: var(--lime-text-strong, #0f172a);
  font-size: 19px;
  font-weight: 650;
  outline: none;

  &::placeholder {
    color: var(--lime-text-soft, #9aa89a);
    font-weight: 600;
  }
`;

export const SidebarSearchShortcut = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

export const SidebarSearchKey = styled.kbd`
  min-width: 28px;
  height: 28px;
  border-radius: 9px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.86));
  background: var(--lime-muted-surface, #f5f8f3);
  color: var(--lime-text-muted, #6b826b);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
`;

export const SidebarSearchCloseButton = styled.button`
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--lime-text-muted, #6b826b);
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: var(--lime-surface-hover, #f4fdf4);
    color: var(--lime-text-strong, #0f172a);
  }

  svg {
    width: 22px;
    height: 22px;
  }
`;

export const SidebarSearchDivider = styled.div`
  height: 1px;
  margin: 0 26px;
  background: var(--lime-divider-subtle, rgba(226, 240, 226, 0.86));
`;

export const SidebarSearchBody = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding: 20px 26px 28px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: var(--lime-divider-strong, rgba(180, 196, 180, 0.7));
  }
`;

export const SidebarSearchCreateButton = styled.button`
  min-height: 58px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 18px;
  background: var(--lime-surface-hover, #f4f7f2);
  color: var(--lime-text-strong, #0f172a);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(--lime-card-subtle-border, #bbf7d0);
    background: var(--lime-surface, #ffffff);
    transform: translateY(-1px);
  }

  svg {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    color: var(--lime-text-muted, #6b826b);
  }
`;

export const SidebarSearchCreateText = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 760;
`;

export const SidebarSearchEnterHint = styled.span`
  flex-shrink: 0;
  color: var(--lime-text-soft, #9aa89a);
  font-size: 20px;
  font-weight: 800;
`;

export const SidebarSearchSectionLabel = styled.div`
  padding: 0 16px;
  color: var(--lime-text-soft, #9aa89a);
  font-size: 13px;
  font-weight: 760;
`;

export const SidebarSearchResultList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const SidebarSearchResultButton = styled.button<{ $active?: boolean }>`
  width: 100%;
  min-height: 54px;
  border: 1px solid
    ${({ $active }) =>
      $active ? "var(--lime-card-subtle-border, #bbf7d0)" : "transparent"};
  border-radius: 16px;
  background: ${({ $active }) =>
    $active ? "var(--lime-surface-hover, #f4fdf4)" : "transparent"};
  color: var(--lime-text, #1a3b2b);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    border-color: var(--lime-card-subtle-border, rgba(187, 247, 208, 0.92));
    background: var(--lime-surface-hover, #f4fdf4);
    color: var(--lime-text-strong, #0f172a);
  }

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }

  &:disabled:hover {
    border-color: transparent;
    background: transparent;
    color: var(--lime-text, #1a3b2b);
  }

  svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    color: var(--lime-text-muted, #6b826b);
  }
`;

export const SidebarSearchResultTitle = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 700;
`;

export const SidebarSearchResultMeta = styled.span`
  flex-shrink: 0;
  color: var(--lime-text-soft, #9aa89a);
  font-size: 14px;
  font-weight: 650;
`;

export const SidebarSearchEmptyState = styled.div`
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  border: 1px dashed var(--lime-card-subtle-border, rgba(226, 240, 226, 0.9));
  color: var(--lime-text-muted, #6b826b);
  background: var(--lime-muted-surface, #f8faf7);
  font-size: 14px;
  font-weight: 680;
`;

export const SidebarSearchMoreButton = styled.button`
  min-height: 42px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.86));
  border-radius: 14px;
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text-muted, #6b826b);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 760;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover:not(:disabled) {
    border-color: var(--lime-card-subtle-border, #bbf7d0);
    background: var(--lime-surface-hover, #f4fdf4);
    color: var(--lime-text-strong, #0f172a);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.62;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

export const MenuScroll = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--sidebar-border);
    border-radius: 9999px;
  }
`;

export const MainNavList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
`;

export const NavButton = styled.button<{
  $active?: boolean;
  $collapsed?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "10px")};
  width: 100%;
  height: ${({ $collapsed }) => ($collapsed ? "40px" : "30px")};
  border: none;
  border-radius: 10px;
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 8px")};
  position: relative;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active
      ? "var(--sidebar-active-foreground)"
      : "var(--sidebar-muted, var(--lime-text-muted, hsl(var(--muted-foreground))))"};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};
  box-shadow: none;

  &:hover {
    background: ${({ $active }) =>
      $active ? "var(--sidebar-active)" : "var(--sidebar-hover)"};
    color: ${({ $active }) =>
      $active
        ? "var(--sidebar-active-foreground)"
        : "var(--sidebar-foreground)"};
  }

  svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    opacity: ${({ $active }) => ($active ? 1 : 0.92)};
  }
`;

export const NavLabel = styled.span<{ $collapsed?: boolean }>`
  flex: 1;
  text-align: left;
  font-size: 13px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "inline")};
`;

export const IconActionButton = styled.button<{ $active?: boolean }>`
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active
      ? "var(--sidebar-active-foreground)"
      : "var(--sidebar-muted, var(--lime-text-muted, hsl(var(--muted-foreground))))"};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: ${({ $active }) =>
      $active ? "var(--sidebar-active)" : "var(--sidebar-hover)"};
    color: ${({ $active }) =>
      $active
        ? "var(--sidebar-active-foreground)"
        : "var(--sidebar-foreground)"};
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;
