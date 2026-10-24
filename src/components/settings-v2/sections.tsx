import { lazy, type ReactNode } from "react";
import {
  Home,
  Archive,
  HardDrive,
  User,
  Palette,
  Globe,
  Keyboard,
  Brain,
  Mic,
  Image,
  Plug,
  Puzzle,
  ShieldCheck,
  Variable,
  Info,
  GitBranch,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { SettingsGroupKey, SettingsTabs } from "@/types/settings";
import type {
  ExecutionPolicyFocusContext,
  ProviderSettingsFocusContext,
  SettingsProviderView,
  SettingsPageParams,
  Page,
  PageParams,
} from "@/types/page";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";

export interface SettingsSectionContext {
  onNavigate?: (page: Page, params?: PageParams) => void;
  providerView?: SettingsProviderView;
  providerFocus?: ProviderSettingsFocusContext | null;
  executionPolicyFocus?: ExecutionPolicyFocusContext | null;
  searchPath?: string;
  browserPage?: SettingsPageParams["browserPage"];
  localEnvironmentFocus?: SettingsPageParams["localEnvironmentFocus"];
}

export interface SettingsSection {
  key: SettingsTabs;
  group: SettingsGroupKey | null;
  labelKey: string;
  icon: LucideIcon;
  loadingKey?: string;
  preload: () => Promise<unknown> | null;
  render: (context: SettingsSectionContext) => ReactNode;
}

const loadGeneral = () => import("./general/GeneralSettings");
const loadConfiguration = () => import("./system/configuration");
const ConfigurationPanel = lazy(() =>
  loadConfiguration().then((module) => ({
    default: module.ConfigurationPanel,
  })),
);
const loadStorage = () => import("./general/storage");
const DeviceStorageSettings = lazy(() =>
  loadStorage().then((module) => ({ default: module.DeviceStorageSettings })),
);
const loadGit = () => import("./coding/git");
const loadWorktrees = () => import("./coding/worktrees");
const WorktreesSettings = lazy(() =>
  loadWorktrees().then((module) => ({ default: module.WorktreesSettings })),
);
const GitSettings = lazy(() =>
  loadGit().then((module) => ({ default: module.GitSettings })),
);
const GeneralSettings = lazy(() =>
  loadGeneral().then((module) => ({ default: module.GeneralSettings })),
);
const loadVoice = () => import("./agent/voice");
const VoiceSettings = lazy(() =>
  loadVoice().then((module) => ({ default: module.VoiceSettings })),
);

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

const loadLocalEnvironments = () =>
  import("./coding/local-environments/LocalEnvironmentsSettings");
const LocalEnvironmentsSettings = lazy(() =>
  loadLocalEnvironments().then((module) => ({
    default: module.LocalEnvironmentsSettings,
  })),
);

const loadExecutionPolicy = () => import("./system/execution-policy");
const ExecutionPolicySettings = lazy(() =>
  loadExecutionPolicy().then((module) => ({
    default: module.ExecutionPolicySettings,
  })),
);

// current 章节在此登记一次；导航、可用性、预取与渲染共享同一事实。
export const settingsSections: readonly SettingsSection[] = [
  {
    key: SettingsTabs.General,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.desktop.general",
    icon: Home,
    loadingKey: "settings.layout.loading.general",
    preload: loadGeneral,
    render: () => <GeneralSettings />,
  },
  {
    key: SettingsTabs.Appearance,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.tab.appearance",
    icon: Palette,
    loadingKey: "settings.layout.loading.appearance",
    preload: loadAppearance,
    render: () => <AppearanceSettings />,
  },
  {
    key: SettingsTabs.ArchivedConversations,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.desktop.archivedChats",
    icon: Archive,
    loadingKey: "settings.layout.loading.archivedConversations",
    preload: loadArchivedConversations,
    render: () => <ArchivedConversationsSettings />,
  },
  {
    key: SettingsTabs.Voice,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.desktop.voice",
    icon: Mic,
    loadingKey: "settings.layout.loading.voice",
    preload: loadVoice,
    render: () => <VoiceSettings />,
  },
  {
    key: SettingsTabs.Storage,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.storage.title",
    icon: HardDrive,
    preload: loadStorage,
    render: (context) => (
      <DeviceStorageSettings onNavigate={context.onNavigate} />
    ),
  },
  {
    key: SettingsTabs.Configuration,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.configuration.title",
    icon: SlidersHorizontal,
    preload: loadConfiguration,
    render: () => <ConfigurationPanel />,
  },
  {
    key: SettingsTabs.Memory,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.desktop.personalization",
    icon: Brain,
    loadingKey: "settings.layout.loading.memory",
    preload: loadMemory,
    render: (context) => <MemorySettings initialTab={context.searchPath} />,
  },
  {
    key: SettingsTabs.KeyboardShortcuts,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.tab.keyboardShortcuts",
    icon: Keyboard,
    loadingKey: "settings.layout.loading.keyboardShortcuts",
    preload: loadKeyboardShortcuts,
    render: () => <KeyboardShortcutsSettings />,
  },
  {
    key: SettingsTabs.Providers,
    group: SettingsGroupKey.Personal,
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
    key: SettingsTabs.MediaServices,
    group: SettingsGroupKey.Personal,
    labelKey: "settings.tab.mediaServices",
    icon: Image,
    loadingKey: "settings.layout.loading.mediaServices",
    preload: loadMediaServices,
    render: () => <MediaServicesSettings />,
  },
  {
    key: SettingsTabs.Profile,
    group: SettingsGroupKey.Personal,
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
    key: SettingsTabs.Skills,
    group: SettingsGroupKey.Integrations,
    labelKey: "settings.tab.skills",
    icon: Puzzle,
    loadingKey: "settings.layout.loading.skills",
    preload: loadSkills,
    render: () => <ExtensionsSettings />,
  },
  {
    key: SettingsTabs.McpServer,
    group: SettingsGroupKey.Integrations,
    labelKey: "settings.tab.mcpServer",
    icon: Plug,
    loadingKey: "settings.layout.loading.mcpServer",
    preload: loadMcp,
    render: () => <McpPanel hideHeader />,
  },
  {
    key: SettingsTabs.Browser,
    group: SettingsGroupKey.Integrations,
    labelKey: "settings.tab.browser",
    icon: Globe,
    loadingKey: "settings.layout.loading.browser",
    preload: loadBrowser,
    render: (context) => <BrowserUseSettings page={context.browserPage} />,
  },
  {
    key: SettingsTabs.ExecutionPolicy,
    group: SettingsGroupKey.Coding,
    labelKey: "settings.tab.executionPolicy",
    icon: ShieldCheck,
    loadingKey: "settings.layout.loading.executionPolicy",
    preload: loadExecutionPolicy,
    render: (context) => (
      <ExecutionPolicySettings focus={context.executionPolicyFocus ?? null} />
    ),
  },
  {
    key: SettingsTabs.Git,
    group: SettingsGroupKey.Coding,
    labelKey: "settings.git.title",
    icon: GitBranch,
    preload: loadGit,
    render: () => <GitSettings />,
  },
  {
    key: SettingsTabs.LocalEnvironments,
    group: SettingsGroupKey.Coding,
    labelKey: "settings.localEnvironments.title",
    icon: Variable,
    loadingKey: "settings.localEnvironments.loading",
    preload: loadLocalEnvironments,
    render: (context) => (
      <LocalEnvironmentsSettings focus={context.localEnvironmentFocus} />
    ),
  },
  {
    key: SettingsTabs.Worktrees,
    group: SettingsGroupKey.Coding,
    labelKey: "settings.worktrees.title",
    icon: GitBranch,
    preload: loadWorktrees,
    render: (context) => <WorktreesSettings onNavigate={context.onNavigate} />,
  },
  {
    key: SettingsTabs.About,
    group: null,
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
  return (tab && sectionsByKey.get(tab)) || settingsSections[0];
}
