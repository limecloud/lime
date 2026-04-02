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
  position: relative;
  isolation: isolate;
  overflow-y: auto;
  padding: 24px 32px;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.96) 0%,
    rgba(244, 249, 247, 0.92) 100%
  );

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
  position: relative;
  z-index: 1;
  width: 100%;
  min-width: 0;
  max-width: ${({ $wide }) => ($wide ? "1440px" : "800px")};
`;

const ContentAtmosphere = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(
      circle at 8% 0%,
      rgba(16, 185, 129, 0.1) 0%,
      rgba(16, 185, 129, 0) 34%
    ),
    radial-gradient(
      circle at 92% 4%,
      rgba(56, 189, 248, 0.1) 0%,
      rgba(56, 189, 248, 0) 30%
    );

  @media (max-width: 640px) {
    background:
      radial-gradient(
        circle at 10% 0%,
        rgba(16, 185, 129, 0.08) 0%,
        rgba(16, 185, 129, 0) 36%
      ),
      radial-gradient(
        circle at 92% 2%,
        rgba(56, 189, 248, 0.08) 0%,
        rgba(56, 189, 248, 0) 32%
      );
  }
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
        withSettingsContentFallback(
          <>
            <UserCenterSessionSettings />
            {!hasManagedAccountProfile ? <ProfileSettings /> : null}
          </>,
          "正在加载账号资料...",
        )
      );

    case SettingsTabs.Stats:
      return withSettingsContentFallback(
        <StatsSettings />,
        "正在加载数据统计...",
      );

    // 通用组
    case SettingsTabs.Appearance:
      return withSettingsContentFallback(
        <AppearanceSettings />,
        "正在加载外观设置...",
      );

    case SettingsTabs.Hotkeys:
      return withSettingsContentFallback(
        <HotkeysSettings />,
        "正在加载快捷键设置...",
      );

    case SettingsTabs.Memory:
      return withSettingsContentFallback(
        <MemorySettings />,
        "正在加载记忆设置...",
      );

    // 智能体组
    case SettingsTabs.Providers:
      return withSettingsContentFallback(
        <CloudProviderSettings
          onOpenProfile={() => onTabChange(SettingsTabs.Profile)}
        />,
        "正在加载 AI 服务商设置...",
      );

    case SettingsTabs.Skills:
      return withSettingsContentFallback(
        <ExtensionsSettings />,
        "正在加载技能管理...",
      );

    case SettingsTabs.MediaServices:
      return withSettingsContentFallback(
        <MediaServicesSettings />,
        "正在加载媒体服务...",
      );

    // 系统组
    case SettingsTabs.McpServer:
      return withSettingsContentFallback(
        <McpPanel hideHeader />,
        "正在加载 MCP 服务器...",
      );

    case SettingsTabs.Channels:
      return <SettingsChannelsRedirect onNavigate={onNavigate} />;

    case SettingsTabs.WebSearch:
      return withSettingsContentFallback(
        <WebSearchSettings />,
        "正在加载网络搜索设置...",
      );

    case SettingsTabs.Environment:
      return withSettingsContentFallback(
        <EnvironmentSettings />,
        "正在加载环境变量...",
      );

    case SettingsTabs.ChromeRelay:
      return withSettingsContentFallback(
        <ChromeRelaySettings />,
        "正在加载连接器设置...",
      );

    case SettingsTabs.SecurityPerformance:
      return withSettingsContentFallback(
        <SecurityPerformanceSettings />,
        "正在加载安全与性能设置...",
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
      return withSettingsContentFallback(
        <ExperimentalSettings />,
        "正在加载实验功能...",
      );

    case SettingsTabs.Developer:
      return withSettingsContentFallback(
        <DeveloperSettings />,
        "正在加载开发者工具...",
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
          <ContentAtmosphere data-testid="settings-content-atmosphere" />
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
