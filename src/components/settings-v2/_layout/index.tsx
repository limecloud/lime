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
import { ChatAppearanceSettings } from "../general/chat-appearance";
import { MemorySettings } from "../general/memory";
// 安全与性能
import { SecurityPerformanceSettings } from "../system/security-performance";
// 心跳引擎
import { HeartbeatSettings } from "../system/heartbeat";
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
// 语音服务设置
import { VoiceSettings } from "../agent/voice";
// 助理服务设置
import { AssistantSettings } from "../agent/assistant";
// 图像生成设置
import { ImageGenSettings } from "../agent/image-gen";
import { VideoGenSettings } from "../agent/video-gen";
// 数据统计
import { StatsSettings } from "../account/stats";
// 个人资料
import { ProfileSettings } from "../account/profile";
import { ProviderPoolPage } from "@/components/provider-pool";
import { ApiServerPage } from "@/components/api-server/ApiServerPage";
import { McpPanel } from "@/components/mcp";
import { ChannelsSettings } from "../system/channels";
import { EnvironmentSettings } from "../system/environment";
import { WebSearchSettings } from "../system/web-search";
import { ChromeRelaySettings } from "../system/chrome-relay";

import { SettingHeader } from "../features/SettingHeader";

const LayoutContainer = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  background: hsl(var(--background));
`;

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  padding: 8px 24px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--background));
`;

const ContentContainer = styled.main`
  flex: 1;
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
`;

const ContentWrapper = styled.div<{ $wide: boolean }>`
  width: 100%;
  max-width: ${({ $wide }) => ($wide ? "none" : "800px")};
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
function renderSettingsContent(tab: SettingsTabs): ReactNode {
  switch (tab) {
    // 账号组
    case SettingsTabs.Profile:
      return (
        <>
          <SettingHeader title="个人资料" />
          <ProfileSettings />
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

    case SettingsTabs.ChatAppearance:
      return (
        <>
          <SettingHeader title="聊天外观" />
          <ChatAppearanceSettings />
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
          <SettingHeader title="凭证管理" />
          <ProviderPoolPage hideHeader />
        </>
      );

    case SettingsTabs.Assistant:
      return (
        <>
          <SettingHeader title="助理服务" />
          <AssistantSettings />
        </>
      );

    case SettingsTabs.Skills:
      return (
        <>
          <SettingHeader title="技能管理" />
          <ExtensionsSettings />
        </>
      );

    case SettingsTabs.ImageGen:
      return (
        <>
          <SettingHeader title="图片服务" />
          <ImageGenSettings />
        </>
      );

    case SettingsTabs.VideoGen:
      return (
        <>
          <SettingHeader title="视频服务" />
          <VideoGenSettings />
        </>
      );

    case SettingsTabs.Voice:
      return (
        <>
          <SettingHeader title="语音服务" />
          <VoiceSettings />
        </>
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
          <SettingHeader title="Chrome Relay" />
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

    case SettingsTabs.Heartbeat:
      return (
        <>
          <HeartbeatSettings />
        </>
      );

    case SettingsTabs.ExecutionTracker:
      return (
        <>
          <SettingHeader title="执行轨迹" />
          <ExecutionTrackerSettings />
        </>
      );

    case SettingsTabs.Experimental:
      return (
        <>
          <SettingHeader title="实验功能" />
          <ExperimentalSettings />
        </>
      );

    case SettingsTabs.Developer:
      return (
        <>
          <SettingHeader title="开发者" />
          <DeveloperSettings />
        </>
      );

    case SettingsTabs.About:
      return (
        <>
          <SettingHeader title="关于" />
          <AboutSection />
        </>
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
  SettingsTabs.Providers,
  SettingsTabs.ApiServer,
  SettingsTabs.McpServer,
  SettingsTabs.Channels,
  SettingsTabs.Environment,
  SettingsTabs.ExecutionTracker,
]);

export function SettingsLayoutV2({
  onNavigate,
  initialTab,
}: SettingsLayoutV2Props) {
  const [activeTab, setActiveTab] = useState<SettingsTabs>(
    initialTab || SettingsTabs.Appearance,
  );
  const contentContainerRef = useRef<HTMLElement | null>(null);

  const handleBackHome = useCallback(() => {
    onNavigate?.("agent", buildHomeAgentParams());
  }, [onNavigate]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    contentContainerRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab]);

  return (
    <>
      {/* 设置内容 */}
      <HeaderBar>
        <CanvasBreadcrumbHeader label="设置" onBackHome={handleBackHome} />
      </HeaderBar>
      <LayoutContainer>
        <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <ContentContainer ref={contentContainerRef}>
          <ContentWrapper $wide={WIDE_CONTENT_TABS.has(activeTab)}>
            {renderSettingsContent(activeTab)}
          </ContentWrapper>
        </ContentContainer>
      </LayoutContainer>
    </>
  );
}

export default SettingsLayoutV2;
