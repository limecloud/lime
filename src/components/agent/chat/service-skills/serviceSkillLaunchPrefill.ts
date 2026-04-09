import {
  getSlashEntryUsageMap,
  getSlashEntryUsageRecordKey,
} from "../skill-selection/slashEntryUsage";
import { resolveSiteSceneSlotValues } from "../workspace/serviceSkillSceneLaunch";
import type { CreationReplayMetadata } from "../utils/creationReplayMetadata";
import { buildCreationReplaySlotPrefill } from "./creationReplaySlotPrefill";
import { getServiceSkillUsageMap } from "./storage";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotValues,
} from "./types";

export interface ServiceSkillLaunchPrefillResult {
  slotValues?: ServiceSkillSlotValues;
  hint?: string;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function compactSlotValues(
  slotValues: ServiceSkillSlotValues | undefined,
): ServiceSkillSlotValues | undefined {
  if (!slotValues) {
    return undefined;
  }

  const nextValues = Object.fromEntries(
    Object.entries(slotValues)
      .map(([key, value]) => [key.trim(), normalizeOptionalText(value)])
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );

  return Object.keys(nextValues).length > 0 ? nextValues : undefined;
}

function resolveRecentServiceSkillPrefill(
  skill: ServiceSkillHomeItem,
): ServiceSkillLaunchPrefillResult | undefined {
  const recentUsage = getServiceSkillUsageMap().get(skill.id);
  const slotValues = compactSlotValues(recentUsage?.slotValues);
  if (!slotValues) {
    return undefined;
  }

  return {
    slotValues,
    hint: `已根据你上次成功执行 ${skill.title} 时的参数自动预填，可继续修改后执行。`,
  };
}

function resolveRecentScenePrefill(
  skill: ServiceSkillHomeItem,
): ServiceSkillLaunchPrefillResult | undefined {
  const sceneKey = normalizeOptionalText(skill.sceneBinding?.sceneKey);
  if (!sceneKey) {
    return undefined;
  }

  const recentSceneUsage = getSlashEntryUsageMap().get(
    getSlashEntryUsageRecordKey("scene", sceneKey),
  );
  const replayText = normalizeOptionalText(recentSceneUsage?.replayText);
  if (!replayText) {
    return undefined;
  }

  const slotValues = compactSlotValues(
    resolveSiteSceneSlotValues({
      skill,
      userInput: replayText,
    }).resolvedSlotValues,
  );
  if (!slotValues) {
    return undefined;
  }

  return {
    slotValues,
    hint: `已根据你上次成功执行 ${skill.sceneBinding?.commandPrefix || skill.title} 时的输入自动预填，可继续修改后执行。`,
  };
}

export function resolveServiceSkillLaunchPrefill(params: {
  skill: ServiceSkillHomeItem | null;
  creationReplay?: CreationReplayMetadata;
}): ServiceSkillLaunchPrefillResult | null {
  const { skill, creationReplay } = params;
  if (!skill) {
    return null;
  }

  const recentServicePrefill = resolveRecentServiceSkillPrefill(skill);
  const recentScenePrefill = recentServicePrefill
    ? undefined
    : resolveRecentScenePrefill(skill);
  const creationReplayPrefill = buildCreationReplaySlotPrefill(
    skill,
    creationReplay,
  );
  const slotValues = compactSlotValues({
    ...(recentServicePrefill?.slotValues ||
      recentScenePrefill?.slotValues ||
      {}),
    ...(creationReplayPrefill?.slotValues || {}),
  });

  if (!slotValues && !creationReplayPrefill?.hint) {
    return null;
  }

  return {
    slotValues,
    hint:
      creationReplayPrefill?.hint ??
      recentServicePrefill?.hint ??
      recentScenePrefill?.hint,
  };
}
