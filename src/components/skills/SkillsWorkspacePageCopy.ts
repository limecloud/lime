import { useMemo } from "react";
import type { TFunction } from "i18next";
import { formatList, formatNumber } from "@/i18n/format";
import type { ServiceSkillPresentationCopy } from "@/components/agent/chat/service-skills/skillPresentation";
import type { ServiceSkillLaunchPrefillCopy } from "@/components/agent/chat/service-skills/serviceSkillLaunchPrefill";
import type { InstalledSkillPresentationCopy } from "./installedSkillPresentation";

export function useSkillsWorkspaceCopy(t: TFunction<"agent">, locale: string) {
  const installedSkillPresentationCopy =
    useMemo<InstalledSkillPresentationCopy>(
      () => ({
        defaultPromise: t("skills.workspace.installedSkill.defaultPromise"),
        fallbackRequiredInputs: t(
          "skills.workspace.installedSkill.fallbackRequiredInputs",
        ),
        fallbackOutputHint: t(
          "skills.workspace.installedSkill.fallbackOutputHint",
        ),
        requiredPrefix: t("skills.workspace.installedSkill.requiredPrefix"),
        outputPrefix: t("skills.workspace.installedSkill.outputPrefix"),
      }),
      [t],
    );

  const serviceSkillPresentationCopy = useMemo<ServiceSkillPresentationCopy>(
    () => ({
      runnerLabels: {
        instant: t("skills.workspace.serviceSkill.runner.instant.label"),
        scheduled: t("skills.workspace.serviceSkill.runner.scheduled.label"),
        managed: t("skills.workspace.serviceSkill.runner.managed.label"),
      },
      runnerDescriptions: {
        instant: t("skills.workspace.serviceSkill.runner.instant.description"),
        scheduled: t(
          "skills.workspace.serviceSkill.runner.scheduled.description",
        ),
        managed: t("skills.workspace.serviceSkill.runner.managed.description"),
      },
      actionLabels: {
        instant: t("skills.workspace.serviceSkill.action.instant"),
        scheduled: t("skills.workspace.serviceSkill.action.scheduled"),
        managed: t("skills.workspace.serviceSkill.action.managed"),
      },
      typeLabels: {
        service: t("skills.workspace.serviceSkill.type.service"),
        site: t("skills.workspace.serviceSkill.type.site"),
        prompt: t("skills.workspace.serviceSkill.type.prompt"),
      },
      fallbackRequiredInputs: t(
        "skills.workspace.serviceSkill.requiredInputs.empty",
      ),
      requiredPrefix: t("skills.workspace.serviceSkill.requiredPrefix"),
      outputPrefix: t("skills.workspace.serviceSkill.outputPrefix"),
      siteRunnerLabel: t("skills.workspace.serviceSkill.runner.site.label"),
      siteRunnerDescription: t(
        "skills.workspace.serviceSkill.runner.site.description",
      ),
      requiredSlotActionLabel: t(
        "skills.workspace.serviceSkill.action.requiredSlot",
      ),
      siteActionLabel: t("skills.workspace.serviceSkill.action.site"),
      automationActionLabel: t(
        "skills.workspace.serviceSkill.action.automation",
      ),
      outputProjectResource: t(
        "skills.workspace.serviceSkill.output.projectResource",
      ),
      outputCurrentContent: t(
        "skills.workspace.serviceSkill.output.currentContent",
      ),
      outputScheduled: t("skills.workspace.serviceSkill.output.scheduled"),
      outputManaged: t("skills.workspace.serviceSkill.output.managed"),
      outputDefault: t("skills.workspace.serviceSkill.output.default"),
      dependencyRequiresModel: t(
        "skills.workspace.serviceSkill.dependency.model",
      ),
      dependencyRequiresBrowser: t(
        "skills.workspace.serviceSkill.dependency.browser",
      ),
      dependencyRequiresProject: t(
        "skills.workspace.serviceSkill.dependency.project",
      ),
      formatDependencyRequiresSkillKey: (skillKey) =>
        t("skills.workspace.serviceSkill.dependency.skillKey", {
          skillKey,
        }),
      formatFactItems: (visibleItems, totalCount) => {
        const items = formatList(visibleItems, { locale, style: "short" });
        if (visibleItems.length >= totalCount) {
          return items;
        }

        return t("skills.workspace.serviceSkill.factItems.withMore", {
          items,
          remaining: formatNumber(totalCount - visibleItems.length, {
            locale,
          }),
          total: formatNumber(totalCount, { locale }),
        });
      },
    }),
    [locale, t],
  );

  const serviceSkillLaunchPrefillCopy =
    useMemo<ServiceSkillLaunchPrefillCopy>(() => {
      const itemSeparator = t(
        "skills.workspace.serviceSkill.prefill.itemSeparator",
      );
      return {
        creationReplay: {
          sourceLabels: {
            memoryEntry: t(
              "skills.workspace.serviceSkill.prefill.creationReplay.source.memoryEntry",
            ),
          },
          formatFieldSummary: (visibleLabels, totalCount) => {
            const fields = formatList(visibleLabels, {
              locale,
              style: "short",
            });
            if (visibleLabels.length >= totalCount) {
              return fields;
            }

            return t(
              "skills.workspace.serviceSkill.prefill.creationReplay.fieldSummaryWithMore",
              {
                fields,
                remaining: formatNumber(totalCount - visibleLabels.length, {
                  locale,
                }),
                total: formatNumber(totalCount, { locale }),
              },
            );
          },
          formatHint: (sourceLabel, fieldSummary) =>
            t("skills.workspace.serviceSkill.prefill.creationReplay.hint", {
              fields: fieldSummary,
              source: sourceLabel,
            }),
        },
        filledPrefix: t("skills.workspace.serviceSkill.prefill.filledPrefix"),
        extraPrefix: t("skills.workspace.serviceSkill.prefill.extraPrefix"),
        itemSeparator,
        segmentSeparator: t(
          "skills.workspace.serviceSkill.prefill.segmentSeparator",
        ),
        formatFilledItems: (visibleItems, totalCount) => {
          const items = visibleItems.join(itemSeparator);
          if (visibleItems.length >= totalCount) {
            return items;
          }

          return t("skills.workspace.serviceSkill.prefill.filledWithMore", {
            items,
            remaining: formatNumber(totalCount - visibleItems.length, {
              locale,
            }),
            total: formatNumber(totalCount, { locale }),
          });
        },
        formatRecentServiceHint: (skillTitle) =>
          t("skills.workspace.serviceSkill.prefill.recentServiceHint", {
            title: skillTitle,
          }),
        formatRecentSceneHint: (sceneTitle) =>
          t("skills.workspace.serviceSkill.prefill.recentSceneHint", {
            title: sceneTitle,
          }),
      };
    }, [locale, t]);

  return {
    installedSkillPresentationCopy,
    serviceSkillLaunchPrefillCopy,
    serviceSkillPresentationCopy,
  };
}
