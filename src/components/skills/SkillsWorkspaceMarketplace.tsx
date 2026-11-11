import { MoreHorizontal, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Skill } from "@/lib/api/skills";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ServiceSkillTone } from "@/components/agent/chat/service-skills/types";
import {
  buildMarketplaceIconPlaceholder,
  type SkillStoreItem,
} from "./SkillsWorkspacePageViewModel";
import type { MarketplaceSkillActionState } from "./SkillsWorkspacePageTypes";
import { MarketplaceSkillVisual } from "./SkillsWorkspacePageVisuals";

interface MarketplaceSkillCardActionProps {
  findInstalledMarketplaceLocalSkill: (item: SkillStoreItem) => Skill | undefined;
  getMarketplaceSkillActionLabel: (state: MarketplaceSkillActionState) => string;
  onDetailOpen: (skillName: string) => void;
  onPrimaryAction: (item: SkillStoreItem) => void;
  onUninstall: (item: SkillStoreItem) => void;
  resolveMarketplaceSkillActionState: (
    item: SkillStoreItem,
  ) => MarketplaceSkillActionState;
  selectedStoreItem: SkillStoreItem | null;
}

function MarketplaceSkillCard({
  item,
  index,
  selectedStoreItem,
  findInstalledMarketplaceLocalSkill,
  getMarketplaceSkillActionLabel,
  onDetailOpen,
  onPrimaryAction,
  onUninstall,
  resolveMarketplaceSkillActionState,
}: {
  item: SkillStoreItem;
  index: number;
} & MarketplaceSkillCardActionProps) {
  const { t } = useTranslation("agent");
  const skill = item.skill;
  const tone: ServiceSkillTone =
    index % 4 === 0
      ? "emerald"
      : index % 4 === 1
        ? "sky"
        : index % 4 === 2
          ? "amber"
          : "slate";
  const actionState = resolveMarketplaceSkillActionState(item);
  const iconAsset = skill.icon ?? buildMarketplaceIconPlaceholder(skill.title);
  const isSelected = selectedStoreItem?.skill.name === skill.name;
  const summary =
    skill.summary ||
    skill.bundle?.description ||
    t("skills.workspace.marketplace.defaultOutputHint");
  const localSkill = findInstalledMarketplaceLocalSkill(item) ?? null;
  const canUninstall =
    item.source === "official" &&
    Boolean(localSkill) &&
    localSkill?.sourceKind !== "builtin";
  const actionDisabled =
    actionState === "installing" || actionState === "uninstalling";

  return (
    <article
      className={cn(
        "group flex min-w-0 items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors",
        isSelected
          ? "bg-[color:var(--lime-surface-hover)]"
          : "hover:bg-[color:var(--lime-surface-hover)]",
      )}
      data-testid="skills-marketplace-card"
    >
      <MarketplaceSkillVisual
        asset={iconAsset}
        title={skill.title}
        tone={tone}
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="line-clamp-1 max-w-full text-left text-sm font-semibold text-[color:var(--lime-text-strong)] hover:underline"
          onClick={() => onDetailOpen(skill.name)}
          data-testid="skills-marketplace-open"
        >
          {skill.title}
        </button>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[color:var(--lime-text-muted)]">
          {summary}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {localSkill ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-[color:var(--lime-text-muted)] opacity-0 transition-opacity hover:bg-[color:var(--lime-surface-hover)] focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t("skills.workspace.installedSkill.action.more", {
                  name: skill.title,
                })}
                data-testid="skills-marketplace-actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="z-[80] min-w-[160px] rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1 text-[color:var(--lime-text)] shadow-lg"
            >
              <DropdownMenuItem
                className="rounded-lg px-3 py-2 text-[13px] font-medium"
                onClick={() => onPrimaryAction(item)}
              >
                {getMarketplaceSkillActionLabel(actionState)}
              </DropdownMenuItem>
              {canUninstall ? (
                <DropdownMenuItem
                  className="rounded-lg px-3 py-2 text-[13px] font-medium text-[color:var(--lime-warning)]"
                  onClick={() => onUninstall(item)}
                >
                  {t("skills.workspace.marketplace.action.uninstall")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            type="button"
            size="icon"
            className="h-7 w-7 rounded-full bg-[color:var(--lime-text-strong)] text-[color:var(--lime-surface)] shadow-none hover:opacity-90"
            aria-label={getMarketplaceSkillActionLabel(actionState)}
            title={getMarketplaceSkillActionLabel(actionState)}
            disabled={actionDisabled}
            onClick={() => onPrimaryAction(item)}
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">
              {getMarketplaceSkillActionLabel(actionState)}
            </span>
          </Button>
        )}
      </div>
    </article>
  );
}

export function MarketplaceSkillSection({
  title,
  items,
  startIndex = 0,
  meta,
  ...cardProps
}: {
  title?: string;
  items: SkillStoreItem[];
  startIndex?: number;
  meta?: string;
} & MarketplaceSkillCardActionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      {title ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[color:var(--lime-text-strong)]">
            {title}
          </h2>
          {meta ? (
            <span className="text-[12px] leading-5 text-[color:var(--lime-text-muted)]">
              {meta}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item, index) => (
          <MarketplaceSkillCard
            key={`${item.source}:${item.skill.name}`}
            item={item}
            index={startIndex + index}
            {...cardProps}
          />
        ))}
      </div>
    </section>
  );
}
