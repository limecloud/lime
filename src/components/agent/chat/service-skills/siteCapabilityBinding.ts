import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import type { ServiceSkillSlotValues } from "./types";
import { resolveServiceSkillSlotValue } from "./promptComposer";

export function isServiceSkillSiteCapabilityBound(
  skill: Pick<ServiceSkillItem, "defaultExecutorBinding" | "siteCapabilityBinding">,
): skill is Pick<
  ServiceSkillItem,
  "defaultExecutorBinding" | "siteCapabilityBinding"
> & {
  siteCapabilityBinding: NonNullable<ServiceSkillItem["siteCapabilityBinding"]>;
} {
  return (
    skill.defaultExecutorBinding === "browser_assist" &&
    !!skill.siteCapabilityBinding
  );
}

export function buildServiceSkillSiteCapabilityArgs(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
): Record<string, unknown> {
  if (!isServiceSkillSiteCapabilityBound(skill)) {
    return {};
  }

  const mappedArgs = skill.slotSchema.reduce<Record<string, unknown>>(
    (acc, slot) => {
      const argName = skill.siteCapabilityBinding.slotArgMap?.[slot.key];
      if (!argName) {
        return acc;
      }

      const value = resolveServiceSkillSlotValue(slot, slotValues);
      if (!value) {
        return acc;
      }

      acc[argName] = value;
      return acc;
    },
    {},
  );

  return {
    ...mappedArgs,
    ...(skill.siteCapabilityBinding.fixedArgs ?? {}),
  };
}

function normalizeTemplateSegment(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized;
}

export function buildServiceSkillSiteCapabilitySaveTitle(
  skill: ServiceSkillItem,
  slotValues: ServiceSkillSlotValues,
): string | undefined {
  if (
    !isServiceSkillSiteCapabilityBound(skill) ||
    !skill.siteCapabilityBinding.suggestedTitleTemplate
  ) {
    return undefined;
  }

  const slotValueMap = Object.fromEntries(
    skill.slotSchema.map((slot) => [
      slot.key,
      resolveServiceSkillSlotValue(slot, slotValues),
    ]),
  );
  const template = skill.siteCapabilityBinding.suggestedTitleTemplate;
  const rendered = template
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, rawToken: string) => {
      switch (rawToken) {
        case "skill.title":
          return normalizeTemplateSegment(skill.title);
        case "adapter.name":
          return normalizeTemplateSegment(skill.siteCapabilityBinding.adapterName);
        default:
          return normalizeTemplateSegment(slotValueMap[rawToken]);
      }
    })
    .replace(/\s+/g, " ")
    .trim();

  return rendered || undefined;
}
