import {
  getSkillCatalog,
  listSkillCatalogSceneEntries,
  type SkillCatalogSceneEntry,
} from "@/lib/api/skillCatalog";
import {
  listServiceSkills,
  type ServiceSkillItem,
} from "@/lib/api/serviceSkills";
import { resolveOemCloudRuntimeContext } from "@/lib/api/oemCloudRuntime";
import { siteGetAdapterLaunchReadiness } from "@/lib/webview-api";
import {
  buildServiceSkillClawLaunchContext,
  buildServiceSkillClawLaunchRequestMetadata,
  isServiceSkillSiteCapabilityBound,
  resolveServiceSkillSiteCapabilityExecution,
  type ServiceSkillClawLaunchContext,
} from "../service-skills/siteCapabilityBinding";
import type { ServiceSkillSlotValues } from "../service-skills/types";
import {
  buildRuntimeSceneGateRequest,
  formatRuntimeSceneGateValidationMessage,
  type RuntimeSceneGateRequest,
} from "./sceneSkillGate";

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

type ServiceSceneLaunchRequestContext =
  | Record<string, unknown>
  | ServiceSkillClawLaunchContext;

interface ServiceSceneLaunchRequest {
  skill: ServiceSkillItem;
  sceneEntry: SkillCatalogSceneEntry;
  requestContext: ServiceSceneLaunchRequestContext;
}

export class RuntimeSceneLaunchValidationError extends Error {
  gateRequest?: RuntimeSceneGateRequest;

  constructor(
    message: string,
    options?: { gateRequest?: RuntimeSceneGateRequest },
  ) {
    super(message);
    this.name = "RuntimeSceneLaunchValidationError";
    this.gateRequest = options?.gateRequest;
  }
}

function isServiceSkillClawLaunchContext(
  value: ServiceSceneLaunchRequestContext,
): value is ServiceSkillClawLaunchContext {
  return (
    value.kind === "site_adapter" &&
    typeof value.skillId === "string" &&
    typeof value.skillTitle === "string" &&
    typeof value.adapterName === "string" &&
    value.args !== null &&
    typeof value.args === "object" &&
    !Array.isArray(value.args)
  );
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
  const sceneMatch = rawText.trim().match(/^\/([^\s]+)\s*([\s\S]*)$/);
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
  serviceSkills: ServiceSkillItem[],
  entry: SkillCatalogSceneEntry,
): ServiceSkillItem | null {
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

async function resolveRuntimeSceneSkillWithCatalogFallback(
  serviceSkills: ServiceSkillItem[],
  entry: SkillCatalogSceneEntry,
): Promise<ServiceSkillItem | null> {
  const matchedSkill = resolveRuntimeSceneSkill(serviceSkills, entry);
  if (matchedSkill) {
    return matchedSkill;
  }

  try {
    return resolveRuntimeSceneSkill(await listServiceSkills(), entry);
  } catch {
    return null;
  }
}

function extractFirstUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s<>"')）]+/i);
  return normalizeOptionalText(match?.[0]);
}

export function resolveSiteSceneSlotValues(params: {
  skill: ServiceSkillItem;
  userInput: string;
  slotValueOverrides?: ServiceSkillSlotValues;
}): {
  resolvedSlotValues: ServiceSkillSlotValues;
  missingRequiredSlots: ServiceSkillItem["slotSchema"];
} {
  const { skill, userInput } = params;
  const normalizedUserInput = userInput.trim();

  const resolvedSlotValues: ServiceSkillSlotValues = {
    ...(params.slotValueOverrides || {}),
  };
  const singleUrlSlot =
    skill.slotSchema.filter((slot) => slot.type === "url").length === 1
      ? skill.slotSchema.find((slot) => slot.type === "url")
      : undefined;
  if (singleUrlSlot && !resolvedSlotValues[singleUrlSlot.key]) {
    const matchedUrl = extractFirstUrl(normalizedUserInput);
    if (matchedUrl) {
      resolvedSlotValues[singleUrlSlot.key] = matchedUrl;
    }
  }

  const unresolvedRequiredSlots = skill.slotSchema.filter(
    (slot) => slot.required && !resolvedSlotValues[slot.key],
  );
  if (unresolvedRequiredSlots.length === 1 && normalizedUserInput) {
    const [slot] = unresolvedRequiredSlots;
    if (slot && slot.type !== "url" && !resolvedSlotValues[slot.key]) {
      resolvedSlotValues[slot.key] = normalizedUserInput;
    }
  }

  const missingRequiredSlots = skill.slotSchema.filter(
    (slot) => slot.required && !resolvedSlotValues[slot.key],
  );

  return {
    resolvedSlotValues,
    missingRequiredSlots,
  };
}

function resolveSiteSceneProjectId(
  skill: ServiceSkillItem,
  projectId?: string | null,
): {
  projectId?: string;
  missingProject: boolean;
} {
  const normalizedProjectId = normalizeOptionalText(projectId);
  if (normalizedProjectId) {
    return {
      projectId: normalizedProjectId,
      missingProject: false,
    };
  }

  const requiresProject =
    skill.readinessRequirements?.requiresProject ||
    (skill.siteCapabilityBinding?.saveMode ?? "project_resource") ===
      "project_resource";
  if (!requiresProject) {
    return {
      projectId: undefined,
      missingProject: false,
    };
  }

  return {
    projectId: undefined,
    missingProject: true,
  };
}

function buildServiceSceneLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedRuntimeSceneCommand;
  sceneEntry: SkillCatalogSceneEntry;
  skill: ServiceSkillItem;
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
      execution_kind: sceneEntry.executionKind ?? skill.defaultExecutorBinding,
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

function buildSiteSceneLaunchRequestContext(params: {
  skill: ServiceSkillItem;
  slotValues: ServiceSkillSlotValues;
  resolvedAdapterName: string;
  projectId?: string;
  contentId?: string | null;
  launchReadiness?: Awaited<
    ReturnType<typeof siteGetAdapterLaunchReadiness>
  > | null;
}): ServiceSkillClawLaunchContext {
  const { skill, slotValues, projectId, contentId, launchReadiness } = params;

  if (!isServiceSkillSiteCapabilityBound(skill)) {
    throw new RuntimeSceneLaunchValidationError(
      "当前场景没有绑定站点执行能力。",
    );
  }

  const saveMode = skill.siteCapabilityBinding.saveMode ?? "project_resource";

  return buildServiceSkillClawLaunchContext(skill, slotValues, {
    adapterName: params.resolvedAdapterName,
    projectId,
    contentId: saveMode === "current_content" ? contentId : undefined,
    launchReadiness,
  });
}

async function resolveSiteSceneLaunchReadiness(
  adapterName: string,
): Promise<Awaited<ReturnType<typeof siteGetAdapterLaunchReadiness>> | null> {
  try {
    return await siteGetAdapterLaunchReadiness({
      adapter_name: adapterName,
    });
  } catch {
    return null;
  }
}

export function buildServiceSceneLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: ServiceSceneLaunchRequestContext,
): Record<string, unknown> {
  if (isServiceSkillClawLaunchContext(requestContext)) {
    const existingHarness = asRecord(existingMetadata?.harness);
    const siteMetadata = buildServiceSkillClawLaunchRequestMetadata(
      requestContext,
    );
    const siteHarness = asRecord(siteMetadata.harness);

    return {
      ...(existingMetadata || {}),
      ...siteMetadata,
      harness: {
        ...(existingHarness || {}),
        ...(siteHarness || {}),
      },
    };
  }

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
  serviceSkills: ServiceSkillItem[];
  projectId?: string | null;
  projectIdOverride?: string | null;
  contentId?: string | null;
  slotValueOverrides?: ServiceSkillSlotValues;
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

  const matchedSkill = await resolveRuntimeSceneSkillWithCatalogFallback(
    params.serviceSkills,
    sceneEntry,
  );
  if (!matchedSkill) {
    return null;
  }

  let requestContext: ServiceSceneLaunchRequestContext;
  if (matchedSkill.defaultExecutorBinding === "browser_assist") {
    const slotResolution = resolveSiteSceneSlotValues({
      skill: matchedSkill,
      userInput: parsedSceneCommand.userInput,
      slotValueOverrides: params.slotValueOverrides,
    });
    const projectResolution = resolveSiteSceneProjectId(
      matchedSkill,
      params.projectIdOverride ?? params.projectId,
    );
    const gateRequest = buildRuntimeSceneGateRequest({
      rawText: params.rawText,
      sceneEntry,
      skill: matchedSkill,
      missingSlots: slotResolution.missingRequiredSlots,
      requireProject: projectResolution.missingProject,
    });
    if (gateRequest) {
      throw new RuntimeSceneLaunchValidationError(
        formatRuntimeSceneGateValidationMessage(gateRequest),
        { gateRequest },
      );
    }
    let resolvedCapability;
    try {
      resolvedCapability = await resolveServiceSkillSiteCapabilityExecution(
        matchedSkill,
        slotResolution.resolvedSlotValues,
      );
    } catch (error) {
      throw new RuntimeSceneLaunchValidationError(
        error instanceof Error ? error.message : "当前站点技能暂时无法解析。",
      );
    }

    requestContext = buildSiteSceneLaunchRequestContext({
      skill: matchedSkill,
      slotValues: slotResolution.resolvedSlotValues,
      resolvedAdapterName: resolvedCapability.adapterName,
      projectId: projectResolution.projectId,
      contentId: params.contentId,
      launchReadiness: await resolveSiteSceneLaunchReadiness(
        resolvedCapability.adapterName,
      ),
    });
  } else {
    requestContext = buildServiceSceneLaunchRequestContext({
      rawText: params.rawText,
      parsedCommand: parsedSceneCommand,
      sceneEntry,
      skill: matchedSkill,
      projectId: params.projectId,
      contentId: params.contentId,
    });
  }

  return {
    skill: matchedSkill,
    sceneEntry,
    requestContext,
  };
}
