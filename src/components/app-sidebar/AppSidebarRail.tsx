import { Home, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import styled from "styled-components";
import type { SidebarNavItemDefinition } from "@/lib/navigation/sidebarNav";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AppSidebarRailProps {
  collapsed: boolean;
  homeLabel: string;
  expandLabel?: string;
  homeActive: boolean;
  items: SidebarNavItemDefinition[];
  settingsItem: SidebarNavItemDefinition | null;
  isActive: (item: SidebarNavItemDefinition) => boolean;
  onHome: () => void;
  onNavigate: (item: SidebarNavItemDefinition) => void;
  onExpand?: () => void;
  searchSlot?: ReactNode;
  appearanceSlot?: ReactNode;
}

const Rail = styled.nav<{ $collapsed: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  padding: calc(10px + var(--sidebar-window-control-safe-top)) 5px 16px;
  background: var(--sidebar-surface-top);
  border-right: 1px solid var(--sidebar-divider);
`;

const RailButton = styled.button<{ $active: boolean }>`
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-muted)"};
  cursor: pointer;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
  }

  &:focus-visible {
    outline: 2px solid var(--sidebar-active-foreground);
    outline-offset: 2px;
  }

  svg {
    width: 17px;
    height: 17px;
    stroke-width: 1.7;
  }
`;

const RailSpacer = styled.div`
  flex: 1;
`;

export function AppSidebarRail({
  collapsed,
  homeLabel,
  expandLabel = homeLabel,
  homeActive,
  items,
  settingsItem,
  isActive,
  onHome,
  onNavigate,
  onExpand,
  searchSlot,
  appearanceSlot,
}: AppSidebarRailProps) {
  const renderItem = (item: SidebarNavItemDefinition) => (
    <div key={item.id}>
      <Tooltip>
        <TooltipTrigger asChild>
          <RailButton
            type="button"
            $active={isActive(item)}
            aria-label={item.label}
            aria-current={isActive(item) ? "page" : undefined}
            onClick={() => onNavigate(item)}
            data-testid={`app-sidebar-nav-${item.id}`}
          >
            <item.icon />
            <span className="sr-only">{item.label}</span>
          </RailButton>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
      <RailButton
        type="button"
        $active={isActive(item)}
        aria-hidden="true"
        aria-current={isActive(item) ? "page" : undefined}
        tabIndex={-1}
        onClick={() => onNavigate(item)}
        data-testid={`app-sidebar-rail-${item.id}`}
        style={{ display: "none" }}
      />
    </div>
  );

  return (
    <Rail
      $collapsed={collapsed}
      aria-label={homeLabel}
      data-testid="app-sidebar-rail"
    >
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <RailButton
              type="button"
              $active={homeActive}
              aria-label={homeLabel}
              onClick={onHome}
              data-testid="app-sidebar-nav-home-general"
            >
              <Home />
              <span className="sr-only">{homeLabel}</span>
            </RailButton>
          </TooltipTrigger>
          <TooltipContent side="right">{expandLabel}</TooltipContent>
        </Tooltip>
        <RailButton
          type="button"
          $active={false}
          aria-hidden="true"
          tabIndex={-1}
          onClick={onHome}
          data-testid="app-sidebar-rail-home"
          style={{ display: "none" }}
        />
      </div>
      {collapsed && searchSlot ? (
        <RailSlot data-testid="app-sidebar-rail-search">
          {searchSlot}
        </RailSlot>
      ) : null}
      {items.map(renderItem)}
      <RailSpacer />
      <RailDivider aria-hidden="true" />
      {collapsed && onExpand ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <RailButton
              type="button"
              $active={false}
              aria-label={expandLabel}
              title={expandLabel}
              data-testid="app-sidebar-rail-expand"
              onClick={onExpand}
            >
              <PanelLeftOpen />
              <span className="sr-only">{expandLabel}</span>
            </RailButton>
          </TooltipTrigger>
          <TooltipContent side="right">{homeLabel}</TooltipContent>
        </Tooltip>
      ) : null}
      {settingsItem ? renderItem(settingsItem) : null}
      {appearanceSlot ? (
        <RailAppearanceSlot>{appearanceSlot}</RailAppearanceSlot>
      ) : null}
    </Rail>
  );
}

const RailAppearanceSlot = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-top: -1px;
`;

const RailDivider = styled.div`
  width: 22px;
  height: 1px;
  flex-shrink: 0;
  margin: 0 0 2px;
  background: var(--sidebar-divider);
`;

const RailSlot = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
`;
