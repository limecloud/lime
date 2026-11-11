import { useState } from "react";
import {
  BookOpen,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProtocolSkillEnabledState } from "@/lib/api/skillConfig";
import type { Skill } from "@/lib/api/skills";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime/toolInventoryTypes";
import { WorkspaceRegisteredSkillsPanel } from "@/features/capability-drafts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/i18n/format";
import type { InstalledSkillPresentationCopy } from "./installedSkillPresentation";
import {
  type SkillsWorkspaceView,
  type SkillStoreItem,
} from "./SkillsWorkspacePageViewModel";
import type {
  InstalledSkillDetailContentState,
  MarketplaceSkillActionState,
  MarketplaceSkillDetailContentState,
  SkillsWorkspaceProjectState,
  SkillsWorkspaceViewTab,
} from "./SkillsWorkspacePageTypes";
import {
  isSkillAutoLoadEnabled,
  type SkillAutoLoadPreferences,
} from "./skillAutoLoadPreferences";
import { matchProtocolSkillEnabledState } from "@/lib/api/skillConfig";
import {
  InstalledSkillDetailDialog,
  MarketplaceSkillDetailDialog,
} from "./SkillsWorkspaceDetailDialogs";
import {
  InstalledSkillActionMenu,
  LocalSkillRow,
} from "./SkillsWorkspaceInstalledSkills";
import { MarketplaceSkillSection } from "./SkillsWorkspaceMarketplace";

interface SkillsWorkspacePageViewProps {
  activeView: SkillsWorkspaceView;
  currentProjectState: SkillsWorkspaceProjectState;
  detailContentState: MarketplaceSkillDetailContentState | null;
  detailInstalledSkill: Skill | null;
  detailStoreItem: SkillStoreItem | null;
  highlightedInstalledSkillDirectory: string | null;
  installedDetailContentState: InstalledSkillDetailContentState | null;
  installedDetailSelectedFilePath: string;
  installedSkillPresentationCopy: InstalledSkillPresentationCopy;
  isRefreshing: boolean;
  isSelectingLocalSkillPackage: boolean;
  localSkillsError?: string | null;
  officialMarketplaceError?: string | null;
  officialMarketplaceLoading: boolean;
  officialMarketplaceSkillCount: number;
  registeredSkillsRefreshSignal: number;
  searchQuery: string;
  selectedStoreItem: SkillStoreItem | null;
  serviceSkillsError?: string | null;
  skillAutoLoadPreferences: SkillAutoLoadPreferences;
  skillStoreCount: number;
  viewTabs: SkillsWorkspaceViewTab[];
  visibleBuiltinLocalSkills: Skill[];
  visibleStoreItems: SkillStoreItem[];
  visibleUserInstalledSkills: Skill[];
  exportingSkillDirectory: string | null;
  renamingSkillDirectory: string | null;
  replacingSkillDirectory: string | null;
  revealingSkillDirectory: string | null;
  uninstallingSkillDirectory: string | null;
  findInstalledMarketplaceLocalSkill: (
    item: SkillStoreItem,
  ) => Skill | undefined;
  getMarketplaceSkillActionLabel: (
    state: MarketplaceSkillActionState,
  ) => string;
  onActiveViewChange: (view: SkillsWorkspaceView) => void;
  onEnableRegisteredSkillRuntime: (
    binding: AgentRuntimeWorkspaceSkillBinding,
  ) => void;
  onExportLocalSkillPackage: (skill: Skill) => void;
  onInstalledDetailClose: () => void;
  onInstalledDetailSelectedFilePathChange: (path: string) => void;
  onInstalledSkillDetailOpen: (directory: string) => void;
  onInstalledSkillSelect: (skill: Skill) => void;
  onMarketplaceDetailClose: () => void;
  onMarketplaceSkillDetailOpen: (skillName: string) => void;
  onMarketplaceSkillPrimaryAction: (item: SkillStoreItem) => void;
  onMarketplaceSkillUninstall: (item: SkillStoreItem) => void;
  onOpenScaffoldDialog: () => void;
  onRefreshAll: () => void;
  onRenameLocalSkill: (skill: Skill) => void;
  onReplaceLocalSkillPackage: (skill: Skill) => void;
  onRevealLocalSkill: (skill: Skill) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectLocalSkillPackage: () => void;
  onProtocolSkillEnabledChange?: (skill: Skill, enabled: boolean) => void;
  onSkillAutoLoadChange: (skill: Skill, enabled: boolean) => void;
  protocolSkillEnabledPendingKey?: string | null;
  protocolSkillEnabledStates?: readonly ProtocolSkillEnabledState[];
  onUninstallLocalSkill: (skill: Skill) => void;
  resolveMarketplaceSkillActionState: (
    item: SkillStoreItem,
  ) => MarketplaceSkillActionState;
}

export function SkillsWorkspacePageView(props: SkillsWorkspacePageViewProps) {
  const { t, i18n } = useTranslation("agent");
  const [showAllInstalledSkills, setShowAllInstalledSkills] = useState(false);
  const installedSkillPreviewLimit = 6;
  const installedSkillsOverflow =
    props.visibleUserInstalledSkills.length > installedSkillPreviewLimit;
  const visibleInstalledSkills = showAllInstalledSkills
    ? props.visibleUserInstalledSkills
    : props.visibleUserInstalledSkills.slice(0, installedSkillPreviewLimit);

  const cardProps = {
    findInstalledMarketplaceLocalSkill:
      props.findInstalledMarketplaceLocalSkill,
    getMarketplaceSkillActionLabel: props.getMarketplaceSkillActionLabel,
    onDetailOpen: props.onMarketplaceSkillDetailOpen,
    onPrimaryAction: props.onMarketplaceSkillPrimaryAction,
    onUninstall: props.onMarketplaceSkillUninstall,
    resolveMarketplaceSkillActionState:
      props.resolveMarketplaceSkillActionState,
    selectedStoreItem: props.selectedStoreItem,
  };

  return (
    <>
      <div className="lime-workbench-theme-scope flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--lime-app-bg)] text-[color:var(--lime-text)]">
        <header className="flex h-16 shrink-0 items-center justify-end gap-3 border-b border-[color:var(--lime-surface-border)] bg-[color:var(--lime-app-bg)] px-5 lg:px-8">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-full p-0 text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)]"
            data-testid="skills-workspace-refresh-button"
            onClick={props.onRefreshAll}
            disabled={props.isRefreshing}
            aria-label={t("skills.workspace.header.refresh")}
          >
            <RefreshCw
              className={cn("h-4 w-4", props.isRefreshing && "animate-spin")}
            />
          </Button>
          <label className="relative hidden w-[280px] sm:block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--lime-text-muted)]" />
            <Input
              value={props.searchQuery}
              onChange={(event) =>
                props.onSearchQueryChange(event.target.value)
              }
              placeholder={t("skills.workspace.search.placeholder")}
              className="h-9 rounded-full border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] pl-10 pr-4 text-sm font-semibold text-[color:var(--lime-text-strong)] shadow-none placeholder:text-[color:var(--lime-text-muted)]"
            />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-full border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-3 text-sm font-semibold text-[color:var(--lime-text-strong)] shadow-none hover:bg-[color:var(--lime-surface-hover)]"
                aria-label={t("skills.workspace.manageMenu.trigger")}
              >
                <SettingsIcon className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">
                  {t("skills.workspace.manageMenu.trigger")}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[80] min-w-[240px] rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1 text-[color:var(--lime-text)] shadow-lg"
            >
              <DropdownMenuItem
                className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
                onClick={() => props.onActiveViewChange("store")}
              >
                <BookOpen className="h-4 w-4 text-slate-500" />
                {t("skills.workspace.manageMenu.browse")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[color:var(--lime-surface-border)]" />
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-[color:var(--lime-text-muted)]">
                {t("skills.workspace.manageMenu.create")}
              </div>
              <DropdownMenuItem
                className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
                onClick={props.onOpenScaffoldDialog}
              >
                <Plus className="h-4 w-4 text-slate-500" />
                <span className="min-w-0 flex-1">
                  {t("skills.workspace.manageMenu.createWithLime")}
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
                onClick={props.onOpenScaffoldDialog}
              >
                <Pencil className="h-4 w-4 text-slate-500" />
                <span className="min-w-0 flex-1">
                  {t("skills.workspace.manageMenu.writeInstructions")}
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[color:var(--lime-surface-border)]" />
              <DropdownMenuItem
                className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
                onClick={props.onSelectLocalSkillPackage}
              >
                <Upload className="h-4 w-4 text-slate-500" />
                {t("skills.workspace.manageMenu.upload")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-full bg-[color:var(--lime-text-strong)] px-5 text-sm font-semibold text-[color:var(--lime-surface)] shadow-none hover:opacity-90"
            disabled={props.isSelectingLocalSkillPackage}
            onClick={props.onSelectLocalSkillPackage}
          >
            {props.isSelectingLocalSkillPackage
              ? t("skills.workspace.header.installingSkill")
              : t("skills.workspace.header.installSkill")}
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-auto bg-[color:var(--lime-surface)] px-5 pb-10 pt-10">
          <div className="mx-auto w-full max-w-[900px] space-y-8">
            <section className="space-y-4">
              <div>
                <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-[color:var(--lime-text-strong)]">
                  {t("skills.workspace.header.title")}
                </h1>
                <p className="mt-2 text-sm leading-6 text-[color:var(--lime-text-muted)]">
                  {t("skills.workspace.header.subtitle")}
                </p>
              </div>
            </section>

            {(props.serviceSkillsError || props.localSkillsError) && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                {props.serviceSkillsError
                  ? t("skills.workspace.error.serviceSkills", {
                      message: props.serviceSkillsError,
                    })
                  : null}
                {props.serviceSkillsError && props.localSkillsError
                  ? t("skills.workspace.error.separator")
                  : null}
                {props.localSkillsError
                  ? t("skills.workspace.error.localSkills", {
                      message: props.localSkillsError,
                    })
                  : null}
              </section>
            )}

                <section
                id="skills-installed-view"
                role="tabpanel"
                className="space-y-3"
                data-testid="skills-installed-view"
              >
                <WorkspaceRegisteredSkillsPanel
                  workspaceRoot={props.currentProjectState.rootPath}
                  workspaceId={props.currentProjectState.id}
                  projectPending={props.currentProjectState.pending}
                  projectError={props.currentProjectState.error}
                  refreshSignal={props.registeredSkillsRefreshSignal}
                  onEnableRuntime={props.onEnableRegisteredSkillRuntime}
                  hideWhenEmpty
                />
                <div>
                  <h2 className="text-xs font-semibold text-slate-700">
                    {t("skills.workspace.installed.title")}
                  </h2>
                </div>
                {props.visibleUserInstalledSkills.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {visibleInstalledSkills.map((skill) => (
                      <LocalSkillRow
                        key={skill.key}
                        skill={skill}
                        highlighted={
                          skill.directory ===
                          props.highlightedInstalledSkillDirectory
                        }
                        installedSkillPresentationCopy={
                          props.installedSkillPresentationCopy
                        }
                        protocolSkillEnabledStates={
                          props.protocolSkillEnabledStates
                        }
                        onDetailOpen={props.onInstalledSkillDetailOpen}
                        onSelect={props.onInstalledSkillSelect}
                        actionMenu={
                          <InstalledSkillActionMenu
                            skill={skill}
                            autoLoadEnabled={isSkillAutoLoadEnabled(
                              skill,
                              props.skillAutoLoadPreferences,
                            )}
                            onToggleAutoLoad={props.onSkillAutoLoadChange}
                            protocolEnabledState={matchProtocolSkillEnabledState(
                              skill,
                              props.protocolSkillEnabledStates ?? [],
                            )}
                            protocolPending={
                              props.protocolSkillEnabledPendingKey === skill.key
                            }
                            onToggleProtocol={
                              props.onProtocolSkillEnabledChange
                            }
                            exportingSkillDirectory={
                              props.exportingSkillDirectory
                            }
                            renamingSkillDirectory={
                              props.renamingSkillDirectory
                            }
                            replacingSkillDirectory={
                              props.replacingSkillDirectory
                            }
                            revealingSkillDirectory={
                              props.revealingSkillDirectory
                            }
                            uninstallingSkillDirectory={
                              props.uninstallingSkillDirectory
                            }
                            onDetailOpen={props.onInstalledSkillDetailOpen}
                            onExport={props.onExportLocalSkillPackage}
                            onRename={props.onRenameLocalSkill}
                            onReplace={props.onReplaceLocalSkillPackage}
                            onReveal={props.onRevealLocalSkill}
                            onSelect={props.onInstalledSkillSelect}
                            onUninstall={props.onUninstallLocalSkill}
                          />
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    {t("skills.workspace.sidebar.local.empty")}
                  </div>
                )}
                {installedSkillsOverflow ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
                    data-testid="skills-installed-toggle-all"
                    onClick={() => setShowAllInstalledSkills((value) => !value)}
                  >
                    {showAllInstalledSkills
                      ? t("skills.workspace.installed.showLess")
                      : t("skills.workspace.installed.showMore", {
                          count:
                            props.visibleUserInstalledSkills.length -
                            installedSkillPreviewLimit,
                        })}
                  </button>
                ) : null}
              </section>

            <nav className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex items-center gap-5"
                role="tablist"
                aria-label={t("skills.workspace.view.tabsLabel")}
              >
                {props.viewTabs.map((tab) => {
                  const active = props.activeView === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls={`skills-${tab.key}-view`}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition",
                        active
                          ? "bg-[color:var(--lime-surface-hover)] text-[color:var(--lime-text-strong)]"
                          : "text-[color:var(--lime-text-muted)] hover:text-[color:var(--lime-text-strong)]",
                      )}
                      onClick={() => props.onActiveViewChange(tab.key)}
                    >
                      {tab.label}
                      {tab.key === "installed" &&
                      typeof tab.count === "number" ? (
                        <span className="text-xs text-[color:var(--lime-text-muted)]">
                          {formatNumber(tab.count, { locale: i18n.language })}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

            </nav>

            {props.activeView === "store" ? (
              <div
                id="skills-store-view"
                role="tabpanel"
                className="space-y-6"
                data-testid="skills-store-view"
              >
                <div className="space-y-5">
                  {props.officialMarketplaceError &&
                  props.officialMarketplaceSkillCount === 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                      {t("skills.workspace.marketplace.fallbackNotice")}
                    </div>
                  ) : null}
                  {props.visibleStoreItems.length > 0 ? (
                    <>
                      <MarketplaceSkillSection
                        items={props.visibleStoreItems}
                        startIndex={0}
                        {...cardProps}
                      />
                      <p className="text-[12px] leading-5 text-[color:var(--lime-text-muted)]">
                        {t("skills.workspace.marketplace.footerCount", {
                          count: props.skillStoreCount,
                        })}
                      </p>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      {t("skills.workspace.marketplace.empty")}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {props.activeView === "builtin" ? (
              <section
                id="skills-builtin-view"
                role="tabpanel"
                className="space-y-3"
                data-testid="skills-builtin-view"
              >
                <div>
                  <h2 className="text-xs font-semibold text-slate-700">
                    {t("skills.workspace.builtin.title")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("skills.workspace.builtin.subtitle")}
                  </p>
                </div>
                {props.visibleBuiltinLocalSkills.length > 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-white">
                    {props.visibleBuiltinLocalSkills.map((skill) => (
                      <LocalSkillRow
                        key={skill.key}
                        skill={skill}
                        installedSkillPresentationCopy={
                          props.installedSkillPresentationCopy
                        }
                        protocolSkillEnabledStates={
                          props.protocolSkillEnabledStates
                        }
                        onDetailOpen={props.onInstalledSkillDetailOpen}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    {t("skills.workspace.builtin.empty")}
                  </div>
                )}
              </section>
            ) : null}

          </div>
        </main>
      </div>

      <InstalledSkillDetailDialog
        skill={props.detailInstalledSkill}
        contentState={props.installedDetailContentState}
        installedSkillPresentationCopy={props.installedSkillPresentationCopy}
        selectedFilePath={props.installedDetailSelectedFilePath}
        onClose={props.onInstalledDetailClose}
        onSelect={props.onInstalledSkillSelect}
        onSelectedFilePathChange={props.onInstalledDetailSelectedFilePathChange}
      />
      <MarketplaceSkillDetailDialog
        detailStoreItem={props.detailStoreItem}
        contentState={props.detailContentState}
        findInstalledMarketplaceLocalSkill={
          props.findInstalledMarketplaceLocalSkill
        }
        getMarketplaceSkillActionLabel={props.getMarketplaceSkillActionLabel}
        onClose={props.onMarketplaceDetailClose}
        onPrimaryAction={props.onMarketplaceSkillPrimaryAction}
        onUninstall={props.onMarketplaceSkillUninstall}
        resolveMarketplaceSkillActionState={
          props.resolveMarketplaceSkillActionState
        }
      />
    </>
  );
}
