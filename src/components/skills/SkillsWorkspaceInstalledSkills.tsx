import type { ReactNode } from "react";
import {
  BookOpen,
  Check,
  Download,
  FolderOpen,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  matchProtocolSkillEnabledState,
  type ProtocolSkillEnabledState,
} from "@/lib/api/skillConfig";
import type { Skill } from "@/lib/api/skills";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { InstalledSkillPresentationCopy } from "./installedSkillPresentation";
import { resolveInstalledSkillPromise } from "./installedSkillPresentation";
import { SkillTileSvg } from "./SkillsWorkspacePageVisuals";

export function InstalledSkillActionMenu({
  exportingSkillDirectory,
  autoLoadEnabled,
  onDetailOpen,
  onExport,
  onRename,
  onToggleAutoLoad,
  onToggleProtocol,
  protocolEnabledState,
  protocolPending,
  onReplace,
  onReveal,
  onSelect,
  onUninstall,
  renamingSkillDirectory,
  replacingSkillDirectory,
  revealingSkillDirectory,
  skill,
  uninstallingSkillDirectory,
}: {
  autoLoadEnabled?: boolean;
  exportingSkillDirectory: string | null;
  onDetailOpen: (directory: string) => void;
  onExport: (skill: Skill) => void;
  onToggleAutoLoad?: (skill: Skill, enabled: boolean) => void;
  onToggleProtocol?: (skill: Skill, enabled: boolean) => void;
  protocolEnabledState?: ProtocolSkillEnabledState | null;
  protocolPending?: boolean;
  onRename: (skill: Skill) => void;
  onReplace: (skill: Skill) => void;
  onReveal: (skill: Skill) => void;
  onSelect: (skill: Skill) => void;
  onUninstall: (skill: Skill) => void;
  renamingSkillDirectory: string | null;
  replacingSkillDirectory: string | null;
  revealingSkillDirectory: string | null;
  skill: Skill;
  uninstallingSkillDirectory: string | null;
}) {
  const { t } = useTranslation("agent");
  const isProtected =
    skill.sourceKind === "builtin" || skill.catalogSource === "project";
  const isRenaming = renamingSkillDirectory === skill.directory;
  const isReplacing = replacingSkillDirectory === skill.directory;
  const isRevealing = revealingSkillDirectory === skill.directory;
  const isExporting = exportingSkillDirectory === skill.directory;
  const isUninstalling = uninstallingSkillDirectory === skill.directory;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          aria-label={t("skills.workspace.installedSkill.action.more", {
            name: skill.name,
          })}
          title={t("skills.workspace.installedSkill.action.more", {
            name: skill.name,
          })}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-[80] min-w-[210px] rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1 text-[color:var(--lime-text)] shadow-lg"
      >
        {protocolEnabledState && onToggleProtocol ? (
          <DropdownMenuItem
            className={cn(
              "rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]",
              protocolPending && "pointer-events-none opacity-50",
            )}
            onClick={() => {
              if (protocolPending) return;
              onToggleProtocol(skill, !protocolEnabledState.enabled);
            }}
          >
            {protocolEnabledState.enabled ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Check className="h-4 w-4 text-slate-300" />
            )}
            {t("skills.workspace.configEnabled.label")}
            <span className="ml-auto pl-2 text-[11px] text-slate-400">
              {protocolEnabledState.enabled
                ? t("skills.workspace.configEnabled.on")
                : t("skills.workspace.configEnabled.off")}
            </span>
          </DropdownMenuItem>
        ) : null}
        {onToggleAutoLoad ? (
          <DropdownMenuItem
            className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
            onClick={() => onToggleAutoLoad(skill, !autoLoadEnabled)}
          >
            {autoLoadEnabled ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Check className="h-4 w-4 text-slate-300" />
            )}
            {t("skills.workspace.autoLoad.label")}
            <span className="ml-auto pl-2 text-[11px] text-slate-400">
              {autoLoadEnabled
                ? t("skills.workspace.autoLoad.on")
                : t("skills.workspace.autoLoad.off")}
            </span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator className="bg-[color:var(--lime-surface-border)]" />
        <DropdownMenuItem
          className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
          onClick={() => onSelect(skill)}
        >
          <MessageCircle className="h-4 w-4 text-slate-500" />
          {t("skills.workspace.installedSkill.action.tryInChat")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
          onClick={() => onDetailOpen(skill.directory)}
        >
          <BookOpen className="h-4 w-4 text-slate-500" />
          {t("skills.workspace.marketplace.action.detail")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn(
            "rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]",
            isProtected && "pointer-events-none opacity-50",
          )}
          onClick={() => onRename(skill)}
        >
          <Pencil className="h-4 w-4 text-slate-500" />
          {isRenaming
            ? t("skills.workspace.installedSkill.action.renaming")
            : t("skills.workspace.installedSkill.action.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn(
            "rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]",
            isProtected && "pointer-events-none opacity-50",
          )}
          onClick={() => onReplace(skill)}
        >
          <Upload className="h-4 w-4 text-slate-500" />
          {isReplacing
            ? t("skills.workspace.installedSkill.action.replacing")
            : t("skills.workspace.installedSkill.action.replace")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]"
          onClick={() => onReveal(skill)}
        >
          <FolderOpen className="h-4 w-4 text-slate-500" />
          {isRevealing
            ? t("skills.workspace.installedSkill.action.showingInFolder")
            : t("skills.workspace.installedSkill.action.showInFolder")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn(
            "rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-[color:var(--lime-surface-hover)]",
            isProtected && "pointer-events-none opacity-50",
          )}
          onClick={() => onExport(skill)}
        >
          <Download className="h-4 w-4 text-slate-500" />
          {isExporting
            ? t("skills.workspace.installedSkill.action.exporting")
            : t("skills.workspace.installedSkill.action.export")}
        </DropdownMenuItem>
        {!isProtected ? (
          <>
            <DropdownMenuSeparator className="bg-[color:var(--lime-surface-border)]" />
            <DropdownMenuItem
              className="rounded-lg px-3 py-2 text-[13px] font-semibold text-rose-700 hover:bg-rose-50"
              onClick={() => onUninstall(skill)}
            >
              <Trash2 className="h-4 w-4" />
              {isUninstalling
                ? t("skills.workspace.installedSkill.action.uninstalling")
                : t("skills.workspace.installedSkill.action.uninstall")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LocalSkillRow({
  highlighted,
  installedSkillPresentationCopy,
  onDetailOpen,
  onSelect,
  protocolSkillEnabledStates = [],
  skill,
  actionMenu,
}: {
  highlighted?: boolean;
  installedSkillPresentationCopy: InstalledSkillPresentationCopy;
  onDetailOpen: (directory: string) => void;
  onSelect?: (skill: Skill) => void;
  protocolSkillEnabledStates?: readonly ProtocolSkillEnabledState[];
  skill: Skill;
  actionMenu?: ReactNode;
}) {
  const protocolSkillEnabled = matchProtocolSkillEnabledState(
    skill,
    protocolSkillEnabledStates,
  );

  return (
    <div
      data-testid="skills-local-skill-row"
      data-skill-directory={skill.directory}
      className={cn(
        "group flex w-full min-w-0 items-start gap-3 rounded-lg px-3 py-2 text-left",
        highlighted ? "bg-emerald-50/60" : "hover:bg-slate-50",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <SkillTileSvg tone={highlighted ? "emerald" : "slate"} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="line-clamp-1 max-w-full text-left text-sm font-semibold text-slate-900 hover:underline"
            onClick={() => onDetailOpen(skill.directory)}
            data-testid="skills-local-skill-detail"
          >
            {skill.name}
          </button>
          <p className="line-clamp-1 text-xs leading-5 text-slate-500">
            {skill.description ||
              resolveInstalledSkillPromise(skill, installedSkillPresentationCopy)}
          </p>
        </div>
        {onSelect ? (
          <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {actionMenu}
          </span>
        ) : null}
        <span
          className="flex shrink-0 items-center gap-1 pt-0.5"
          data-testid="skills-installed-check"
        >
          <Check
            className={cn(
              "h-4 w-4 shrink-0",
              protocolSkillEnabled && !protocolSkillEnabled.enabled
                ? "text-slate-300"
                : "text-emerald-600",
            )}
            aria-hidden="true"
          />
        </span>
      </div>
    </div>
  );
}
