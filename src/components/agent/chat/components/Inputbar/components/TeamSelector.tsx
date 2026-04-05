import React, { Suspense, lazy, useState } from "react";
import { Users } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { WorkspaceSettings } from "@/types/workspace";
import type { TeamDefinition } from "../../../utils/teamDefinitions";
import { useIdleModulePreload } from "../../../skill-selection/useIdleModulePreload";

const preloadTeamSelectorPanel = () => import("./TeamSelectorPanel");

const TeamSelectorPanel = lazy(async () => {
  const module = await preloadTeamSelectorPanel();
  return { default: module.TeamSelectorPanel };
});

interface TeamSelectorProps {
  activeTheme?: string;
  input?: string;
  autoOpenToken?: number | null;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam: (team: TeamDefinition | null) => void;
  workspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
}

export const TeamSelector: React.FC<TeamSelectorProps> = ({
  activeTheme,
  input,
  autoOpenToken = null,
  selectedTeam = null,
  onSelectTeam,
  workspaceSettings,
  onPersistCustomTeams,
}) => {
  const [open, setOpen] = useState(false);

  useIdleModulePreload(() => {
    void preloadTeamSelectorPanel();
  });

  React.useEffect(() => {
    if (autoOpenToken === null || autoOpenToken === undefined) {
      return;
    }
    setOpen(true);
  }, [autoOpenToken]);

  const resolvedLabel = selectedTeam?.label?.trim()
    ? `Team · ${selectedTeam.label.trim()}`
    : "配置 Team";

  const selectedRoleCount = selectedTeam?.roles.length || 0;

  return (
    <>
      <button
        type="button"
        data-testid="team-selector-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-none transition-colors",
          selectedTeam
            ? "border-sky-300 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
            : "border-slate-200/80 bg-white text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900",
        )}
      >
        <Users className="h-3.5 w-3.5" />
        <span className="max-w-[180px] truncate">{resolvedLabel}</span>
        {selectedRoleCount > 0 ? (
          <span className="rounded-full border border-current/15 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
            {selectedRoleCount}
          </span>
        ) : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(1120px,calc(100vw-32px))] max-w-[1120px] overflow-hidden border-slate-200/80 bg-white p-0 shadow-2xl">
          {open ? (
            <Suspense
              fallback={
                <div className="px-4 py-7 text-center text-sm text-slate-500">
                  加载中...
                </div>
              }
            >
              <TeamSelectorPanel
                activeTheme={activeTheme}
                input={input}
                selectedTeam={selectedTeam}
                workspaceSettings={workspaceSettings}
                onPersistCustomTeams={onPersistCustomTeams}
                onSelectTeam={(team) => {
                  onSelectTeam(team);
                  setOpen(false);
                }}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};
