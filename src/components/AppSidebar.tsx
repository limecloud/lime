/**
 * 全局应用侧边栏
 *
 * 参考成熟产品的信息架构：用户区、搜索、主导航、助手分组、底部快捷入口
 */

import { useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import {
  Image,
  Moon,
  Sun,
  Search,
  PenTool,
  Video,
  Music,
  BookOpen,
  Lightbulb,
  CalendarRange,
  FileType,
  ChevronDown,
  Activity,
  LucideIcon,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { getPluginsForSurface, PluginUIInfo } from "@/lib/api/pluginUI";
import {
  AgentPageParams,
  getThemeWorkspacePage,
  LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
  Page,
  PageParams,
  ThemeWorkspacePage,
} from "@/types/page";
import { getConfig } from "@/lib/api/appConfig";
import {
  buildClawAgentParams,
  buildHomeAgentParams,
  buildWorkspaceResetParams,
} from "@/lib/workspace/navigation";
import {
  DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  FOOTER_SIDEBAR_NAV_ITEMS,
  MAIN_SIDEBAR_NAV_ITEMS,
  resolveEnabledSidebarNavItems,
  type SidebarNavItemDefinition,
} from "@/lib/navigation/sidebarNav";
import {
  DEFAULT_ENABLED_CONTENT_THEME_IDS,
  resolveEnabledContentThemes,
} from "@/lib/contentCreator/themeDefaults";

interface AppSidebarProps {
  currentPage: Page;
  currentPageParams?: PageParams;
  onNavigate: (page: Page, params?: PageParams) => void;
}

type SidebarNavItem = SidebarNavItemDefinition;

const Container = styled.aside`
  display: flex;
  flex-direction: column;
  width: 248px;
  min-width: 248px;
  height: 100vh;
  padding: 12px 10px;
  background-color: hsl(var(--card));
  border-right: 1px solid hsl(var(--border));
`;

const HeaderArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
`;

const UserButton = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 10px;
  padding: 8px 10px;
  cursor: pointer;
  color: hsl(var(--foreground));

  &:hover {
    background: hsl(var(--muted) / 0.55);
  }
`;

const Avatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const UserName = styled.div`
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SearchButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  padding: 0 10px;
  cursor: pointer;

  &:hover {
    border-color: hsl(var(--primary) / 0.35);
    color: hsl(var(--foreground));
  }

  span {
    font-size: 13px;
  }
`;

const MenuScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
    border-radius: 9999px;
  }
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
`;

const SectionTitle = styled.div`
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  opacity: 0.9;
`;

const NavButton = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 38px;
  border: none;
  border-radius: 10px;
  padding: 0 10px;
  background: ${({ $active }) =>
    $active ? "hsl(var(--accent))" : "transparent"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
  cursor: pointer;
  transition: all 0.18s ease;

  &:hover {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  svg {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    opacity: 0.9;
  }
`;

const NavLabel = styled.span`
  flex: 1;
  text-align: left;
  font-size: 14px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FooterArea = styled.div`
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid hsl(var(--border));
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 2px;
`;

const IconActionButton = styled.button<{ $active?: boolean }>`
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ $active }) =>
    $active ? "hsl(var(--accent))" : "transparent"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
  cursor: pointer;

  &:hover {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const THEME_MENU_ITEMS: SidebarNavItem[] = [
  {
    id: "theme-social-media",
    label: "社媒内容",
    icon: PenTool,
    page: getThemeWorkspacePage("social-media"),
    isActive: (currentPage) =>
      currentPage === getThemeWorkspacePage("social-media"),
  },
  {
    id: "theme-poster",
    label: "图文海报",
    icon: Image,
    page: getThemeWorkspacePage("poster"),
    isActive: (currentPage) => currentPage === getThemeWorkspacePage("poster"),
  },
  {
    id: "theme-video",
    label: "短视频",
    icon: Video,
    page: getThemeWorkspacePage("video"),
    params: { workspaceViewMode: "workspace" },
    isActive: (currentPage) => currentPage === getThemeWorkspacePage("video"),
  },
  {
    id: "theme-music",
    label: "歌词曲谱",
    icon: Music,
    page: getThemeWorkspacePage("music"),
    isActive: (currentPage) => currentPage === getThemeWorkspacePage("music"),
  },
  {
    id: "theme-novel",
    label: "小说创作",
    icon: BookOpen,
    page: getThemeWorkspacePage("novel"),
    isActive: (currentPage) => currentPage === getThemeWorkspacePage("novel"),
  },
  {
    id: "theme-document",
    label: "办公文档",
    icon: FileType,
    page: getThemeWorkspacePage("document"),
    isActive: (currentPage) =>
      currentPage === getThemeWorkspacePage("document"),
  },
  {
    id: "theme-knowledge",
    label: "知识探索",
    icon: Lightbulb,
    page: getThemeWorkspacePage("knowledge"),
    isActive: (currentPage) =>
      currentPage === getThemeWorkspacePage("knowledge"),
  },
  {
    id: "theme-planning",
    label: "计划规划",
    icon: CalendarRange,
    page: getThemeWorkspacePage("planning"),
    isActive: (currentPage) =>
      currentPage === getThemeWorkspacePage("planning"),
  },
];

function getIconByName(iconName: string): LucideIcon {
  const IconComponent = (
    LucideIcons as unknown as Record<string, LucideIcon | undefined>
  )[iconName];
  return IconComponent || Activity;
}

function isThemeWorkspacePage(page: Page): page is ThemeWorkspacePage {
  return typeof page === "string" && page.startsWith("workspace-");
}

export function AppSidebar({
  currentPage,
  currentPageParams,
  onNavigate,
}: AppSidebarProps) {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
    }
    return "light";
  });

  const [enabledNavItems, setEnabledNavItems] = useState<string[]>(
    DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  );
  const [enabledThemes, setEnabledThemes] = useState<string[]>(
    DEFAULT_ENABLED_CONTENT_THEME_IDS,
  );
  const [sidebarPlugins, setSidebarPlugins] = useState<PluginUIInfo[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [_activeThemeKey, setActiveThemeKey] = useState<string>(
    getThemeWorkspacePage("general"),
  );

  useEffect(() => {
    const loadNavConfig = async () => {
      try {
        const config = await getConfig();
        const saved = config.navigation?.enabled_items;
        setEnabledNavItems(resolveEnabledSidebarNavItems(saved));

        const savedThemes = config.content_creator?.enabled_themes;
        setEnabledThemes(resolveEnabledContentThemes(savedThemes));
      } catch (error) {
        console.error("加载配置失败:", error);
      }
    };

    loadNavConfig();

    const handleConfigChange = () => {
      loadNavConfig();
    };

    window.addEventListener("nav-config-changed", handleConfigChange);
    window.addEventListener("theme-config-changed", handleConfigChange);

    return () => {
      window.removeEventListener("nav-config-changed", handleConfigChange);
      window.removeEventListener("theme-config-changed", handleConfigChange);
    };
  }, []);

  const filteredMainMenuItems = useMemo(() => {
    return MAIN_SIDEBAR_NAV_ITEMS.filter((item) =>
      enabledNavItems.includes(item.id),
    );
  }, [enabledNavItems]);

  const filteredFooterMenuItems = useMemo(() => {
    return FOOTER_SIDEBAR_NAV_ITEMS.filter(
      (item) =>
        item.configurable === false || enabledNavItems.includes(item.id),
    );
  }, [enabledNavItems]);

  const filteredThemeMenuItems = useMemo(() => {
    return THEME_MENU_ITEMS.filter((item) => {
      // 从 theme-xxx 提取出 xxx
      const themeId = item.id.replace("theme-", "");
      return enabledThemes.includes(themeId);
    });
  }, [enabledThemes]);

  useEffect(() => {
    const loadSidebarPlugins = async () => {
      try {
        const plugins = await getPluginsForSurface("sidebar");
        setSidebarPlugins(plugins);
      } catch (error) {
        console.error("加载侧边栏插件失败:", error);
      }
    };

    loadSidebarPlugins();
  }, [refreshTrigger]);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "plugin-changed") {
        setRefreshTrigger((prev) => prev + 1);
      }
    };

    const handlePluginChange = () => {
      setRefreshTrigger((prev) => prev + 1);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("plugin-changed", handlePluginChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("plugin-changed", handlePluginChange);
    };
  }, []);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (isThemeWorkspacePage(currentPage)) {
      setActiveThemeKey(currentPage);
    }
  }, [currentPage]);

  useEffect(() => {
    const savedThemeKey = localStorage.getItem(
      LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
    );
    if (savedThemeKey) {
      setActiveThemeKey(savedThemeKey);
    }
  }, []);

  const assistantItems = useMemo<SidebarNavItem[]>(() => {
    return sidebarPlugins.map((plugin) => {
      const pluginPageId = `plugin:${plugin.pluginId}` as Page;
      return {
        id: plugin.pluginId,
        label: plugin.name,
        icon: getIconByName(plugin.icon),
        page: pluginPageId,
      };
    });
  }, [sidebarPlugins]);

  const isActive = (item: SidebarNavItem) => {
    if (item.id.startsWith("theme-")) {
      return currentPage === item.page;
    }

    if (item.isActive) {
      return item.isActive(currentPage, currentPageParams);
    }

    return currentPage === item.page;
  };

  const handleNavigate = (item: SidebarNavItem) => {
    if (isThemeWorkspacePage(item.page)) {
      setActiveThemeKey(item.page);
      localStorage.setItem(LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY, item.page);
    }

    const params: PageParams | undefined =
      item.id === "home-general"
        ? buildHomeAgentParams(item.params as AgentPageParams | undefined)
        : item.id === "claw"
          ? buildClawAgentParams(item.params as AgentPageParams | undefined)
          : isThemeWorkspacePage(item.page)
            ? buildWorkspaceResetParams(
                item.params as AgentPageParams | undefined,
                (item.params as AgentPageParams | undefined)
                  ?.workspaceViewMode ?? "project-management",
              )
            : item.params;

    onNavigate(item.page, params);
  };

  return (
    <Container>
      <HeaderArea>
        <UserButton onClick={() => onNavigate("agent", buildHomeAgentParams())}>
          <Avatar>
            <img src="/logo.png" alt="ProxyCast" />
          </Avatar>
          <UserName>ProxyCast</UserName>
          <ChevronDown size={14} />
        </UserButton>

        <SearchButton
          onClick={() => onNavigate("agent", buildHomeAgentParams())}
        >
          <Search size={14} />
          <span>搜索任务</span>
        </SearchButton>
      </HeaderArea>

      <MenuScroll>
        <Section>
          {filteredMainMenuItems.map((item) => (
            <NavButton
              key={item.id}
              $active={isActive(item)}
              onClick={() => handleNavigate(item)}
            >
              <item.icon />
              <NavLabel>{item.label}</NavLabel>
            </NavButton>
          ))}
        </Section>

        <Section>
          <SectionTitle>创作主题</SectionTitle>
          {filteredThemeMenuItems.map((item) => (
            <NavButton
              key={item.id}
              $active={isActive(item)}
              onClick={() => handleNavigate(item)}
            >
              <item.icon />
              <NavLabel>{item.label}</NavLabel>
            </NavButton>
          ))}
        </Section>

        {assistantItems.length > 0 && (
          <Section>
            <SectionTitle>助手</SectionTitle>
            {assistantItems.map((item) => (
              <NavButton
                key={item.id}
                $active={isActive(item)}
                onClick={() => handleNavigate(item)}
              >
                <item.icon />
                <NavLabel>{item.label}</NavLabel>
              </NavButton>
            ))}
          </Section>
        )}
      </MenuScroll>

      <FooterArea>
        <Section>
          {filteredFooterMenuItems.map((item) => (
            <NavButton
              key={item.id}
              $active={isActive(item)}
              onClick={() => handleNavigate(item)}
            >
              <item.icon />
              <NavLabel>{item.label}</NavLabel>
            </NavButton>
          ))}
        </Section>

        <ActionRow>
          <IconActionButton
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "深色模式" : "浅色模式"}
          >
            {theme === "dark" ? <Moon /> : <Sun />}
          </IconActionButton>
        </ActionRow>
      </FooterArea>
    </Container>
  );
}
