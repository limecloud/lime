import {
  Bot,
  BrainCircuit,
  CalendarRange,
  Compass,
  Image,
  LayoutGrid,
  Library,
  MessageSquare,
  Palette,
  Plus,
  Settings,
  Sparkles,
  Terminal,
  Video,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  type AgentPageParams,
  getThemeWorkspacePage,
  type OpenClawPageParams,
  type Page,
  type PageParams,
} from "@/types/page";
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
  isActive?: (currentPage: Page, currentParams?: PageParams) => boolean;
  configurable?: boolean;
  children?: SidebarNavItemDefinition[];
  defaultExpanded?: boolean;
}

const CAPABILITY_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  {
    id: "skills",
    label: "技能",
    icon: Sparkles,
    page: "skills",
    isActive: (currentPage) => currentPage === "skills",
    configurable: false,
  },
  {
    id: "automation",
    label: "自动化",
    icon: CalendarRange,
    page: "automation",
    isActive: (currentPage) => currentPage === "automation",
    configurable: false,
  },
  {
    id: "channels",
    label: "IM 配置",
    icon: MessageSquare,
    page: "channels",
    isActive: (currentPage) => currentPage === "channels",
    configurable: false,
  },
];

export const MAIN_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  {
    id: "home-general",
    label: "新建任务",
    icon: Plus,
    page: "agent",
    params: buildHomeAgentParams(),
    isActive: (currentPage, currentParams) =>
      currentPage === "agent" &&
      (currentParams as AgentPageParams | undefined)?.agentEntry === "new-task",
  },
  {
    id: "claw",
    label: "Claw",
    icon: MessageSquare,
    page: "agent",
    params: buildClawAgentParams(),
    isActive: (currentPage, currentParams) =>
      currentPage === "agent" &&
      (currentParams as AgentPageParams | undefined)?.agentEntry !== "new-task",
  },
  {
    id: "capabilities",
    label: "能力",
    icon: LayoutGrid,
    configurable: false,
    children: CAPABILITY_SIDEBAR_NAV_ITEMS,
    defaultExpanded: true,
  },
  {
    id: "video",
    label: "视频",
    icon: Video,
    page: getThemeWorkspacePage("video"),
    params: { workspaceViewMode: "workspace" },
    isActive: (currentPage) => currentPage === getThemeWorkspacePage("video"),
  },
  { id: "image-gen", label: "插图", icon: Image, page: "image-gen" },
  { id: "terminal", label: "终端", icon: Terminal, page: "terminal" },
  { id: "plugins", label: "插件中心", icon: Compass, page: "plugins" },
];

export const FIXED_MAIN_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  MAIN_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable === false);

export const CONFIGURABLE_MAIN_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  MAIN_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable !== false);

export const FOOTER_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  {
    id: "openclaw",
    label: "OpenClaw",
    icon: Bot,
    page: "openclaw",
    params: { subpage: "runtime" } as OpenClawPageParams,
    isActive: (currentPage) => currentPage === "openclaw",
  },
  {
    id: "settings",
    label: "设置",
    icon: Settings,
    page: "settings",
    isActive: (currentPage) => currentPage === "settings",
    configurable: false,
  },
  {
    id: "resources",
    label: "资源",
    icon: Library,
    page: "resources",
    isActive: (currentPage) => currentPage === "resources",
  },
  {
    id: "tools",
    label: "工具箱",
    icon: Wrench,
    page: "tools",
    isActive: (currentPage) => currentPage === "tools",
  },
  {
    id: "style-library",
    label: "我的风格",
    icon: Palette,
    page: "style",
    params: { section: "overview" },
    isActive: (currentPage) => currentPage === "style",
  },
  {
    id: "memory",
    label: "记忆",
    icon: BrainCircuit,
    page: "memory",
    isActive: (currentPage) => currentPage === "memory",
  },
];

export const FIXED_FOOTER_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  FOOTER_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable === false);

export const CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] =
  FOOTER_SIDEBAR_NAV_ITEMS.filter((item) => item.configurable !== false);

export const CONFIGURABLE_SIDEBAR_NAV_ITEMS: SidebarNavItemDefinition[] = [
  ...CONFIGURABLE_MAIN_SIDEBAR_NAV_ITEMS,
  ...CONFIGURABLE_FOOTER_SIDEBAR_NAV_ITEMS,
];

export const DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS = [
  "home-general",
  "claw",
  "video",
  "image-gen",
  "openclaw",
  "resources",
  "style-library",
  "memory",
];

const CONFIGURABLE_SIDEBAR_NAV_ITEM_ID_SET = new Set<string>(
  CONFIGURABLE_SIDEBAR_NAV_ITEMS.map((item) => item.id),
);

export function normalizeEnabledSidebarNavItems(items: string[]): string[] {
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
