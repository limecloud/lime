import {
  Bot,
  BrainCircuit,
  CalendarRange,
  Compass,
  Library,
  MessageSquare,
  Plus,
  Send,
  Settings,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  type AgentPageParams,
  type OpenClawPageParams,
  type Page,
  type PageParams,
  type SceneAppsPageParams,
  type SettingsPageParams,
} from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { resolveSceneAppsPageEntryParams } from "@/lib/sceneapp";
import {
  buildClawAgentParams,
  buildHomeAgentParams,
} from "@/lib/workspace/navigation";

export interface SidebarNavItemDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  page?: Page;
  params?: PageParams;
  resolveParams?: (params?: PageParams) => PageParams | undefined;
  isActive?: (currentPage: Page, currentParams?: PageParams) => boolean;
  configurable?: boolean;
  children?: SidebarNavItemDefinition[];
  defaultExpanded?: boolean;
}

export interface SidebarNavSectionDefinition {
  id: string;
  title: string;
  items: SidebarNavItemDefinition[];
}

const TASK_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  {
    id: "home-general",
    label: "新建任务",
    icon: Plus,
    page: "agent",
    params: buildHomeAgentParams(),
    resolveParams: (params) =>
      buildHomeAgentParams(params as AgentPageParams | undefined),
    isActive: (currentPage, currentParams) =>
      currentPage === "agent" &&
      (currentParams as AgentPageParams | undefined)?.agentEntry === "new-task",
    configurable: false,
  },
  {
    id: "claw",
    label: "生成",
    icon: MessageSquare,
    page: "agent",
    params: buildClawAgentParams(),
    resolveParams: (params) =>
      buildClawAgentParams(params as AgentPageParams | undefined),
    isActive: (currentPage, currentParams) =>
      currentPage === "agent" &&
      (currentParams as AgentPageParams | undefined)?.agentEntry !== "new-task",
    configurable: false,
  },
];

const CAPABILITY_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  {
    id: "skills",
    label: "我的方法",
    icon: Sparkles,
    page: "skills",
    isActive: (currentPage) => currentPage === "skills",
    configurable: false,
  },
  {
    id: "sceneapps",
    label: "创作场景",
    icon: Workflow,
    page: "sceneapps",
    resolveParams: (params) =>
      resolveSceneAppsPageEntryParams(
        params as SceneAppsPageParams | undefined,
        {
        mode: "prefer_latest",
      },
      ),
    isActive: (currentPage) => currentPage === "sceneapps",
    configurable: false,
  },
  {
    id: "automation",
    label: "持续流程",
    icon: CalendarRange,
    page: "automation",
    isActive: (currentPage) => currentPage === "automation",
  },
  {
    id: "channels",
    label: "消息渠道",
    icon: Send,
    page: "channels",
    isActive: (currentPage) => currentPage === "channels",
    configurable: false,
  },
];

const LIBRARY_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  {
    id: "resources",
    label: "资料库",
    icon: Library,
    page: "resources",
    isActive: (currentPage) => currentPage === "resources",
    configurable: false,
  },
  {
    id: "memory",
    label: "灵感库",
    icon: BrainCircuit,
    page: "memory",
    isActive: (currentPage) => currentPage === "memory",
    configurable: false,
  },
];

const SYSTEM_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  { id: "plugins", label: "插件中心", icon: Compass, page: "plugins" },
  {
    id: "openclaw",
    label: "OpenClaw",
    icon: Bot,
    page: "openclaw",
    params: { subpage: "runtime" } as OpenClawPageParams,
    isActive: (currentPage) => currentPage === "openclaw",
  },
  {
    id: "companion",
    label: "桌宠",
    icon: Bot,
    page: "settings",
    params: {
      tab: SettingsTabs.Providers,
      providerView: "companion",
    } as SettingsPageParams,
    isActive: (currentPage, currentParams) =>
      currentPage === "settings" &&
      (currentParams as SettingsPageParams | undefined)?.providerView ===
        "companion",
  },
  {
    id: "settings",
    label: "设置",
    icon: Settings,
    page: "settings",
    params: {
      tab: SettingsTabs.Home,
    } as SettingsPageParams,
    isActive: (currentPage, currentParams) =>
      currentPage === "settings" &&
      (currentParams as SettingsPageParams | undefined)?.providerView !==
        "companion",
    configurable: false,
  },
];

export const MAIN_SIDEBAR_NAV_SECTIONS: SidebarNavSectionDefinition[] = [
  { id: "tasks", title: "任务", items: TASK_SIDEBAR_NAV_ITEMS },
  { id: "capability", title: "能力", items: CAPABILITY_SIDEBAR_NAV_ITEMS },
  { id: "library", title: "资料", items: LIBRARY_SIDEBAR_NAV_ITEMS },
];

export const FOOTER_SIDEBAR_NAV_SECTIONS: SidebarNavSectionDefinition[] = [
  { id: "system", title: "系统", items: SYSTEM_SIDEBAR_NAV_ITEMS },
];

export const MAIN_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  MAIN_SIDEBAR_NAV_SECTIONS.flatMap((section) => section.items);

const FOOTER_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  FOOTER_SIDEBAR_NAV_SECTIONS.flatMap((section) => section.items);

export const FIXED_MAIN_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  MAIN_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable === false);

export const CONFIGURABLE_MAIN_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  MAIN_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable !== false);

export const FIXED_FOOTER_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  FOOTER_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable === false);

export const CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  FOOTER_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable !== false);

const CONFIGURABLE_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  ...CONFIGURABLE_MAIN_SIDEBAR_NAV_ITEMS,
  ...CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS,
];

export const DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS: string[] = [];

const CONFIGURABLE_SIDEBAR_NAV_ITEM_ID_SET = new Set<string>(
  CONFIGURABLE_SIDEBAR_NAV_ITEMS.map((item) => item.id),
);

function normalizeEnabledSidebarNavItems(items: string[]): string[] {
  const unique = Array.from(new Set(items));
  return unique.filter((item) =>
    CONFIGURABLE_SIDEBAR_NAV_ITEM_ID_SET.has(item),
  );
}

export function resolveEnabledSidebarNavItems(savedItems?: string[]): string[] {
  if (!savedItems || savedItems.length === 0) {
    return [...DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS];
  }

  const normalized = normalizeEnabledSidebarNavItems(savedItems);
  if (normalized.length === 0) {
    return [...DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS];
  }

  return normalized;
}
