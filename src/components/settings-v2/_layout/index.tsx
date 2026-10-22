/**
 * 设置页面主布局组件
 *
 * 采用左侧边栏 + 右侧内容的布局
 * 参考成熟产品的设置布局设计
 */

import {
  Suspense,
  type ReactNode,
  useEffect,
  useRef,
  useCallback,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { SettingsNavigation } from "./SettingsNavigation";
import { SettingsTabs } from "@/types/settings";
import { Page, PageParams, type SettingsPageParams } from "@/types/page";
import { shouldReserveMacWindowControls } from "@/lib/windowControls";
import { resolveSettingsSection } from "../sections";
import { SettingsHomePage } from "../home";
import type { NavigationGuard } from "@/lib/navigationGuard";
import { SettingsNavigationGuard } from "./SettingsNavigationGuard";
import { useSettingsSearchTarget } from "./useSettingsSearchTarget";
import {
  getSettingsSearchDocument,
  type SettingsSearchResult,
} from "../settingsSearch";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";

const LayoutContainer = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  background: var(--lime-app-bg, hsl(var(--background)));
`;

const ContentArea = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--lime-stage-surface-soft, hsl(var(--background)));
`;

const Toolbar = styled.div`
  height: 46px;
  flex-shrink: 0;
  padding-inline: var(--lime-panel-padding, 24px);
  -webkit-app-region: drag;
`;

const ContentContainer = styled.main`
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: var(--lime-settings-panel-padding, 20px);

  [data-settings-search-active="true"] {
    outline: 2px solid var(--lime-brand, hsl(var(--primary)));
    outline-offset: 4px;
    border-radius: 8px;
  }
`;

const ContentWrapper = styled.div<{ $wide?: boolean }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: min(100%, 320px);
  max-width: ${({ $wide }) => ($wide ? "none" : "48rem")};
  margin-inline: auto;
`;

const LoadingPanel = styled.div`
  border: 1px solid hsl(var(--border));
  border-radius: 20px;
  background: hsl(var(--card));
  padding: 18px 20px;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  line-height: 1.6;
`;

function SettingsContentFallback({ label }: { label: string }) {
  return (
    <LoadingPanel
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="settings-page-loading"
    >
      {label}
    </LoadingPanel>
  );
}

function withSettingsContentFallback(
  node: ReactNode,
  label: string,
): ReactNode {
  return (
    <Suspense fallback={<SettingsContentFallback label={label} />}>
      {node}
    </Suspense>
  );
}

function renderSettingsContent(
  tab: SettingsTabs,
  onTabChange: (tab: SettingsTabs) => void,
  t: TFunction<"settings", undefined>,
  onTabPrefetch?: (tab: SettingsTabs) => void,
  onNavigate?: (page: Page, params?: PageParams) => void,
  params: SettingsPageParams = {},
): ReactNode {
  const section = resolveSettingsSection(tab);
  const content = section.render({
    searchPath: getSettingsSearchDocument(
      tab,
      params.searchFocus?.targetId,
      !resolveOemCloudRuntimeContext(),
    )?.path,
    renderHome: () => (
      <SettingsHomePage
        onTabChange={onTabChange}
        onTabPrefetch={onTabPrefetch}
        onNavigate={onNavigate}
      />
    ),
    providerView:
      tab === SettingsTabs.Providers
        ? (params.providerView ??
          (params.providerFocus ? "settings" : undefined))
        : undefined,
    providerFocus:
      tab === SettingsTabs.Providers ? params.providerFocus : undefined,
    executionPolicyFocus:
      tab === SettingsTabs.ExecutionPolicy
        ? params.executionPolicyFocus
        : undefined,
    developerLabTab:
      params.tab === SettingsTabs.Experimental ? "experimental" : "developer",
    browserPage: tab === SettingsTabs.Browser ? params.browserPage : undefined,
  });
  return section.loadingKey
    ? withSettingsContentFallback(content, t(section.loadingKey))
    : content;
}

/**
 * 设置页面主组件
 */
interface SettingsPageProps {
  onNavigate: (page: Page, params?: PageParams) => void;
  onBack: () => void;
  pageParams: SettingsPageParams;
  navigationGuard: NavigationGuard;
}

export function SettingsPage({
  onNavigate,
  onBack,
  pageParams,
  navigationGuard,
}: SettingsPageProps) {
  const { t } = useTranslation("settings");
  const activeTab = resolveSettingsSection(pageParams.tab).key;
  const contentContainerRef = useRef<HTMLElement | null>(null);
  const prefetchedTabsRef = useRef<Set<SettingsTabs>>(new Set());
  const searchRequestRef = useRef(pageParams.searchFocus?.requestKey ?? 0);
  const reserveWindowControls = shouldReserveMacWindowControls();

  const handleTabChange = useCallback(
    (tab: SettingsTabs) => {
      if (tab === (pageParams.tab ?? SettingsTabs.Home)) return;
      onNavigate("settings", {
        tab,
        ...(pageParams.browserReturnOwner
          ? { browserReturnOwner: pageParams.browserReturnOwner }
          : {}),
      });
    },
    [onNavigate, pageParams.browserReturnOwner, pageParams.tab],
  );

  const handleSearchSelect = useCallback(
    (result: SettingsSearchResult) => {
      if (!result.targetId) {
        handleTabChange(result.section);
        return;
      }
      searchRequestRef.current =
        Math.max(
          searchRequestRef.current,
          pageParams.searchFocus?.requestKey ?? 0,
        ) + 1;
      onNavigate("settings", {
        tab: result.section,
        ...(pageParams.browserReturnOwner
          ? { browserReturnOwner: pageParams.browserReturnOwner }
          : {}),
        searchFocus: {
          targetId: result.targetId,
          requestKey: searchRequestRef.current,
        },
      });
    },
    [
      handleTabChange,
      onNavigate,
      pageParams.browserReturnOwner,
      pageParams.searchFocus?.requestKey,
    ],
  );

  const handleTabPrefetch = useCallback((tab: SettingsTabs) => {
    if (prefetchedTabsRef.current.has(tab)) {
      return;
    }

    const preloadTask = resolveSettingsSection(tab).preload();
    if (!preloadTask) {
      return;
    }

    prefetchedTabsRef.current.add(tab);
    void preloadTask.catch(() => {
      prefetchedTabsRef.current.delete(tab);
    });
  }, []);

  useEffect(() => {
    contentContainerRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
  }, [activeTab]);

  useSettingsSearchTarget(
    contentContainerRef,
    activeTab,
    pageParams.searchFocus,
    !resolveOemCloudRuntimeContext(),
  );

  return (
    <SettingsNavigationGuard navigationGuard={navigationGuard}>
      <LayoutContainer className="lime-settings-theme-scope">
        <SettingsNavigation
          activeTab={activeTab}
          reserveWindowControls={reserveWindowControls}
          onTabChange={handleTabChange}
          onTabPrefetch={handleTabPrefetch}
          onSearchSelect={handleSearchSelect}
          searchRequestKey={pageParams.searchFocus?.requestKey}
          navigationPending={navigationGuard.pendingNavigation}
          onBack={onBack}
        />
        <ContentArea>
          <Toolbar aria-hidden data-testid="settings-content-toolbar" />
          <ContentContainer
            ref={contentContainerRef}
            data-testid="settings-content"
          >
            <ContentWrapper
              $wide={activeTab === SettingsTabs.Providers}
              key={`${activeTab}:${pageParams.searchFocus?.requestKey ?? ""}`}
            >
              {renderSettingsContent(
                activeTab,
                handleTabChange,
                t,
                handleTabPrefetch,
                onNavigate,
                pageParams,
              )}
            </ContentWrapper>
          </ContentContainer>
        </ContentArea>
      </LayoutContainer>
    </SettingsNavigationGuard>
  );
}
