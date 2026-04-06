import {
  getSkillCatalog,
  listSkillCatalogSceneEntries,
  type SkillCatalogSceneEntry,
} from "@/lib/api/skillCatalog";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import type { ServiceSkillHomeItem } from "../service-skills/types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

interface ParsedRuntimeSceneCommand {
  sceneKey: string;
  userInput: string;
}

interface ServiceSceneLaunchRequest {
  skill: ServiceSkillHomeItem;
  sceneEntry: SkillCatalogSceneEntry;
  requestContext: Record<string, unknown>;
}

function normalizeCommandToken(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^\/+/, "").toLowerCase();
}

export function parseRuntimeSceneCommand(
  rawText: string,
): ParsedRuntimeSceneCommand | null {
  const sceneMatch = rawText.trim().match(/^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/);
  if (!sceneMatch) {
    return null;
  }

  const [, sceneKey, userInput] = sceneMatch;
  return {
    sceneKey,
    userInput: userInput?.trim() || "",
  };
}

export function matchesRuntimeSceneEntry(
  entry: SkillCatalogSceneEntry,
  sceneKey: string,
): boolean {
  const normalizedSceneKey = normalizeCommandToken(sceneKey);
  if (!normalizedSceneKey) {
    return false;
  }

  if (normalizeCommandToken(entry.sceneKey) === normalizedSceneKey) {
    return true;
  }

  if (normalizeCommandToken(entry.commandPrefix) === normalizedSceneKey) {
    return true;
  }

  return (entry.aliases ?? []).some(
    (alias) => normalizeCommandToken(alias) === normalizedSceneKey,
  );
}

function resolveRuntimeSceneSkill(
  serviceSkills: ServiceSkillHomeItem[],
  entry: SkillCatalogSceneEntry,
): ServiceSkillHomeItem | null {
  const normalizedSceneKey = normalizeCommandToken(entry.sceneKey);
  if (!normalizedSceneKey) {
    return null;
  }

  return (
    serviceSkills.find((skill) => skill.id === entry.linkedSkillId) ||
    serviceSkills.find(
      (skill) => normalizeCommandToken(skill.skillKey) === normalizedSceneKey,
    ) ||
    serviceSkills.find(
      (skill) => normalizeCommandToken(skill.id) === normalizedSceneKey,
    ) ||
    null
  );
}

function buildServiceSceneLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedRuntimeSceneCommand;
  sceneEntry: SkillCatalogSceneEntry;
  skill: ServiceSkillHomeItem;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  const { rawText, parsedCommand, sceneEntry, skill, projectId, contentId } =
    params;
  const runtime = resolveOemCloudRuntimeContext();

  return {
    kind: "cloud_scene",
    service_scene_run: {
      raw_text: rawText,
      user_input:
        normalizeOptionalText(parsedCommand.userInput) ??
        normalizeOptionalText(rawText) ??
        "",
      entry_id: sceneEntry.id,
      scene_key: sceneEntry.sceneKey,
      command_prefix: sceneEntry.commandPrefix,
      linked_skill_id: sceneEntry.linkedSkillId ?? skill.id,
      skill_id: skill.id,
      skill_key: skill.skillKey,
      skill_title: skill.title,
      skill_summary: skill.summary,
      runner_type: skill.runnerType,
      execution_kind: sceneEntry.executionKind ?? skill.executionKind,
      execution_location: skill.executionLocation,
      project_id: projectId ?? undefined,
      content_id: contentId ?? undefined,
      entry_source: "slash_scene_command",
      render_contract: sceneEntry.renderContract ?? undefined,
      oem_runtime: runtime
        ? {
            base_url: runtime.baseUrl,
            scene_base_url: runtime.sceneBaseUrl,
            tenant_id: runtime.tenantId,
            session_token: runtime.sessionToken ?? undefined,
          }
        : undefined,
    },
  };
}

export function buildServiceSceneLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  const serviceSceneRun = asRecord(requestContext.service_scene_run);
  const existingHarness = asRecord(existingMetadata?.harness);

  return {
    ...(existingMetadata || {}),
    harness: {
      ...(existingHarness || {}),
      service_scene_launch: {
        kind:
          typeof requestContext.kind === "string"
            ? requestContext.kind
            : "cloud_scene",
        ...(serviceSceneRun
          ? {
              service_scene_run: serviceSceneRun,
            }
          : {
              request_context: requestContext,
            }),
      },
    },
  };
}

export async function resolveRuntimeSceneLaunchRequest(params: {
  rawText: string;
  serviceSkills: ServiceSkillHomeItem[];
  projectId?: string | null;
  contentId?: string | null;
}): Promise<ServiceSceneLaunchRequest | null> {
  const parsedSceneCommand = parseRuntimeSceneCommand(params.rawText);
  if (!parsedSceneCommand) {
    return null;
  }

  const catalog = await getSkillCatalog();
  const sceneEntry = listSkillCatalogSceneEntries(catalog).find((entry) =>
    matchesRuntimeSceneEntry(entry, parsedSceneCommand.sceneKey),
  );
  if (!sceneEntry) {
    return null;
  }

  const matchedSkill = resolveRuntimeSceneSkill(params.serviceSkills, sceneEntry);
  if (!matchedSkill) {
    return null;
  }

  return {
    skill: matchedSkill,
    sceneEntry,
    requestContext: buildServiceSceneLaunchRequestContext({
      rawText: params.rawText,
      parsedCommand: parsedSceneCommand,
      sceneEntry,
      skill: matchedSkill,
      projectId: params.projectId,
      contentId: params.contentId,
    }),
  };
}
