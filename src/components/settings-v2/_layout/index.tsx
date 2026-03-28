/**
 * 设置页面主布局组件
 *
 * 采用左侧边栏 + 右侧内容的布局
 * 参考成熟产品的设置布局设计
 */

import { useState, ReactNode, useEffect, useRef, useCallback } from "react";
import styled from "styled-components";
import { SettingsSidebar } from "./SettingsSidebar";
import { SettingsTabs } from "@/types/settings";
import { Page, PageParams } from "@/types/page";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { CanvasBreadcrumbHeader } from "@/components/content-creator/canvas/shared/CanvasBreadcrumbHeader";

// 外观设置
import { AppearanceSettings } from "../general/appearance";
import { MemorySettings } from "../general/memory";
// 安全与性能
import { SecurityPerformanceSettings } from "../system/security-performance";
// 自动化设置
import { AutomationSettings } from "../system/automation";
import { ExecutionTrackerSettings } from "../system/execution-tracker";
// 实验功能
import { ExperimentalSettings } from "../system/experimental";
// 开发者
import { DeveloperSettings } from "../system/developer";
// 关于
import { AboutSection } from "../system/about";
// 扩展设置
import { ExtensionsSettings } from "../agent/skills";
// 快捷键设置
import { HotkeysSettings } from "../general/hotkeys";
// 记忆设置
import { MediaServicesSettings } from "../agent/media-services";
// 数据统计
import { StatsSettings } from "../account/stats";
// 个人资料
import { ProfileSettings } from "../account/profile";
import { UserCenterSessionSettings } from "../account/user-center-session";
import { CloudProviderSettings } from "../agent/providers";
import { ApiServerPage } from "@/components/api-server/ApiServerPage";
import { McpPanel } from "@/components/mcp";
import { ChannelsSettings } from "../system/channels";
import { EnvironmentSettings } from "../system/environment";
import { WebSearchSettings } from "../system/web-search";
import { ChromeRelaySettings } from "../system/chrome-relay";

import { SettingHeader } from "../features/SettingHeader";
import { SettingsHomePage } from "../home";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";

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

/**
 * 渲染设置内容
 */

function renderSettingsContent(
  tab: SettingsTabs,
  onTabChange: (tab: SettingsTabs) => void,
  onNavigate?: (page: Page, params?: PageParams) => void,
): ReactNode {
  const hasManagedAccountProfile = Boolean(resolveOemCloudRuntimeContext());

  switch (tab) {
    case SettingsTabs.Home:
      return <SettingsHomePage onTabChange={onTabChange} />;

    // 账号组
    case SettingsTabs.Profile:
      return (
        <>
          <SettingHeader title={hasManagedAccountProfile ? "账号与资料" : "个人资料"} />
          <UserCenterSessionSettings />
          {!hasManagedAccountProfile ? <ProfileSettings /> : null}
        </>
      );

    case SettingsTabs.Stats:
      return (
        <>
          <SettingHeader title="数据统计" />
          <StatsSettings />
        </>
      );

    // 通用组
    case SettingsTabs.Appearance:
      return (
        <>
          <SettingHeader title="外观" />
          <AppearanceSettings />
        </>
      );

    case SettingsTabs.Hotkeys:
      return (
        <>
          <SettingHeader title="快捷键" />
          <HotkeysSettings />
        </>
      );

    case SettingsTabs.Memory:
      return (
        <>
          <SettingHeader title="记忆" />
          <MemorySettings />
        </>
      );

    // 智能体组
    case SettingsTabs.Providers:
      return (
        <>
          <SettingHeader title="AI 服务商" />
          <CloudProviderSettings
            onOpenProfile={() => onTabChange(SettingsTabs.Profile)}
          />
        </>
      );

    case SettingsTabs.Skills:
      return (
        <>
          <SettingHeader title="技能管理" />
          <ExtensionsSettings />
        </>
      );

    case SettingsTabs.MediaServices:
      return (
        <MediaServicesSettings />
      );

    // 系统组
    case SettingsTabs.ApiServer:
      return (
        <>
          <SettingHeader title="团队共享网关（内网）" />
          <ApiServerPage hideHeader />
        </>
      );

    case SettingsTabs.McpServer:
      return (
        <>
          <SettingHeader title="MCP 服务器" />
          <McpPanel hideHeader />
        </>
      );

    case SettingsTabs.Channels:
      return (
        <>
          <SettingHeader title="渠道管理" />
          <ChannelsSettings />
        </>
      );

    case SettingsTabs.WebSearch:
      return (
        <>
          <SettingHeader title="网络搜索" />
          <WebSearchSettings />
        </>
      );

    case SettingsTabs.Environment:
      return (
        <>
          <SettingHeader title="环境变量" />
          <EnvironmentSettings />
        </>
      );

    case SettingsTabs.ChromeRelay:
      return (
        <>
          <SettingHeader title="连接器" />
          <ChromeRelaySettings />
        </>
      );

    case SettingsTabs.SecurityPerformance:
      return (
        <>
          <SettingHeader title="安全与性能" />
          <SecurityPerformanceSettings />
        </>
      );

    case SettingsTabs.Automation:
      return (
        <>
          <AutomationSettings
            mode="settings"
            onOpenWorkspace={() => onNavigate?.("automation")}
          />
        </>
      );

    case SettingsTabs.ExecutionTracker:
      return <ExecutionTrackerSettings />;

    case SettingsTabs.Experimental:
      return <ExperimentalSettings />;

    case SettingsTabs.Developer:
      return <DeveloperSettings />;

    case SettingsTabs.About:
      return <AboutSection />;

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
  SettingsTabs.ApiServer,
  SettingsTabs.Automation,
  SettingsTabs.McpServer,
  SettingsTabs.Channels,
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
    initialTab === SettingsTabs.ChatAppearance
      ? SettingsTabs.Appearance
      : (initialTab ?? SettingsTabs.Home),
  );
  const contentContainerRef = useRef<HTMLElement | null>(null);

  const handleTabChange = useCallback((tab: SettingsTabs) => {
    setActiveTab(
      tab === SettingsTabs.ChatAppearance ? SettingsTabs.Appearance : tab,
    );
  }, []);

  const handleBackHome = useCallback(() => {
    onNavigate?.("agent", buildHomeAgentParams());
  }, [onNavigate]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(
        initialTab === SettingsTabs.ChatAppearance
          ? SettingsTabs.Appearance
          : initialTab,
      );
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
        <SettingsSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        <ContentContainer ref={contentContainerRef}>
          <ContentWrapper $wide={WIDE_CONTENT_TABS.has(activeTab)}>
            {renderSettingsContent(activeTab, handleTabChange, onNavigate)}
          </ContentWrapper>
        </ContentContainer>
      </LayoutContainer>
    </>
  );
}

export default SettingsLayoutV2;
