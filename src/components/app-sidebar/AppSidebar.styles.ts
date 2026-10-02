import styled from "styled-components";
import {
  APP_SIDEBAR_RAIL_WIDTH,
  APP_SIDEBAR_WIDTH,
} from "./AppSidebar.constants";

export const Container = styled.aside<{
  $collapsed?: boolean;
  $themeMode: "light" | "dark";
  $reserveWindowControls?: boolean;
}>`
  --sidebar-window-control-safe-top: ${({ $reserveWindowControls }) =>
    $reserveWindowControls ? "34px" : "0px"};
  --sidebar-surface-top: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#15202b"
      : "var(--lime-sidebar-surface-top, #f6fbf4)"};
  --sidebar-surface-middle: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#17232d"
      : "var(--lime-sidebar-surface-middle, #f9fcf6)"};
  --sidebar-surface-bottom: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#1a2530"
      : "var(--lime-sidebar-surface-bottom, #fbfff5)"};
  --sidebar-surface: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#17232d" : "var(--lime-sidebar-surface, #f8f8f6)"};
  --sidebar-foreground: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#eef4f7" : "var(--lime-text, #1a3b2b)"};
  --sidebar-muted: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#a1afbd" : "var(--lime-text-muted, #6b826b)"};
  --sidebar-border: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#2d3a46" : "var(--lime-sidebar-border, #e2f0e2)"};
  --sidebar-card-border: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(55, 68, 81, 0.76)"
      : "var(--lime-sidebar-card-border, var(--lime-sidebar-border, #e2f0e2))"};
  --sidebar-divider: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(148, 163, 184, 0.14)"
      : "var(--lime-sidebar-divider, rgba(132, 204, 22, 0.15))"};
  --sidebar-hover: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#22303c" : "var(--lime-sidebar-hover, #eef7ee)"};
  --sidebar-active: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#2a3e3b" : "var(--lime-sidebar-active, #e6f8ea)"};
  --sidebar-active-foreground: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#dff4ea"
      : "var(--lime-sidebar-active-text, #166534)"};
  --sidebar-search-bg: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#1f2b36"
      : "var(--lime-sidebar-search-bg, #fcfff9)"};
  --sidebar-search-hover: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#24313d"
      : "var(--lime-sidebar-search-hover, #f4fdf4)"};
  --sidebar-search-border-hover: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#3a4a57"
      : "var(--lime-sidebar-search-border-hover, #bbf7d0)"};
  --sidebar-card-surface: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "linear-gradient(180deg, rgba(24, 34, 44, 0.96) 0%, rgba(19, 29, 38, 0.98) 100%)"
      : "var(--lime-sidebar-card-surface, linear-gradient(180deg, rgba(255, 255, 255, 0.76) 0%, rgba(249, 252, 246, 0.94) 100%))"};
  --sidebar-card-shadow: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "0 18px 34px -28px rgba(2, 8, 23, 0.7)"
      : "var(--lime-sidebar-card-shadow, 0 14px 28px -26px rgba(15, 23, 42, 0.32))"};
  --sidebar-card-highlight: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(255, 255, 255, 0.08)"
      : "var(--lime-sidebar-card-highlight, rgba(255, 255, 255, 0.72))"};
  display: grid;
  grid-template-columns: ${({ $collapsed }) =>
    $collapsed
      ? `${APP_SIDEBAR_RAIL_WIDTH}px 0px`
      : `${APP_SIDEBAR_RAIL_WIDTH}px minmax(0, 1fr)`};
  width: ${({ $collapsed }) =>
    $collapsed ? `${APP_SIDEBAR_RAIL_WIDTH}px` : `${APP_SIDEBAR_WIDTH}px`};
  min-width: ${({ $collapsed }) =>
    $collapsed ? `${APP_SIDEBAR_RAIL_WIDTH}px` : `${APP_SIDEBAR_WIDTH}px`};
  height: 100vh;
  position: relative;
  isolation: isolate;
  z-index: 30;
  background: var(--sidebar-surface);
  border-right: 1px solid var(--sidebar-border);
  box-shadow: 10px 0 26px -28px rgba(15, 23, 42, 0.38);
  transition:
    width 180ms ease,
    min-width 180ms ease,
    grid-template-columns 180ms ease;
`;

export const SidebarSurface = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: ${({ $collapsed }) =>
    $collapsed
      ? "0"
      : "calc(10px + var(--sidebar-window-control-safe-top)) 10px 12px"};
  overflow: hidden;
  background: var(--sidebar-surface);
`;

export const HeaderArea = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $collapsed }) => ($collapsed ? "8px" : "7px")};
  margin-bottom: 10px;
`;

export const HeaderTopRow = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 2px;
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
  gap: 10px;
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

export const Avatar = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 7px;
  overflow: visible;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
`;

export const UserName = styled.div<{ $collapsed?: boolean }>`
  flex: 1;
  font-size: 14px;
  font-weight: 650;
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
  height: ${({ $inline }) => ($inline ? "30px" : "40px")};
  border-radius: ${({ $inline }) => ($inline ? "8px" : "12px")};
  border: ${({ $inline }) =>
    $inline ? "none" : "1px solid var(--sidebar-card-border)"};
  background: ${({ $inline }) =>
    $inline ? "transparent" : "var(--sidebar-search-bg)"};
  color: var(--sidebar-muted);
  padding: ${({ $inline }) => ($inline ? "0" : "0 12px")};
  cursor: pointer;
  justify-content: ${({ $inline }) => ($inline ? "center" : "flex-start")};
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
  box-shadow: ${({ $inline }) =>
    $inline ? "none" : "inset 0 1px 0 rgba(255, 255, 255, 0.5)"};

  &:hover {
    border-color: ${({ $inline }) =>
      $inline ? "transparent" : "var(--sidebar-search-border-hover)"};
    background: var(--sidebar-search-hover);
    color: var(--sidebar-foreground);
  }

  span {
    display: ${({ $inline }) => ($inline ? "none" : "inline")};
    font-size: 14px;
    font-weight: 600;
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
  flex: 0 1 auto;
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
  $hiddenInExpanded?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "10px")};
  width: 100%;
  height: ${({ $collapsed }) => ($collapsed ? "40px" : "30px")};
  border: none;
  border-radius: 8px;
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 8px")};
  position: relative;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-muted)"};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};
  display: ${({ $collapsed, $hiddenInExpanded }) =>
    !$collapsed && $hiddenInExpanded ? "none" : "flex"};
  box-shadow: none;

  &::before {
    content: "";
    position: absolute;
    left: ${({ $collapsed }) => ($collapsed ? "5px" : "4px")};
    top: 50%;
    width: 3px;
    height: ${({ $active }) => ($active ? "18px" : "0")};
    border-radius: 999px;
    background: var(--sidebar-active-foreground);
    opacity: ${({ $active }) => ($active ? 0.72 : 0)};
    transform: translateY(-50%);
    transition:
      height 0.18s ease,
      opacity 0.18s ease;
  }

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

export const FooterAppearanceActionSlot = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const ActionRow = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "space-between"};
  padding: 0 2px;
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
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-muted)"};
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

export const HeaderInviteButton = styled.button<{
  $collapsed?: boolean;
  $active?: boolean;
}>`
  height: 30px;
  min-width: 28px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "6px")};
  padding: 0;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-hover)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-foreground)" : "var(--sidebar-muted)"};
  opacity: ${({ $active }) => ($active ? 0.86 : 0.68)};
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    opacity 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
    opacity: 0.86;
  }

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  span {
    display: none;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
`;

export const InviteDialogSurface = styled.div`
  --invite-surface: var(--lime-surface, #ffffff);
  --invite-surface-soft: var(--lime-surface-soft, #f8fcf9);
  --invite-surface-muted: var(--lime-surface-muted, #f2f7f3);
  --invite-surface-hover: var(--lime-surface-hover, #f4fdf4);
  --invite-border: var(--lime-surface-border, #e2f0e2);
  --invite-border-strong: var(--lime-surface-border-strong, #c7e7d1);
  --invite-text: var(--lime-text, #1a3b2b);
  --invite-text-strong: var(--lime-text-strong, #0f172a);
  --invite-text-muted: var(--lime-text-muted, #6b826b);
  --invite-brand: var(--lime-brand, #10b981);
  --invite-brand-strong: var(--lime-brand-strong, #166534);
  --invite-brand-soft: var(--lime-brand-soft, #ecfdf5);
  position: relative;
  background: var(--invite-surface);
  color: var(--invite-text);
`;

export const InviteDialogCloseButton = styled.button`
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 2;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: color-mix(in srgb, var(--invite-surface) 84%, transparent);
  color: var(--invite-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    border-color: var(--invite-border);
    background: var(--invite-surface-hover);
    color: var(--invite-text-strong);
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

export const InviteDialogHeader = styled.div`
  display: grid;
  gap: 8px;
  padding: 24px 24px 18px;
  border-bottom: 1px solid var(--invite-border);
  background:
    radial-gradient(
      circle at 18% 0%,
      color-mix(in srgb, var(--invite-brand) 12%, transparent),
      transparent 34%
    ),
    linear-gradient(
      135deg,
      var(--invite-surface-soft) 0%,
      var(--invite-surface) 58%,
      var(--invite-surface-muted) 100%
    );
`;

export const InviteDialogEyebrow = styled.span`
  width: fit-content;
  border-radius: 999px;
  border: 1px solid var(--invite-border-strong);
  background: var(--invite-brand-soft);
  color: var(--invite-brand-strong);
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
`;

export const InviteDialogTitle = styled.h2`
  margin: 0;
  color: var(--invite-text-strong);
  font-size: 22px;
  line-height: 1.25;
  font-weight: 800;
`;

export const InviteDialogDescription = styled.p`
  margin: 0;
  color: var(--invite-text-muted);
  font-size: 13px;
  line-height: 1.7;
`;

export const InviteDialogBody = styled.div`
  display: grid;
  gap: 14px;
  padding: 18px 24px 22px;
`;

export const InviteStatusCard = styled.div<{ $tone?: "error" | "muted" }>`
  border-radius: 16px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "error"
        ? "var(--lime-danger-border, #fecdd3)"
        : "var(--invite-border)"};
  background: ${({ $tone }) =>
    $tone === "error"
      ? "var(--lime-danger-soft, #fff1f2)"
      : "var(--invite-surface-soft)"};
  color: ${({ $tone }) =>
    $tone === "error" ? "var(--lime-danger, #be123c)" : "var(--invite-text)"};
  padding: 14px 15px;
  font-size: 13px;
  line-height: 1.6;
`;

export const InviteShareCard = styled.div`
  display: grid;
  gap: 14px;
  border-radius: 18px;
  border: 1px solid var(--lime-card-subtle-border, var(--invite-border));
  background: var(--invite-surface);
  padding: 16px;
  box-shadow: var(
    --lime-sidebar-card-shadow,
    0 18px 36px -32px rgba(15, 23, 42, 0.32)
  );
`;

export const InviteCodeBlock = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 16px;
  border: 1px dashed
    color-mix(in srgb, var(--invite-brand) 42%, var(--invite-border));
  background: color-mix(
    in srgb,
    var(--invite-brand-soft) 64%,
    var(--invite-surface) 36%
  );
  padding: 14px;
`;

export const InviteCodeMeta = styled.span`
  display: grid;
  gap: 4px;
  min-width: 0;
`;

export const InviteCodeLabel = styled.span`
  color: var(--invite-text-muted);
  font-size: 12px;
  font-weight: 700;
`;

export const InviteCodeValue = styled.strong`
  color: var(--invite-text-strong);
  font-size: 24px;
  letter-spacing: 0.02em;
  line-height: 1.1;
  word-break: break-all;
`;

export const InviteMetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

export const InviteMetaItem = styled.div`
  display: grid;
  gap: 5px;
  border-radius: 14px;
  background: var(--invite-surface-soft);
  padding: 12px;
  min-width: 0;

  span {
    color: var(--invite-text-muted);
    font-size: 12px;
    font-weight: 700;
  }

  strong {
    color: var(--invite-text-strong);
    font-size: 14px;
    font-weight: 800;
    word-break: break-word;
  }
`;

export const InviteActionBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

export const InviteDialogActionButton = styled.button<{ $primary?: boolean }>`
  min-height: 38px;
  border-radius: 12px;
  border: 1px solid
    ${({ $primary }) =>
      $primary ? "var(--invite-brand-strong)" : "var(--invite-border-strong)"};
  background: ${({ $primary }) =>
    $primary ? "var(--invite-brand-strong)" : "var(--invite-surface)"};
  color: ${({ $primary }) =>
    $primary ? "var(--lime-surface, #ffffff)" : "var(--invite-text)"};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 13px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    transform: translateY(-1px);
    background: ${({ $primary }) =>
      $primary
        ? "var(--invite-brand)"
        : "var(--invite-surface-hover, var(--lime-surface-hover, #f4fdf4))"};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.58;
    transform: none;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

export const AppearancePopover = styled.div`
  position: absolute;
  left: calc(100% + 12px);
  bottom: -2px;
  z-index: 70;
  width: 252px;
  max-width: min(252px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 24px));
  overflow-y: auto;
  border-radius: 18px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  box-shadow:
    0 20px 40px -32px rgba(15, 23, 42, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  color: var(--lime-text, #1a3b2b);
  padding: 9px;
  transform-origin: left bottom;
  animation: appearancePopoverIn 150ms ease-out both;

  &::after {
    content: "";
    position: absolute;
    left: -5px;
    bottom: 15px;
    border-left: 1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.92));
    border-bottom: 1px solid
      var(--lime-surface-border, rgba(226, 240, 226, 0.92));
    width: 10px;
    height: 10px;
    transform: rotate(45deg);
    background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  }

  @keyframes appearancePopoverIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 760px) {
    left: auto;
    right: 0;
    bottom: calc(100% + 10px);
    transform-origin: right bottom;

    &::after {
      left: auto;
      right: 13px;
      bottom: -5px;
      border-left: none;
      border-right: 1px solid
        var(--lime-surface-border, rgba(226, 240, 226, 0.92));
    }
  }
`;

export const AppearancePopoverHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 8px;
`;

export const AppearancePopoverTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--lime-text-strong, #0f172a);

  svg {
    width: 15px;
    height: 15px;
    color: var(--lime-brand-strong, #166534);
  }
`;

export const AppearancePopoverSummary = styled.div`
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--lime-text-muted, #6b826b);
`;

export const AppearanceGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 0;
  border-top: 1px solid var(--lime-divider-subtle, rgba(226, 240, 226, 0.82));
`;

export const AppearanceGroupLabel = styled.div`
  padding: 0 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--lime-text-muted, #6b826b);
`;

export const ThemeModeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`;

export const ThemeModeButton = styled.button<{ $active?: boolean }>`
  min-width: 0;
  border-radius: 13px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "var(--lime-card-subtle-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, rgba(226, 240, 226, 0.82))"};
  background: ${({ $active }) =>
    $active
      ? "var(--lime-chrome-tab-active-surface, var(--lime-surface, #ffffff))"
      : "var(--lime-surface, #ffffff)"};
  color: ${({ $active }) =>
    $active
      ? "var(--lime-text-strong, #0f172a)"
      : "var(--lime-text-muted, #6b826b)"};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 6px;
  font-size: 11px;
  font-weight: 700;
  box-shadow: ${({ $active }) =>
    $active ? "0 10px 22px -20px var(--lime-shadow-color)" : "none"};
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(--lime-card-subtle-border, #bbf7d0);
    background: var(
      --lime-chrome-tab-hover,
      var(--lime-surface-hover, #f4fdf4)
    );
    color: var(--lime-text-strong, #0f172a);
  }

  svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }
`;

export const ColorSchemeList = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
`;

export const RandomColorSchemeButton = styled.button`
  grid-column: 1 / -1;
  min-height: 40px;
  border-radius: 13px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.82));
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text, #1a3b2b);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 750;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;

  &:hover {
    border-color: var(--lime-card-subtle-border, #bbf7d0);
    background: var(
      --lime-chrome-tab-hover,
      var(--lime-surface-hover, #f4fdf4)
    );
    color: var(--lime-text-strong, #0f172a);
  }

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--lime-brand-strong, #166534);
  }
`;

export const ColorSchemeButton = styled.button<{ $active?: boolean }>`
  display: flex;
  position: relative;
  min-height: 58px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 5px;
  width: 100%;
  min-width: 0;
  border-radius: 13px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "var(--lime-card-subtle-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, rgba(226, 240, 226, 0.82))"};
  background: ${({ $active }) =>
    $active
      ? "var(--lime-chrome-tab-active-surface, var(--lime-surface, #ffffff))"
      : "var(--lime-surface, #ffffff)"};
  color: var(--lime-text, #1a3b2b);
  cursor: pointer;
  padding: 7px;
  text-align: left;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(--lime-card-subtle-border, #bbf7d0);
    background: var(
      --lime-chrome-tab-hover,
      var(--lime-surface-hover, #f4fdf4)
    );
  }
`;

export const ColorSchemeSwatches = styled.span`
  display: inline-flex;
  flex-shrink: 0;
  overflow: hidden;
  width: 42px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 0 0 1px var(--lime-surface-border, rgba(226, 240, 226, 0.82));

  span {
    flex: 1;
  }
`;

export const ColorSchemeText = styled.span`
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`;

export const ColorSchemeLabel = styled.span`
  min-width: 0;
  max-width: calc(100% - 22px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
  color: var(--lime-text-strong, #0f172a);
`;

export const ColorSchemeCheck = styled.span<{ $active?: boolean }>`
  display: inline-flex;
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--lime-brand-strong, #166534);
  opacity: ${({ $active }) => ($active ? 1 : 0)};

  svg {
    width: 13px;
    height: 13px;
  }
`;

export const AccountMenuAnchor = styled.div<{ $collapsed?: boolean }>`
  position: relative;
  min-width: 0;
  width: 100%;
`;

export const AccountButton = styled.button<{
  $collapsed?: boolean;
  $active?: boolean;
}>`
  width: 100%;
  min-height: ${({ $collapsed }) => ($collapsed ? "38px" : "42px")};
  border: none;
  border-radius: 15px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: var(--sidebar-foreground);
  display: flex;
  align-items: center;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "space-between"};
  gap: 8px;
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "5px 8px")};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
  }
`;

export const AccountIdentity = styled.span<{ $collapsed?: boolean }>`
  min-width: 0;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "inline-flex")};
  align-items: center;
  gap: 9px;
`;

export const AccountAvatar = styled.span`
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--lime-brand, #10b981);
  color: white;
  font-size: 13px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
`;

export const AccountName = styled.span`
  min-width: 0;
  max-width: 116px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
`;

export const AccountTrailing = styled.span<{ $collapsed?: boolean }>`
  display: ${({ $collapsed }) => ($collapsed ? "none" : "inline-flex")};
  align-items: center;
  gap: 7px;
  color: var(--sidebar-muted);

  svg {
    width: 15px;
    height: 15px;
  }
`;

export const AccountStateBadge = styled.span<{ $connected?: boolean }>`
  border-radius: 999px;
  padding: 4px 9px;
  border: 1px solid
    ${({ $connected }) =>
      $connected
        ? "var(--lime-brand-soft-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $connected }) =>
    $connected
      ? "var(--lime-brand-soft, #ecfdf5)"
      : "var(--lime-surface-soft, #f8fcf9)"};
  color: ${({ $connected }) =>
    $connected
      ? "var(--lime-brand-strong, #166534)"
      : "var(--lime-text-muted, #6b826b)"};
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
`;

export const AccountMenuPopover = styled.div<{ $collapsed?: boolean }>`
  position: absolute;
  left: ${({ $collapsed }) => ($collapsed ? "calc(100% + 12px)" : "0")};
  bottom: ${({ $collapsed }) => ($collapsed ? "0" : "calc(100% + 12px)")};
  z-index: 80;
  width: ${({ $collapsed }) => ($collapsed ? "284px" : "304px")};
  max-width: min(304px, calc(100vw - 24px));
  max-height: ${({ $collapsed }) =>
    $collapsed ? "calc(100vh - 24px)" : "calc(100vh - 116px)"};
  overflow: visible;
  overscroll-behavior: contain;
  border-radius: 18px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  box-shadow:
    0 24px 52px -32px rgba(15, 23, 42, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  color: var(--lime-text, #1a3b2b);
  padding: 10px;
  transform-origin: ${({ $collapsed }) =>
    $collapsed ? "left bottom" : "left bottom"};
  animation: accountMenuPopoverIn 150ms ease-out both;

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

  @media (max-height: 640px) {
    bottom: calc(100% + 8px);
    max-height: calc(100vh - 96px);
    overflow-x: hidden;
    overflow-y: auto;
  }

  @keyframes accountMenuPopoverIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

export const AccountPlanCard = styled.div`
  width: 100%;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  border-radius: 14px;
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text, #1a3b2b);
  padding: 10px 11px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const AccountPlanButton = styled.button`
  width: 100%;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  border-radius: 14px;
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text, #1a3b2b);
  padding: 10px 11px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(--lime-brand-soft-border, #bbf7d0);
    background: var(--lime-surface-soft, #f8fcf9);
    transform: translateY(-1px);
  }
`;

export const AccountPlanActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 8px;
`;

export const AccountPlanActionButton = styled.button<{ $primary?: boolean }>`
  min-height: 36px;
  border-radius: 12px;
  border: 1px solid
    ${({ $primary }) =>
      $primary
        ? "var(--lime-brand-strong, #166534)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $primary }) =>
    $primary ? "var(--lime-brand-strong, #166534)" : "var(--lime-surface)"};
  color: ${({ $primary }) =>
    $primary ? "#ffffff" : "var(--lime-text, #1a3b2b)"};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 800;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    transform: translateY(-1px);
    background: ${({ $primary }) =>
      $primary
        ? "var(--lime-brand, #10b981)"
        : "var(--lime-surface-hover, #f4fdf4)"};
  }

  &:disabled {
    cursor: default;
    opacity: 0.66;
    transform: none;
  }

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
`;

export const AccountMenuNotice = styled.div<{ $tone?: "error" | "info" }>`
  border-radius: 12px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "error"
        ? "var(--lime-danger-border, #fecdd3)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $tone }) =>
    $tone === "error" ? "var(--lime-danger-soft, #fff1f2)" : "#f8fcf9"};
  color: ${({ $tone }) =>
    $tone === "error" ? "var(--lime-danger, #be123c)" : "#526455"};
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
`;

export const AccountPlanHeader = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
  font-weight: 800;
  color: var(--lime-text-strong, #0f172a);
`;

export const AccountPlanTitle = styled.span`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AccountPlanDetailsPill = styled.span`
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--lime-surface-soft, #f8fcf9);
  color: var(--lime-text-muted, #6b826b);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  font-size: 10px;
  font-weight: 800;

  svg {
    width: 11px;
    height: 11px;
  }
`;

export const AccountInfoIconButton = styled.button`
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--lime-card-subtle-border, #d9eadf);
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text-muted, #6b826b);
  cursor: help;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    border-color: var(--lime-brand-soft-border, #bbf7d0);
    background: var(--lime-brand-soft, #ecfdf5);
    color: var(--lime-brand-strong, #166534);
  }

  svg {
    width: 13px;
    height: 13px;
  }
`;

export const AccountPlanBadge = styled.span<{ $connected?: boolean }>`
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid
    ${({ $connected }) =>
      $connected
        ? "var(--lime-brand-soft-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $connected }) =>
    $connected ? "var(--lime-brand-soft, #ecfdf5)" : "var(--lime-surface)"};
  color: ${({ $connected }) =>
    $connected
      ? "var(--lime-brand-strong, #166534)"
      : "var(--lime-text-muted, #6b826b)"};
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 800;
`;

export const AccountPlanUsage = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 750;
  color: var(--lime-text-muted, #6b826b);
`;

export const AccountPlanProgressTrack = styled.span`
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: var(--lime-card-subtle-border, #e5e7eb);
  overflow: hidden;
`;

export const AccountPlanProgressFill = styled.span<{ $percent: number | null }>`
  display: block;
  width: ${({ $percent }) => ($percent === null ? "0%" : `${$percent}%`)};
  height: 100%;
  border-radius: inherit;
  background: var(--lime-brand-strong, #166534);
`;

export const AccountPlanMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
  color: var(--lime-text-muted, #6b826b);
`;

export const AccountPlanDetail = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--lime-text-muted, #6b826b);
`;

export const AccountMenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 9px;
`;

export const AccountMenuItemGroup = styled.div`
  position: relative;
`;

export const AccountMenuItem = styled.button<{
  $danger?: boolean;
  $active?: boolean;
}>`
  width: 100%;
  min-height: 40px;
  border: none;
  border-radius: 13px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $danger }) =>
    $danger ? "var(--lime-danger, #ef4444)" : "var(--lime-text, #1a3b2b)"};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: ${({ $danger }) =>
      $danger
        ? "var(--lime-danger-soft, #fff1f2)"
        : "var(--lime-surface-hover, #f4fdf4)"};
  }

  &:disabled {
    cursor: default;
    opacity: 0.62;
  }

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
`;

export const AccountMenuItemLeading = styled.span`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
`;

export const AccountMenuItemTrailing = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--lime-text-muted, #6b826b);
  font-size: 12px;
  font-weight: 700;
`;

export const AccountSubmenuPopover = styled.div`
  position: absolute;
  left: calc(100% + 8px);
  bottom: 0;
  z-index: 90;
  width: 188px;
  max-height: min(300px, calc(100vh - 48px));
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 16px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  box-shadow:
    0 20px 44px -30px rgba(15, 23, 42, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  color: var(--lime-text, #1a3b2b);
  padding: 7px;
  animation: accountSubmenuPopoverIn 140ms ease-out both;

  @keyframes accountSubmenuPopoverIn {
    from {
      opacity: 0;
      transform: translateX(-4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }

  @media (max-width: 760px) {
    left: 0;
    top: calc(100% + 6px);
    bottom: auto;
  }

  @media (max-height: 640px) {
    position: static;
    width: 100%;
    max-height: 180px;
    margin-top: 6px;
    animation: none;
  }
`;

export const AccountSubmenuTitle = styled.div`
  padding: 5px 8px 7px;
  font-size: 11px;
  font-weight: 800;
  color: var(--lime-text-muted, #6b826b);
`;

export const AccountSubmenuItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  min-height: 38px;
  border: none;
  border-radius: 12px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--lime-text, #1a3b2b)"};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 9px;
  font-size: 13px;
  font-weight: 750;
  text-align: left;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: var(--lime-surface-hover, #f4fdf4);
    color: var(--lime-text-strong, #0f172a);
  }

  svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }
`;

export const AccountSubmenuItemText = styled.span`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
`;

export const AccountSubmenuItemLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AccountSubmenuItemHint = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 650;
  color: var(--lime-text-muted, #6b826b);
`;

export const AccountMenuDivider = styled.div`
  height: 1px;
  margin: 5px 0;
  background: var(--lime-divider-subtle, rgba(226, 240, 226, 0.82));
`;
