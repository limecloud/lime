import { ArrowLeft, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { Page, PageParams } from "@/types/page";
import type { SettingsTabs } from "@/types/settings";
import {
  MAIN_SIDEBAR_NAV_ITEMS,
  FOOTER_SIDEBAR_NAV_ITEMS,
} from "@/lib/navigation/sidebarNav";
import { AppSidebarRail } from "@/components/app-sidebar/AppSidebarRail";
import {
  APP_SIDEBAR_WIDTH,
  APP_SIDEBAR_RAIL_WIDTH,
  SIDEBAR_NAV_LABEL_KEYS,
} from "@/components/app-sidebar/AppSidebar.constants";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsSidebar } from "./SettingsSidebar";
import { AppSidebarAppearancePopover } from "@/components/app-sidebar/AppSidebarAppearancePopover";
import {
  FooterAppearanceActionSlot,
  IconActionButton,
} from "@/components/app-sidebar/AppSidebar.styles";
import { useAppSidebarAppearance } from "@/components/app-sidebar/useAppSidebarAppearance";

const Navigation = styled.aside<{ $reserveWindowControls: boolean }>`
  --sidebar-window-control-safe-top: ${({ $reserveWindowControls }) =>
    $reserveWindowControls ? "34px" : "0px"};
  --sidebar-surface-top: var(
    --lime-sidebar-surface-top,
    var(--lime-sidebar-surface, hsl(var(--card)))
  );
  --sidebar-surface: var(--lime-sidebar-surface, hsl(var(--card)));
  --sidebar-foreground: var(--lime-text-strong, hsl(var(--foreground)));
  --sidebar-muted: var(--lime-text-muted, hsl(var(--muted-foreground)));
  --sidebar-divider: var(--lime-sidebar-border, hsl(var(--border)));
  --sidebar-hover: var(--lime-sidebar-hover, hsl(var(--accent)));
  --sidebar-active: var(--lime-sidebar-active, hsl(var(--accent)));
  --sidebar-active-foreground: var(
    --lime-sidebar-active-text,
    hsl(var(--foreground))
  );
  display: grid;
  grid-template-columns: ${APP_SIDEBAR_RAIL_WIDTH}px minmax(0, 1fr);
  width: ${APP_SIDEBAR_WIDTH}px;
  min-width: ${APP_SIDEBAR_WIDTH}px;
  min-height: 0;
  border-right: 1px solid var(--sidebar-divider);
  background: var(--sidebar-surface);

  @media (max-width: 640px) {
    width: ${APP_SIDEBAR_RAIL_WIDTH}px;
    min-width: ${APP_SIDEBAR_RAIL_WIDTH}px;
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Context = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding-top: calc(10px + var(--sidebar-window-control-safe-top));

  @media (max-width: 640px) {
    position: absolute;
    width: 0;
    padding-top: 0;
  }
`;

const Header = styled.div`
  padding: 0 10px 8px;
  @media (max-width: 640px) {
    display: none;
  }
`;

const BackButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 7px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--sidebar-muted);
  font-size: 13px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  &:hover {
    color: var(--sidebar-foreground);
    background: var(--sidebar-hover);
  }
  svg {
    width: 16px;
    height: 16px;
  }
`;

const Title = styled.h2`
  padding: 14px 7px 0;
  color: var(--sidebar-foreground);
  font-size: 14px;
  font-weight: 650;
`;

interface SettingsNavigationProps {
  activeTab: SettingsTabs;
  reserveWindowControls: boolean;
  onTabChange: (tab: SettingsTabs) => void;
  onTabPrefetch: (tab: SettingsTabs) => void;
  onBackHome: () => void;
  onNavigate?: (page: Page, params?: PageParams) => void;
}

export function SettingsNavigation({
  activeTab,
  reserveWindowControls,
  onTabChange,
  onTabPrefetch,
  onBackHome,
  onNavigate,
}: SettingsNavigationProps) {
  const { t } = useTranslation(["navigation", "settings"]);
  const {
    appearanceColorSchemes,
    appearanceControlRef,
    appearancePopoverOpen,
    appearanceThemeOptions,
    colorSchemeId,
    copy: appearanceCopy,
    handleColorSchemeChange,
    handleRandomColorScheme,
    handleThemeModeChange,
    setAppearancePopoverOpen,
    themeState,
  } = useAppSidebarAppearance();
  const localize = (item: (typeof MAIN_SIDEBAR_NAV_ITEMS)[number]) => ({
    ...item,
    label: t(SIDEBAR_NAV_LABEL_KEYS[item.id]),
  });
  const settingsItem = FOOTER_SIDEBAR_NAV_ITEMS.find(
    (item) => item.id === "settings",
  );

  return (
    <TooltipProvider>
      <Navigation
        className="lime-settings-theme-scope"
        $reserveWindowControls={reserveWindowControls}
        data-testid="settings-navigation"
      >
        <AppSidebarRail
          collapsed={false}
          homeActive={false}
          homeLabel={t("navigation.sidebar.home.label")}
          items={MAIN_SIDEBAR_NAV_ITEMS.filter(
            (item) => item.id !== "home-general",
          ).map(localize)}
          settingsItem={settingsItem ? localize(settingsItem) : null}
          isActive={(item) => item.id === "settings"}
          onHome={onBackHome}
          onNavigate={(item) => {
            if (item.page && item.page !== "settings")
              onNavigate?.(item.page, item.params);
          }}
          appearanceSlot={
            <FooterAppearanceActionSlot ref={appearanceControlRef}>
              <IconActionButton
                type="button"
                $active={appearancePopoverOpen}
                aria-label={appearanceCopy.entryLabel}
                title={appearanceCopy.entryLabel}
                aria-expanded={appearancePopoverOpen}
                aria-haspopup="dialog"
                data-testid="settings-rail-appearance"
                onClick={() => setAppearancePopoverOpen((current) => !current)}
              >
                <Palette />
              </IconActionButton>
              {appearancePopoverOpen ? (
                <AppSidebarAppearancePopover
                  themeMode={themeState.themeMode}
                  colorSchemeId={colorSchemeId}
                  themeOptions={appearanceThemeOptions}
                  colorSchemes={appearanceColorSchemes}
                  copy={appearanceCopy}
                  onThemeModeChange={handleThemeModeChange}
                  onColorSchemeChange={handleColorSchemeChange}
                  onRandomColorScheme={handleRandomColorScheme}
                />
              ) : null}
            </FooterAppearanceActionSlot>
          }
        />
        <Context>
          <Header
            className="lime-settings-theme-scope"
            data-testid="settings-top-header"
            data-window-controls-reserved={String(reserveWindowControls)}
          >
            <BackButton
              type="button"
              onClick={onBackHome}
              aria-label={t("settings.layout.action.backHome", {
                ns: "settings",
              })}
              data-testid="settings-home-button"
            >
              <ArrowLeft />
              {t("settings.layout.action.backHome", { ns: "settings" })}
            </BackButton>
            <Title>{t("navigation.sidebar.items.settings")}</Title>
          </Header>
          <SettingsSidebar
            activeTab={activeTab}
            onTabChange={onTabChange}
            onTabPrefetch={onTabPrefetch}
          />
        </Context>
      </Navigation>
    </TooltipProvider>
  );
}
