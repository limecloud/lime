/**
 * 设置分类 Hook
 *
 * 定义设置页面的分组和导航项
 * 参考成熟产品的分组导航设计
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Home,
  User,
  BarChart3,
  Palette,
  Keyboard,
  Brain,
  Bot,
  Blocks,
  Image,
  Server,
  Plug,
  Route,
  Search,
  Variable,
  Monitor,
  ShieldCheck,
  Activity,
  FlaskConical,
  Code,
  Info,
  LucideIcon,
} from "lucide-react";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";

/**
 * 分类项定义
 */
export interface CategoryItem {
  key: SettingsTabs;
  label: string;
  icon: LucideIcon;
  experimental?: boolean;
}

/**
 * 分类组定义
 */
export interface CategoryGroup {
  key: SettingsGroupKey;
  title: string;
  items: CategoryItem[];
}

/**
 * 设置分类 Hook
 *
 * 返回按分组组织的设置导航项
 */
export function useSettingsCategory(): CategoryGroup[] {
  const { t } = useTranslation();

  return useMemo(() => {
    const groups: CategoryGroup[] = [];

    groups.push({
      key: SettingsGroupKey.Overview,
      title: t("settings.group.overview", "概览"),
      items: [
        {
          key: SettingsTabs.Home,
          label: t("settings.tab.home", "设置首页"),
          icon: Home,
        },
      ],
    });

    // 账号组
    groups.push({
      key: SettingsGroupKey.Account,
      title: t("settings.group.account", "账号"),
      items: [
        {
          key: SettingsTabs.Profile,
          label: t("settings.tab.profile", "个人资料"),
          icon: User,
        },
        {
          key: SettingsTabs.Stats,
          label: t("settings.tab.stats", "数据统计"),
          icon: BarChart3,
        },
      ],
    });

    // 通用组
    groups.push({
      key: SettingsGroupKey.General,
      title: t("settings.group.general", "通用"),
      items: [
        {
          key: SettingsTabs.Appearance,
          label: t("settings.tab.appearance", "外观"),
          icon: Palette,
        },
        {
          key: SettingsTabs.Hotkeys,
          label: t("settings.tab.hotkeys", "快捷键"),
          icon: Keyboard,
        },
        {
          key: SettingsTabs.Memory,
          label: t("settings.tab.memory", "记忆"),
          icon: Brain,
        },
      ],
    });

    // 智能体组
    groups.push({
      key: SettingsGroupKey.Agent,
      title: t("settings.group.agent", "智能体"),
      items: [
        {
          key: SettingsTabs.Providers,
          label: t("settings.tab.providers", "AI 服务商"),
          icon: Brain,
        },
        {
          key: SettingsTabs.Skills,
          label: t("settings.tab.skills", "技能管理"),
          icon: Blocks,
        },
        {
          key: SettingsTabs.MediaServices,
          label: t("settings.tab.mediaServices", "媒体服务"),
          icon: Image,
        },
      ],
    });

    // 系统组
    groups.push({
      key: SettingsGroupKey.System,
      title: t("settings.group.system", "系统"),
      items: [
        {
          key: SettingsTabs.ApiServer,
          label: t("settings.tab.apiServer", "团队共享网关"),
          icon: Server,
        },
        {
          key: SettingsTabs.McpServer,
          label: t("settings.tab.mcpServer", "MCP 服务器"),
          icon: Plug,
        },
        {
          key: SettingsTabs.Channels,
          label: t("settings.tab.channels", "渠道管理"),
          icon: Route,
        },
        {
          key: SettingsTabs.WebSearch,
          label: t("settings.tab.webSearch", "网络搜索"),
          icon: Search,
        },
        {
          key: SettingsTabs.Environment,
          label: t("settings.tab.environment", "环境变量"),
          icon: Variable,
        },
        {
          key: SettingsTabs.ChromeRelay,
          label: t("settings.tab.chromeRelay", "连接器"),
          icon: Monitor,
        },
        {
          key: SettingsTabs.SecurityPerformance,
          label: t("settings.tab.securityPerformance", "安全与性能"),
          icon: ShieldCheck,
        },
        {
          key: SettingsTabs.Automation,
          label: t("settings.tab.automation", "自动化设置"),
          icon: Bot,
        },
        {
          key: SettingsTabs.ExecutionTracker,
          label: t("settings.tab.executionTracker", "执行轨迹"),
          icon: Activity,
        },
        {
          key: SettingsTabs.Experimental,
          label: t("settings.tab.experimental", "实验功能"),
          icon: FlaskConical,
          experimental: true,
        },
        {
          key: SettingsTabs.Developer,
          label: t("settings.tab.developer", "开发者"),
          icon: Code,
        },
        {
          key: SettingsTabs.About,
          label: t("settings.tab.about", "关于"),
          icon: Info,
        },
      ],
    });

    return groups;
  }, [t]);
}
