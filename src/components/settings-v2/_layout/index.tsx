/**
 * 设置页面主布局组件
 *
 * 采用左侧边栏 + 右侧内容的布局
 * 参考成熟产品的设置布局设计
 */

import {
  useState,
  lazy,
  Suspense,
  type ReactNode,
  useEffect,
  useRef,
  useCallback,
} from "react";
import styled from "styled-components";
import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsTabs } from "@/types/settings";
import { Page, PageParams } from "@/types/page";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { CanvasBreadcrumbHeader } from "@/lib/workspace/workbenchUi";

import { SettingHeader } from "../features/SettingHeader";
import { SettingsHomePage } from "../home";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";

const AppearanceSettings = lazy(() =>
  import("../general/appearance").then((module) => ({
    default: module.AppearanceSettings,
  })),
);
const MemorySettings = lazy(() =>
  import("../general/memory").then((module) => ({
    default: module.MemorySettings,
  })),
);
const SecurityPerformanceSettings = lazy(() =>
  import("../system/security-performance").then((module) => ({
    default: module.SecurityPerformanceSettings,
  })),
);
const AutomationSettings = lazy(() =>
  import("../system/automation").then((module) => ({
    default: module.AutomationSettings,
  })),
);
const ExecutionTrackerSettings = lazy(() =>
  import("../system/execution-tracker").then((module) => ({
    default: module.ExecutionTrackerSettings,
  })),
);
const ExperimentalSettings = lazy(() =>
  import("../system/experimental").then((module) => ({
    default: module.ExperimentalSettings,
  })),
);
const DeveloperSettings = lazy(() =>
  import("../system/developer").then((module) => ({
    default: module.DeveloperSettings,
  })),
);
const AboutSection = lazy(() =>
  import("../system/about").then((module) => ({
    default: module.AboutSection,
  })),
);
const ExtensionsSettings = lazy(() =>
  import("../agent/skills").then((module) => ({
    default: module.ExtensionsSettings,
  })),
);
const HotkeysSettings = lazy(() =>
  import("../general/hotkeys").then((module) => ({
    default: module.HotkeysSettings,
  })),
);
const MediaServicesSettings = lazy(() =>
  import("../agent/media-services").then((module) => ({
    default: module.MediaServicesSettings,
  })),
);
const StatsSettings = lazy(() =>
  import("../account/stats").then((module) => ({
    default: module.StatsSettings,
  })),
);
const ProfileSettings = lazy(() =>
  import("../account/profile").then((module) => ({
    default: module.ProfileSettings,
  })),
);
const UserCenterSessionSettings = lazy(() =>
  import("../account/user-center-session").then((module) => ({
    default: module.UserCenterSessionSettings,
  })),
);
const CloudProviderSettings = lazy(() =>
  import("../agent/providers").then((module) => ({
    default: module.CloudProviderSettings,
  })),
);
const McpPanel = lazy(() =>
  import("@/components/mcp").then((module) => ({
    default: module.McpPanel,
  })),
);
const EnvironmentSettings = lazy(() =>
  import("../system/environment").then((module) => ({
    default: module.EnvironmentSettings,
  })),
);
const WebSearchSettings = lazy(() =>
  import("../system/web-search").then((module) => ({
    default: module.WebSearchSettings,
  })),
);
const ChromeRelaySettings = lazy(() =>
  import("../system/chrome-relay").then((module) => ({
    default: module.ChromeRelaySettings,
  })),
);

const LayoutContainer = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  background: hsl(var(--background));

  @media (max-width: 1200px) {
    flex-direction: column;
  }
`;

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 24px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--background));

  @media (max-width: 640px) {
    padding: 8px 12px;
  }
`;

const ContentContainer = styled.main`
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px 32px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
    border-radius: 3px;
  }

  @media (max-width: 1200px) {
    padding: 20px;
  }

  @media (max-width: 640px) {
    padding: 16px 12px 24px;
  }
`;

const ContentWrapper = styled.div<{ $wide: boolean }>`
  width: 100%;
  min-width: 0;
  max-width: ${({ $wide }) => ($wide ? "1440px" : "800px")};
`;

const PlaceholderPage = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: hsl(var(--muted-foreground));
  text-align: center;

  p {
    margin-top: 8px;
    font-size: 14px;
  }
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

function SettingsChannelsRedirect({
  onNavigate,
}: {
  onNavigate?: (page: Page, params?: PageParams) => void;
}) {
  useEffect(() => {
    onNavigate?.("channels");
  }, [onNavigate]);

  return (
    <PlaceholderPage>
      <p>渠道管理已迁移到「能力 {"->"} IM 配置」</p>
    </PlaceholderPage>
  );
}

function SettingsContentFallback({ label }: { label: string }) {
  return <LoadingPanel>{label}</LoadingPanel>;
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

function normalizeSettingsTab(tab: SettingsTabs): SettingsTabs {
  return tab === SettingsTabs.ChatAppearance ? SettingsTabs.Appearance : tab;
}

function preloadSettingsTab(tab: SettingsTabs): Promise<unknown> | null {
  const normalizedTab = normalizeSettingsTab(tab);

  switch (normalizedTab) {
    case SettingsTabs.Home:
    case SettingsTabs.Channels:
      return null;
    case SettingsTabs.Profile:
      return Promise.all([
        import("../account/profile"),
        import("../account/user-center-session"),
      ]);
    case SettingsTabs.Stats:
      return import("../account/stats");
    case SettingsTabs.Appearance:
      return import("../general/appearance");
    case SettingsTabs.Hotkeys:
      return import("../general/hotkeys");
    case SettingsTabs.Memory:
      return import("../general/memory");
    case SettingsTabs.Providers:
      return import("../agent/providers");
    case SettingsTabs.Skills:
      return import("../agent/skills");
    case SettingsTabs.MediaServices:
      return Promise.all([
        import("../agent/media-services"),
        import("../agent/media-services/preload").then((module) =>
          module.preloadMediaServicesSection("image"),
        ),
      ]);
    case SettingsTabs.McpServer:
      return import("@/components/mcp");
    case SettingsTabs.WebSearch:
      return import("../system/web-search");
    case SettingsTabs.Environment:
      return import("../system/environment");
    case SettingsTabs.ChromeRelay:
      return import("../system/chrome-relay");
    case SettingsTabs.SecurityPerformance:
      return import("../system/security-performance");
    case SettingsTabs.Automation:
      return import("../system/automation");
    case SettingsTabs.ExecutionTracker:
      return import("../system/execution-tracker");
    case SettingsTabs.Experimental:
      return import("../system/experimental");
    case SettingsTabs.Developer:
      return Promise.all([
        import("../system/developer"),
        import("../system/developer/preload").then((module) =>
          module.preloadDeveloperDefaultSections(),
        ),
      ]);
    case SettingsTabs.About:
      return import("../system/about");
    default:
      return null;
  }
}

/**
 * 渲染设置内容
 */

function renderSettingsContent(
  tab: SettingsTabs,
  onTabChange: (tab: SettingsTabs) => void,
  onTabPrefetch?: (tab: SettingsTabs) => void,
  onNavigate?: (page: Page, params?: PageParams) => void,
): ReactNode {
  const hasManagedAccountProfile = Boolean(resolveOemCloudRuntimeContext());

  switch (tab) {
    case SettingsTabs.Home:
      return (
        <SettingsHomePage
          onTabChange={onTabChange}
          onTabPrefetch={onTabPrefetch}
        />
      );

    // 账号组
    case SettingsTabs.Profile:
      return (
        <>
          <SettingHeader title={hasManagedAccountProfile ? "账号与资料" : "个人资料"} />
          {withSettingsContentFallback(
            <>
              <UserCenterSessionSettings />
              {!hasManagedAccountProfile ? <ProfileSettings /> : null}
            </>,
            "正在加载账号资料...",
          )}
        </>
      );

    case SettingsTabs.Stats:
      return (
        <>
          <SettingHeader title="数据统计" />
          {withSettingsContentFallback(
            <StatsSettings />,
            "正在加载数据统计...",
          )}
        </>
      );

    // 通用组
    case SettingsTabs.Appearance:
      return (
        <>
          <SettingHeader title="外观" />
          {withSettingsContentFallback(
            <AppearanceSettings />,
            "正在加载外观设置...",
          )}
        </>
      );

    case SettingsTabs.Hotkeys:
      return (
        <>
          <SettingHeader title="快捷键" />
          {withSettingsContentFallback(
            <HotkeysSettings />,
            "正在加载快捷键设置...",
          )}
        </>
      );

    case SettingsTabs.Memory:
      return (
        <>
          <SettingHeader title="记忆" />
          {withSettingsContentFallback(
            <MemorySettings />,
            "正在加载记忆设置...",
          )}
        </>
      );

    // 智能体组
    case SettingsTabs.Providers:
      return (
        <>
          <SettingHeader title="AI 服务商" />
          {withSettingsContentFallback(
            <CloudProviderSettings
              onOpenProfile={() => onTabChange(SettingsTabs.Profile)}
            />,
            "正在加载 AI 服务商设置...",
          )}
        </>
      );

    case SettingsTabs.Skills:
      return (
        <>
          <SettingHeader title="技能管理" />
          {withSettingsContentFallback(
            <ExtensionsSettings />,
            "正在加载技能管理...",
          )}
        </>
      );

    case SettingsTabs.MediaServices:
      return withSettingsContentFallback(
        <MediaServicesSettings />,
        "正在加载媒体服务...",
      );

    // 系统组
    case SettingsTabs.McpServer:
      return (
        <>
          <SettingHeader title="MCP 服务器" />
          {withSettingsContentFallback(
            <McpPanel hideHeader />,
            "正在加载 MCP 服务器...",
          )}
        </>
      );

    case SettingsTabs.Channels:
      return <SettingsChannelsRedirect onNavigate={onNavigate} />;

    case SettingsTabs.WebSearch:
      return (
        <>
          <SettingHeader title="网络搜索" />
          {withSettingsContentFallback(
            <WebSearchSettings />,
            "正在加载网络搜索设置...",
          )}
        </>
      );

    case SettingsTabs.Environment:
      return (
        <>
          <SettingHeader title="环境变量" />
          {withSettingsContentFallback(
            <EnvironmentSettings />,
            "正在加载环境变量...",
          )}
        </>
      );

    case SettingsTabs.ChromeRelay:
      return (
        <>
          <SettingHeader title="连接器" />
          {withSettingsContentFallback(
            <ChromeRelaySettings />,
            "正在加载连接器设置...",
          )}
        </>
      );

    case SettingsTabs.SecurityPerformance:
      return (
        <>
          <SettingHeader title="安全与性能" />
          {withSettingsContentFallback(
            <SecurityPerformanceSettings />,
            "正在加载安全与性能设置...",
          )}
        </>
      );

    case SettingsTabs.Automation:
      return withSettingsContentFallback(
        <AutomationSettings
          mode="settings"
          onOpenWorkspace={() => onNavigate?.("automation")}
        />,
        "正在加载自动化设置...",
      );

    case SettingsTabs.ExecutionTracker:
      return withSettingsContentFallback(
        <ExecutionTrackerSettings />,
        "正在加载执行轨迹...",
      );

    case SettingsTabs.Experimental:
      return (
        <>
          <SettingHeader title="实验功能" />
          {withSettingsContentFallback(
            <ExperimentalSettings />,
            "正在加载实验功能...",
          )}
        </>
      );

    case SettingsTabs.Developer:
      return (
        <>
          <SettingHeader title="开发者" />
          {withSettingsContentFallback(
            <DeveloperSettings />,
            "正在加载开发者工具...",
          )}
        </>
      );

    case SettingsTabs.About:
      return withSettingsContentFallback(
        <AboutSection />,
        "正在加载关于页面...",
      );

    default:
      return (
        <PlaceholderPage>
          <p>页面不存在</p>
        </PlaceholderPage>
      );
  }
}

/**
 * 设置页面主组件
 */
interface SettingsLayoutV2Props {
  onNavigate?: (page: Page, params?: PageParams) => void;
  initialTab?: SettingsTabs;
}

const WIDE_CONTENT_TABS = new Set<SettingsTabs>([
  SettingsTabs.Home,
  SettingsTabs.Profile,
  SettingsTabs.Stats,
  SettingsTabs.Appearance,
  SettingsTabs.ChatAppearance,
  SettingsTabs.Hotkeys,
  SettingsTabs.Memory,
  SettingsTabs.Providers,
  SettingsTabs.Skills,
  SettingsTabs.MediaServices,
  SettingsTabs.Automation,
  SettingsTabs.McpServer,
  SettingsTabs.SecurityPerformance,
  SettingsTabs.Developer,
  SettingsTabs.WebSearch,
  SettingsTabs.Environment,
  SettingsTabs.ChromeRelay,
  SettingsTabs.ExecutionTracker,
  SettingsTabs.Experimental,
  SettingsTabs.About,
]);

export function SettingsLayoutV2({
  onNavigate,
  initialTab,
}: SettingsLayoutV2Props) {
  const [activeTab, setActiveTab] = useState<SettingsTabs>(
    normalizeSettingsTab(initialTab ?? SettingsTabs.Home),
  );
  const contentContainerRef = useRef<HTMLElement | null>(null);
  const prefetchedTabsRef = useRef<Set<SettingsTabs>>(new Set());

  const handleTabChange = useCallback((tab: SettingsTabs) => {
    setActiveTab(normalizeSettingsTab(tab));
  }, []);

  const handleTabPrefetch = useCallback((tab: SettingsTabs) => {
    const normalizedTab = normalizeSettingsTab(tab);
    if (prefetchedTabsRef.current.has(normalizedTab)) {
      return;
    }

    const preloadTask = preloadSettingsTab(normalizedTab);
    if (!preloadTask) {
      return;
    }

    prefetchedTabsRef.current.add(normalizedTab);
    void preloadTask.catch(() => {
      prefetchedTabsRef.current.delete(normalizedTab);
    });
  }, []);

  const handleBackHome = useCallback(() => {
    onNavigate?.("agent", buildHomeAgentParams());
  }, [onNavigate]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(normalizeSettingsTab(initialTab));
    }
  }, [initialTab]);

  useEffect(() => {
    contentContainerRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
  }, [activeTab]);

  return (
    <>
      {/* 设置内容 */}
      <HeaderBar>
        <CanvasBreadcrumbHeader label="设置" onBackHome={handleBackHome} />
      </HeaderBar>
      <LayoutContainer>
        <SettingsSidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onTabPrefetch={handleTabPrefetch}
        />
        <ContentContainer ref={contentContainerRef}>
          <ContentWrapper $wide={WIDE_CONTENT_TABS.has(activeTab)}>
            {renderSettingsContent(
              activeTab,
              handleTabChange,
              handleTabPrefetch,
              onNavigate,
            )}
          </ContentWrapper>
        </ContentContainer>
      </LayoutContainer>
    </>
  );
}

export default SettingsLayoutV2;
