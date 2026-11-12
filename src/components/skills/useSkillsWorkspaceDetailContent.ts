import { useEffect, useState } from "react";
import { skillsApi, type Skill } from "@/lib/api/skills";
import { getOfficialSkillMarketplaceBundle } from "@/lib/api/officialSkillMarketplace";
import { getDefaultSkillFilePath } from "./skillFilePreviewModel";
import {
  buildFallbackSkillMarkdown,
  extractSkillMarkdown,
} from "./SkillsWorkspacePageContent";
import type { SkillStoreItem } from "./SkillsWorkspacePageViewModel";
import type {
  InstalledSkillDetailContentState,
  MarketplaceSkillDetailContentState,
} from "./SkillsWorkspacePageTypes";

export function useSkillsWorkspaceDetailContent({
  detailStoreItem,
  detailInstalledSkill,
}: {
  detailStoreItem: SkillStoreItem | null;
  detailInstalledSkill: Skill | null;
}) {
  const [detailContentState, setDetailContentState] =
    useState<MarketplaceSkillDetailContentState | null>(null);
  const [installedDetailContentState, setInstalledDetailContentState] =
    useState<InstalledSkillDetailContentState | null>(null);
  const [installedDetailSelectedFilePath, setInstalledDetailSelectedFilePath] =
    useState<string>("SKILL.md");

  useEffect(() => {
    if (!detailStoreItem) {
      setDetailContentState(null);
      return;
    }

    let cancelled = false;
    const skillName = detailStoreItem.skill.name;

    if (detailStoreItem.source !== "official") {
      setDetailContentState({
        skillName,
        status: "ready",
        content: buildFallbackSkillMarkdown(detailStoreItem),
      });
      return;
    }

    setDetailContentState({ skillName, status: "loading" });
    void getOfficialSkillMarketplaceBundle(skillName, detailStoreItem.skill.release)
      .then((bundle) => {
        if (cancelled) return;
        const content = extractSkillMarkdown(bundle);
        setDetailContentState({
          skillName,
          status: "ready",
          content: content || buildFallbackSkillMarkdown(detailStoreItem),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setDetailContentState({
          skillName,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [detailStoreItem]);

  useEffect(() => {
    if (!detailInstalledSkill) {
      setInstalledDetailContentState(null);
      setInstalledDetailSelectedFilePath("SKILL.md");
      return;
    }

    let cancelled = false;
    const { directory } = detailInstalledSkill;
    setInstalledDetailContentState({ directory, status: "loading" });
    setInstalledDetailSelectedFilePath("SKILL.md");

    void skillsApi
      .inspectLocalSkillDetail(directory, "lime")
      .then((result) => {
        if (cancelled) return;
        setInstalledDetailContentState({
          directory,
          status: "ready",
          content: result.inspection.content,
          files: result.files,
        });
        setInstalledDetailSelectedFilePath(
          getDefaultSkillFilePath(result.files),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setInstalledDetailContentState({
          directory,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [detailInstalledSkill]);

  return {
    detailContentState,
    installedDetailContentState,
    installedDetailSelectedFilePath,
    setInstalledDetailSelectedFilePath,
  };
}
