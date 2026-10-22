import { lazy, type ReactNode } from "react";
import {
  Home,
  Archive,
  User,
  BarChart3,
  Palette,
  Globe,
  Keyboard,
  Brain,
  Image,
  Plug,
  Puzzle,
  Search,
  ShieldCheck,
  Variable,
  Code,
  Info,
  type LucideIcon,
} from "lucide-react";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";
import type {
  ExecutionPolicyFocusContext,
  ProviderSettingsFocusContext,
  SettingsProviderView,
  SettingsPageParams,
} from "@/types/page";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";

export interface SettingsSectionContext {
  renderHome: () => ReactNode;
  providerView?: SettingsProviderView;
  providerFocus?: ProviderSettingsFocusContext | null;
  executionPolicyFocus?: ExecutionPolicyFocusContext | null;
  searchPath?: string;
  developerLabTab: "developer" | "experimental";
  browserPage?: SettingsPageParams["browserPage"];
}

export interface SettingsSection {
  key: Exclude<SettingsTabs, SettingsTabs.Experimental>;
  group: SettingsGroupKey;
  labelKey: string;
  icon: LucideIcon;
  experimental?: boolean;
  loadingKey?: string;
  preload: () => Promise<unknown> | null;
  render: (context: SettingsSectionContext) => ReactNode;
}

const loadAppearance = () => import("./general/appearance");
const AppearanceSettings = lazy(() =>
  loadAppearance().then((module) => ({ default: module.AppearanceSettings })),
);

const loadMemory = () => import("./general/memory");
const MemorySettings = lazy(() =>
  loadMemory().then((module) => ({ default: module.MemorySettings })),
);

const loadBrowser = () => import("./general/browser");
const BrowserUseSettings = lazy(() =>
  loadBrowser().then((module) => ({ default: module.BrowserUseSettings })),
);
const loadKeyboardShortcuts = () => import("./general/keyboard-shortcuts");
const KeyboardShortcutsSettings = lazy(() =>
  loadKeyboardShortcuts().then((module) => ({
    default: module.KeyboardShortcutsSettings,
  })),
);

const loadArchivedConversations = () =>
  import("./general/archived-conversations");
const ArchivedConversationsSettings = lazy(() =>
  loadArchivedConversations().then((module) => ({
    default: module.ArchivedConversationsSettings,
  })),
);

const loadDeveloperLab = () => import("./system/developer-lab");
const DeveloperLabSettings = lazy(() =>
  loadDeveloperLab().then((module) => ({
    default: module.DeveloperLabSettings,
  })),
);

const loadAbout = () => import("./system/about");
const AboutSection = lazy(() =>
  loadAbout().then((module) => ({ default: module.AboutSection })),
);

const loadMediaServices = () => import("./agent/media-services");
const MediaServicesSettings = lazy(() =>
  loadMediaServices().then((module) => ({
    default: module.MediaServicesSettings,
  })),
);

const loadSkills = () => import("./agent/skills");
const ExtensionsSettings = lazy(() =>
  loadSkills().then((module) => ({ default: module.ExtensionsSettings })),
);

const loadStats = () => import("./account/stats");
const StatsSettings = lazy(() =>
  loadStats().then((module) => ({ default: module.StatsSettings })),
);

const loadProfile = () => import("./account/profile");
const ProfileSettings = lazy(() =>
  loadProfile().then((module) => ({ default: module.ProfileSettings })),
);

const loadUserCenterSession = () => import("./account/user-center-session");
const UserCenterSessionSettings = lazy(() =>
  loadUserCenterSession().then((module) => ({
    default: module.UserCenterSessionSettings,
  })),
);

const loadProviders = () => import("./agent/providers");
const CloudProviderSettings = lazy(() =>
  loadProviders().then((module) => ({ default: module.CloudProviderSettings })),
);

const loadMcp = () => import("@/components/mcp");
const McpPanel = lazy(() =>
  loadMcp().then((module) => ({ default: module.McpPanel })),
);

const loadEnvironment = () => import("./system/environment");
const EnvironmentSettings = lazy(() =>
  loadEnvironment().then((module) => ({ default: module.EnvironmentSettings })),
);

const loadExecutionPolicy = () => import("./system/execution-policy");
const ExecutionPolicySettings = lazy(() =>
  loadExecutionPolicy().then((module) => ({
    default: module.ExecutionPolicySettings,
  })),
);

const loadWebSearch = () => import("./system/web-search");
const WebSearchSettings = lazy(() =>
  loadWebSearch().then((module) => ({ default: module.WebSearchSettings })),
);

// current 章节在此登记一次；导航、可用性、预取与渲染共享同一事实。
export const settingsSections: readonly SettingsSection[] = [
  {
    key: SettingsTabs.Home,
    group: SettingsGroupKey.Overview,
    labelKey: "settings.tab.home",
    icon: Home,
    preload: () => null,
    render: (context) => context.renderHome(),
  },
  {
    key: SettingsTabs.Profile,
    group: SettingsGroupKey.Account,
    labelKey: "settings.tab.profile",
    icon: User,
    loadingKey: "settings.layout.loading.profile",
    preload: () =>
      resolveOemCloudRuntimeContext() ? loadUserCenterSession() : loadProfile(),
    render: () =>
      resolveOemCloudRuntimeContext() ? (
        <UserCenterSessionSettings />
      ) : (
        <ProfileSettings />
      ),
  },
  {
    key: SettingsTabs.Stats,
    group: SettingsGroupKey.Account,
    labelKey: "settings.tab.stats",
    icon: BarChart3,
    loadingKey: "settings.layout.loading.stats",
    preload: loadStats,
    render: () => <StatsSettings />,
  },
  {
    key: SettingsTabs.Appearance,
    group: SettingsGroupKey.General,
    labelKey: "settings.tab.appearance",
    icon: Palette,
    loadingKey: "settings.layout.loading.appearance",
    preload: loadAppearance,
    render: () => <AppearanceSettings />,
  },
  {
    key: SettingsTabs.Browser,
    group: SettingsGroupKey.General,
    labelKey: "settings.tab.browser",
    icon: Globe,
    loadingKey: "settings.layout.loading.browser",
    preload: loadBrowser,
    render: (context) => <BrowserUseSettings page={context.browserPage} />,
  },
  {
    key: SettingsTabs.KeyboardShortcuts,
    group: SettingsGroupKey.General,
    labelKey: "settings.tab.keyboardShortcuts",
    icon: Keyboard,
    loadingKey: "settings.layout.loading.keyboardShortcuts",
    preload: loadKeyboardShortcuts,
    render: () => <KeyboardShortcutsSettings />,
  },
  {
    key: SettingsTabs.Memory,
    group: SettingsGroupKey.General,
    labelKey: "settings.tab.memory",
    icon: Brain,
    loadingKey: "settings.layout.loading.memory",
    preload: loadMemory,
    render: (context) => <MemorySettings initialTab={context.searchPath} />,
  },
  {
    key: SettingsTabs.ArchivedConversations,
    group: SettingsGroupKey.General,
    labelKey: "settings.tab.archivedConversations",
    icon: Archive,
    loadingKey: "settings.layout.loading.archivedConversations",
    preload: loadArchivedConversations,
    render: () => <ArchivedConversationsSettings />,
  },
  {
    key: SettingsTabs.Providers,
    group: SettingsGroupKey.Agent,
    labelKey: "settings.tab.providers",
    icon: Brain,
    loadingKey: "settings.layout.loading.providers",
    preload: loadProviders,
    render: (context) => (
      <CloudProviderSettings
        initialView={context.providerView}
        initialFocus={context.providerFocus}
      />
    ),
  },
  {
    key: SettingsTabs.Skills,
    group: SettingsGroupKey.Agent,
    labelKey: "settings.tab.skills",
    icon: Puzzle,
    loadingKey: "settings.layout.loading.skills",
    preload: loadSkills,
    render: () => <ExtensionsSettings />,
  },
  {
    key: SettingsTabs.MediaServices,
    group: SettingsGroupKey.Agent,
    labelKey: "settings.tab.mediaServices",
    icon: Image,
    loadingKey: "settings.layout.loading.mediaServices",
    preload: loadMediaServices,
    render: () => <MediaServicesSettings />,
  },
  {
    key: SettingsTabs.McpServer,
    group: SettingsGroupKey.System,
    labelKey: "settings.tab.mcpServer",
    icon: Plug,
    loadingKey: "settings.layout.loading.mcpServer",
    preload: loadMcp,
    render: () => <McpPanel hideHeader />,
  },
  {
    key: SettingsTabs.WebSearch,
    group: SettingsGroupKey.System,
    labelKey: "settings.tab.webSearch",
    icon: Search,
    loadingKey: "settings.layout.loading.webSearch",
    preload: loadWebSearch,
    render: (context) => <WebSearchSettings initialTab={context.searchPath} />,
  },
  {
    key: SettingsTabs.Environment,
    group: SettingsGroupKey.System,
    labelKey: "settings.tab.environment",
    icon: Variable,
    loadingKey: "settings.layout.loading.environment",
    preload: loadEnvironment,
    render: () => <EnvironmentSettings />,
  },
  {
    key: SettingsTabs.ExecutionPolicy,
    group: SettingsGroupKey.System,
    labelKey: "settings.tab.executionPolicy",
    icon: ShieldCheck,
    loadingKey: "settings.layout.loading.executionPolicy",
    preload: loadExecutionPolicy,
    render: (context) => (
      <ExecutionPolicySettings focus={context.executionPolicyFocus ?? null} />
    ),
  },
  {
    key: SettingsTabs.Developer,
    group: SettingsGroupKey.System,
    labelKey: "settings.tab.developerLab",
    icon: Code,
    experimental: true,
    loadingKey: "settings.layout.loading.developerLab",
    preload: () =>
      Promise.all([
        loadDeveloperLab(),
        import("./system/developer/preload").then((module) =>
          module.preloadDeveloperDefaultSections(),
        ),
      ]),
    render: (context) => (
      <DeveloperLabSettings
        initialTab={
          context.searchPath === "experimental"
            ? "experimental"
            : context.developerLabTab
        }
      />
    ),
  },
  {
    key: SettingsTabs.About,
    group: SettingsGroupKey.System,
    labelKey: "settings.tab.about",
    icon: Info,
    loadingKey: "settings.layout.loading.about",
    preload: loadAbout,
    render: () => <AboutSection />,
  },
];

const sectionsByKey = new Map<SettingsTabs, SettingsSection>(
  settingsSections.map((section) => [section.key, section]),
);

export function isSettingsSection(tab: SettingsTabs): boolean {
  return sectionsByKey.has(tab);
}

export function resolveSettingsSection(tab?: SettingsTabs): SettingsSection {
  const canonicalTab =
    tab === SettingsTabs.Experimental ? SettingsTabs.Developer : tab;
  return (
    (canonicalTab && sectionsByKey.get(canonicalTab)) || settingsSections[0]
  );
}
